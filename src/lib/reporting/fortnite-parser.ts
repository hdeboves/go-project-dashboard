import ExcelJS from "exceljs";
import { AppHttpError } from "@/lib/errors";

export interface ParsedFortniteRow {
  date: string;
  uniquePlayers: number;
  sessions: number;
  avgPlaytimeSec: number;
  retentionD1: number | null;
  peakConcurrent: number;
}

export interface FortniteSummary {
  totalDays: number;
  totalUniquePlayers: number;
  totalSessions: number;
  avgPlaytimeSec: number;
  avgRetentionD1: number;
  maxPeakConcurrent: number;
  totalMinutesPlayed: number;
  avgPlaytimeMinPerUser: number;
  dateRangeLabel: string;
}

type CanonicalColumn =
  | "date"
  | "uniquePlayers"
  | "sessions"
  | "avgPlaytimeSec"
  | "avgPlaytimeMin"
  | "retentionD1"
  | "peakConcurrent";

function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mapColumnAlias(header: string): CanonicalColumn | null {
  const norm = normalizeHeader(header);
  if (!norm) return null;

  if (
    norm === "date" ||
    norm === "day" ||
    norm === "jour" ||
    norm === "timestamp" ||
    norm === "period" ||
    norm === "date_utc"
  ) {
    return "date";
  }

  if (
    norm === "unique_players" ||
    norm === "players" ||
    norm === "joueurs_uniques" ||
    norm === "joueurs" ||
    norm === "active_players" ||
    norm === "dau"
  ) {
    return "uniquePlayers";
  }

  if (
    norm === "sessions" ||
    norm === "plays" ||
    norm === "parties" ||
    norm === "nb_sessions" ||
    norm === "total_sessions"
  ) {
    return "sessions";
  }

  if (
    norm === "avg_playtime_sec" ||
    norm === "avg_playtime_s" ||
    norm === "average_playtime" ||
    norm === "avg_playtime" ||
    norm === "avg_session_duration" ||
    norm === "average_session_length" ||
    norm === "duree_moyenne_sec" ||
    norm === "temps_de_jeu_moyen_sec"
  ) {
    return "avgPlaytimeSec";
  }

  if (
    norm === "avg_playtime_min" ||
    norm === "avg_playtime_minutes" ||
    norm === "temps_de_jeu_moyen" ||
    norm === "temps_moyen_min"
  ) {
    return "avgPlaytimeMin";
  }

  if (
    norm === "retention_d1" ||
    norm === "d1_retention" ||
    norm === "day_1_retention" ||
    norm === "retention_j1" ||
    norm === "retention"
  ) {
    return "retentionD1";
  }

  if (
    norm === "peak_concurrent" ||
    norm === "peak_ccu" ||
    norm === "max_ccu" ||
    norm === "pic_simultane" ||
    norm === "pics_quotidiens" ||
    norm === "peak_players"
  ) {
    return "peakConcurrent";
  }

  return null;
}

function isValidCalendarDateParts(
  year: number,
  month: number,
  day: number
): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function normalizeStrictIsoDate(raw: unknown): string | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    const y = raw.getUTCFullYear();
    const m = raw.getUTCMonth() + 1;
    const d = raw.getUTCDate();
    if (!isValidCalendarDateParts(y, m, d)) return null;
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // YYYY-MM-DD (optionally with T...)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (!isValidCalendarDateParts(y, m, d)) return null;
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // DD/MM/YYYY
  const frMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (frMatch) {
    const d = Number(frMatch[1]);
    const m = Number(frMatch[2]);
    const y = Number(frMatch[3]);
    if (!isValidCalendarDateParts(y, m, d)) return null;
    return `${frMatch[3]}-${frMatch[2]}-${frMatch[1]}`;
  }

  return null;
}

function parseNumericValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "-" || trimmed === "N/A") return null;
    const cleaned = trimmed
      .replace(/[\u00a0\u202f\s]/g, "")
      .replace(/%$/, "")
      .replace(/,/g, ".");
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
      return Number.NaN;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function parseDurationToSeconds(
  raw: unknown,
  inMinutes: boolean
): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return Number.NaN;
    return inMinutes ? raw * 60 : raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const mmss = trimmed.match(/^(\d+):(\d{1,2})$/);
    if (mmss) {
      return Number(mmss[1]) * 60 + Number(mmss[2]);
    }
    const minLabel = trimmed.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:min|m)$/i);
    if (minLabel) {
      return Number(minLabel[1].replace(",", ".")) * 60;
    }
    const num = parseNumericValue(trimmed);
    if (num === null) return 0;
    if (Number.isNaN(num)) return Number.NaN;
    return inMinutes ? num * 60 : num;
  }
  return Number.NaN;
}

function isSummaryRow(firstCells: string[]): boolean {
  const combined = firstCells.join(" ").trim().toLowerCase();
  return (
    combined === "total" ||
    combined === "total général" ||
    combined === "total general" ||
    combined === "summary" ||
    combined === "moyenne" ||
    combined.startsWith("total ")
  );
}

function splitCsvLine(line: string, delimiter: "," | ";"): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectBinarySignature(buffer: Buffer): "PNG" | "JPEG" | "ZIP" | "PDF" | "OTHER_BINARY" | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "PNG";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "JPEG";
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return "ZIP";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "%PDF") {
    return "PDF";
  }
  // Check null bytes in first 512 bytes for arbitrary binary
  const sampleLen = Math.min(buffer.length, 512);
  for (let i = 0; i < sampleLen; i += 1) {
    if (buffer[i] === 0) return "OTHER_BINARY";
  }
  return null;
}

function parseRowsFromGrid(grid: unknown[][]): ParsedFortniteRow[] {
  const nonEmptyRows = grid.filter((row) =>
    row.some((cell) => String(cell ?? "").trim().length > 0)
  );
  if (nonEmptyRows.length === 0) {
    throw new AppHttpError(
      400,
      "EMPTY_FORTNITE_FILE",
      "Le fichier Fortnite ne contient aucune ligne."
    );
  }

  const headerRow = nonEmptyRows[0].map((c) => String(c ?? "").trim());
  const colIndexMap = new Map<CanonicalColumn, number>();
  headerRow.forEach((header, idx) => {
    const mapped = mapColumnAlias(header);
    if (mapped && !colIndexMap.has(mapped)) {
      colIndexMap.set(mapped, idx);
    }
  });

  if (!colIndexMap.has("date")) {
    throw new AppHttpError(
      400,
      "MISSING_FORTNITE_COLUMNS",
      "Colonne 'Date' requise introuvable dans le fichier Portail Créateur Fortnite."
    );
  }

  const hasAnyMetricCol =
    colIndexMap.has("uniquePlayers") ||
    colIndexMap.has("sessions") ||
    colIndexMap.has("avgPlaytimeSec") ||
    colIndexMap.has("avgPlaytimeMin") ||
    colIndexMap.has("retentionD1") ||
    colIndexMap.has("peakConcurrent");

  if (!hasAnyMetricCol) {
    throw new AppHttpError(
      400,
      "MISSING_FORTNITE_COLUMNS",
      "Aucune colonne de métrique Fortnite reconnue (unique_players, sessions, avg_playtime_sec, retention_d1, peak_concurrent)."
    );
  }

  const dataRows = nonEmptyRows.slice(1);
  if (dataRows.length === 0) {
    throw new AppHttpError(
      400,
      "NO_FORTNITE_DATA_ROWS",
      "Le fichier Fortnite contient uniquement les en-têtes sans aucune ligne de données."
    );
  }

  const parsed: ParsedFortniteRow[] = [];

  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i];
    const rowNum = i + 2;
    const rawStrings = row.map((c) => String(c ?? "").trim());
    if (isSummaryRow(rawStrings.slice(0, 2))) {
      continue;
    }

    const rawDate = row[colIndexMap.get("date")!];
    const isoDate = normalizeStrictIsoDate(rawDate);
    if (!isoDate) {
      throw new AppHttpError(
        400,
        "INVALID_FORTNITE_DATE",
        `Date invalide à la ligne ${rowNum} : "${String(rawDate ?? "")}". Format attendu YYYY-MM-DD.`
      );
    }

    const uniquePlayersRaw = colIndexMap.has("uniquePlayers")
      ? parseNumericValue(row[colIndexMap.get("uniquePlayers")!])
      : 0;
    const sessionsRaw = colIndexMap.has("sessions")
      ? parseNumericValue(row[colIndexMap.get("sessions")!])
      : 0;
    const peakRaw = colIndexMap.has("peakConcurrent")
      ? parseNumericValue(row[colIndexMap.get("peakConcurrent")!])
      : 0;
    const retentionRaw = colIndexMap.has("retentionD1")
      ? parseNumericValue(row[colIndexMap.get("retentionD1")!])
      : null;

    const avgPlaytimeSec = colIndexMap.has("avgPlaytimeSec")
      ? parseDurationToSeconds(row[colIndexMap.get("avgPlaytimeSec")!], false)
      : colIndexMap.has("avgPlaytimeMin")
        ? parseDurationToSeconds(row[colIndexMap.get("avgPlaytimeMin")!], true)
        : 0;

    if (
      (uniquePlayersRaw !== null && Number.isNaN(uniquePlayersRaw)) ||
      (sessionsRaw !== null && Number.isNaN(sessionsRaw)) ||
      (peakRaw !== null && Number.isNaN(peakRaw)) ||
      (retentionRaw !== null && Number.isNaN(retentionRaw)) ||
      Number.isNaN(avgPlaytimeSec)
    ) {
      throw new AppHttpError(
        400,
        "INVALID_FORTNITE_NUMBER",
        `Valeur numérique invalide à la ligne ${rowNum}.`
      );
    }

    const uniquePlayers = Math.round(uniquePlayersRaw ?? 0);
    const sessions = Math.round(sessionsRaw ?? 0);
    const peakConcurrent = Math.round(peakRaw ?? 0);
    const roundedPlaytime = Number(avgPlaytimeSec.toFixed(2));
    const retentionD1 =
      retentionRaw !== null ? Number(retentionRaw.toFixed(2)) : null;

    if (
      uniquePlayers < 0 ||
      sessions < 0 ||
      peakConcurrent < 0 ||
      roundedPlaytime < 0
    ) {
      throw new AppHttpError(
        400,
        "NEGATIVE_FORTNITE_METRIC",
        `Les métriques Fortnite ne peuvent pas être négatives (ligne ${rowNum}).`
      );
    }

    if (retentionD1 !== null && (retentionD1 < 0 || retentionD1 > 100)) {
      throw new AppHttpError(
        400,
        "INVALID_FORTNITE_RETENTION",
        `La rétention J1 doit être comprise entre 0 et 100% (ligne ${rowNum} : ${retentionD1}%).`
      );
    }

    parsed.push({
      date: isoDate,
      uniquePlayers,
      sessions,
      avgPlaytimeSec: roundedPlaytime,
      retentionD1,
      peakConcurrent,
    });
  }

  if (parsed.length === 0) {
    throw new AppHttpError(
      400,
      "NO_FORTNITE_DATA_ROWS",
      "Aucune ligne de données journalières valide trouvée dans le fichier Fortnite."
    );
  }

  return parsed;
}

export async function parseFortniteReport(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<{
  sourceType: "FORTNITE_CSV" | "FORTNITE_XLSX";
  rows: ParsedFortniteRow[];
}> {
  if (!buffer || buffer.length === 0) {
    throw new AppHttpError(
      400,
      "EMPTY_FORTNITE_FILE",
      "Le fichier Fortnite envoyé est vide (0 octet)."
    );
  }

  const lowerName = filename.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  const isXlsx =
    lowerName.endsWith(".xlsx") ||
    lowerMime.includes("spreadsheetml") ||
    lowerMime.includes("ms-excel");
  const isCsv =
    lowerName.endsWith(".csv") ||
    lowerMime.includes("text/csv") ||
    lowerMime.includes("application/csv") ||
    lowerMime === "text/plain";

  if (!isXlsx && !isCsv) {
    throw new AppHttpError(
      415,
      "UNSUPPORTED_FORTNITE_FORMAT",
      "Format non supporté. Importez un fichier .csv ou .xlsx du Portail Créateur Fortnite."
    );
  }

  const binSig = detectBinarySignature(buffer);

  if (isXlsx) {
    if (binSig !== "ZIP") {
      throw new AppHttpError(
        400,
        "INVALID_FORTNITE_XLSX",
        "Le fichier .xlsx fourni n'est pas un classeur Excel valide."
      );
    }

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) {
        throw new AppHttpError(
          400,
          "EMPTY_FORTNITE_FILE",
          "Le classeur Excel Fortnite ne contient aucun onglet."
        );
      }

      const grid: unknown[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
        grid.push(
          vals.map((cell) => {
            if (
              cell &&
              typeof cell === "object" &&
              !(cell instanceof Date) &&
              "result" in cell
            ) {
              return (cell as { result?: unknown }).result ?? "";
            }
            if (
              cell &&
              typeof cell === "object" &&
              !(cell instanceof Date) &&
              "text" in cell
            ) {
              return (cell as { text?: unknown }).text ?? "";
            }
            return cell ?? "";
          })
        );
      });

      return {
        sourceType: "FORTNITE_XLSX",
        rows: parseRowsFromGrid(grid),
      };
    } catch (err) {
      if (err instanceof AppHttpError) throw err;
      throw new AppHttpError(
        400,
        "INVALID_FORTNITE_XLSX",
        "Impossible de lire le classeur .xlsx Fortnite (fichier corrompu ou invalide)."
      );
    }
  }

  // CSV path
  if (binSig !== null) {
    throw new AppHttpError(
      400,
      "INVALID_FORTNITE_CSV",
      "Le fichier .csv fourni contient des données binaires invalides."
    );
  }

  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new AppHttpError(
      400,
      "EMPTY_FORTNITE_FILE",
      "Le fichier CSV Fortnite ne contient aucune ligne."
    );
  }

  const firstLine = lines[0];
  const semicolonCount = (firstLine.match(/;/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const delimiter: "," | ";" = semicolonCount > commaCount ? ";" : ",";

  const grid = lines.map((line) => splitCsvLine(line, delimiter));
  return {
    sourceType: "FORTNITE_CSV",
    rows: parseRowsFromGrid(grid),
  };
}

export function computeFortniteSummary(
  rows: ReadonlyArray<{
    date: string;
    uniquePlayers: number;
    sessions: number;
    avgPlaytimeSec: number;
    retentionD1: number | null;
    peakConcurrent: number;
  }>
): FortniteSummary {
  if (rows.length === 0) {
    return {
      totalDays: 0,
      totalUniquePlayers: 0,
      totalSessions: 0,
      avgPlaytimeSec: 0,
      avgRetentionD1: 0,
      maxPeakConcurrent: 0,
      totalMinutesPlayed: 0,
      avgPlaytimeMinPerUser: 0,
      dateRangeLabel: "Aucune donnée",
    };
  }

  let totalUniquePlayers = 0;
  let totalSessions = 0;
  let sumPlaytimeSec = 0;
  let totalMinutesPlayed = 0;
  let maxPeakConcurrent = 0;
  let retentionSum = 0;
  let retentionCount = 0;
  let minDate = rows[0].date;
  let maxDate = rows[0].date;

  for (const r of rows) {
    totalUniquePlayers += r.uniquePlayers;
    totalSessions += r.sessions;
    sumPlaytimeSec += r.avgPlaytimeSec;
    totalMinutesPlayed += Math.round((r.sessions * r.avgPlaytimeSec) / 60);
    if (r.peakConcurrent > maxPeakConcurrent) {
      maxPeakConcurrent = r.peakConcurrent;
    }
    if (r.retentionD1 !== null && Number.isFinite(r.retentionD1)) {
      retentionSum += r.retentionD1;
      retentionCount += 1;
    }
    if (r.date < minDate) minDate = r.date;
    if (r.date > maxDate) maxDate = r.date;
  }

  const avgPlaytimeSec = Number((sumPlaytimeSec / rows.length).toFixed(2));
  const avgRetentionD1 =
    retentionCount > 0
      ? Number((retentionSum / retentionCount).toFixed(2))
      : 0;
  const avgPlaytimeMinPerUser =
    totalUniquePlayers > 0
      ? Number((totalMinutesPlayed / totalUniquePlayers).toFixed(1))
      : Number((avgPlaytimeSec / 60).toFixed(1));

  return {
    totalDays: rows.length,
    totalUniquePlayers,
    totalSessions,
    avgPlaytimeSec,
    avgRetentionD1,
    maxPeakConcurrent,
    totalMinutesPlayed,
    avgPlaytimeMinPerUser,
    dateRangeLabel: minDate === maxDate ? minDate : `${minDate} → ${maxDate}`,
  };
}
