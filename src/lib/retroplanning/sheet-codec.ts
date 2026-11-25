import type { RetroTask } from "@prisma/client";
import type { SheetsPort } from "@/lib/ports";
import {
  addUtcDays,
  normalizeRetroStatus,
  parseStrictCalendarDate,
  toIsoDateOnly,
  type MilestoneType,
  type RetroStatus,
} from "@/lib/retroplanning/validation";

export const RETRO_SHEET_TAB = "Par semaine" as const;
export const RETRO_CORE_COLUMNS = ["PHASES", "ÉTAPES", "TACHES"] as const;

export const RETRO_STATUS_LABELS: Record<RetroStatus, string> = {
  A_FAIRE: "À faire",
  EN_COURS: "En cours",
  EN_ATTENTE_CLIENT: "En attente client",
  TERMINE: "Terminé",
};

export interface ParsedSheetTask {
  id?: string;
  phase: string;
  etape: string;
  tache: string;
  owner: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: RetroStatus;
  sheetRowIndex: number; // 1-based row index in Google Sheet
  isMilestone: boolean;
  milestoneType: MilestoneType | null;
}

export interface WeekBlockMeta {
  weekNumber: number;
  startCol: number; // 0-based
  colWidth: number;
  startDate: Date;
  endDate: Date;
}

export interface SheetColumnLayout {
  headerRowIndex1Based: number;
  colMap: {
    id: number | null;
    phase: number;
    etape: number;
    tache: number;
    owner: number | null;
    startDate: number | null;
    endDate: number | null;
    status: number | null;
    isMilestone: number | null;
    milestoneType: number | null;
  };
  weekBlocks: WeekBlockMeta[];
  nextEmptyRow1Based: number;
  sheetId: number | null;
  isEmptySheet: boolean;
}

function normalizeHeader(cell: unknown): string {
  return String(cell ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function indexToColumnLetter(col0: number): string {
  let n = col0 + 1;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result || "A";
}

function parseDdMmPair(
  text: string,
  baseYear: number
): { start: Date; end: Date } | null {
  const m = /(\d{1,2})\/(\d{1,2})\s*(?:au|-|->)\s*(\d{1,2})\/(\d{1,2})/i.exec(
    text
  );
  if (!m) return null;
  const d1 = Number.parseInt(m[1], 10);
  const m1 = Number.parseInt(m[2], 10);
  const d2 = Number.parseInt(m[3], 10);
  const m2 = Number.parseInt(m[4], 10);
  if (m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12 || d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) {
    return null;
  }
  const endYear = m2 < m1 ? baseYear + 1 : baseYear;
  const start = new Date(Date.UTC(baseYear, m1 - 1, d1, 12, 0, 0, 0));
  const end = new Date(Date.UTC(endYear, m2 - 1, d2, 12, 0, 0, 0));
  return { start, end };
}

function rgbToHex(color: unknown): string | null {
  if (!color || typeof color !== "object") return null;
  const c = color as { red?: number; green?: number; blue?: number };
  if (
    typeof c.red !== "number" &&
    typeof c.green !== "number" &&
    typeof c.blue !== "number"
  ) {
    return null;
  }
  const toByte = (v?: number) =>
    Math.max(0, Math.min(255, Math.round((v ?? 0) * 255)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${toByte(c.red)}${toByte(c.green)}${toByte(c.blue)}`;
}

function inferMilestoneFromText(text: string): {
  isMilestone: boolean;
  milestoneType: MilestoneType | null;
} {
  const lower = text.toLowerCase();
  if (lower.includes("influence") || lower.includes("talent")) {
    return { isMilestone: true, milestoneType: "INFLUENCE" };
  }
  if (
    lower.includes("mise en ligne de l'exp") ||
    lower.includes("lancement map") ||
    lower.includes("lancement")
  ) {
    return { isMilestone: true, milestoneType: "LANCEMENT_MAP" };
  }
  if (lower.includes("weekly")) {
    return { isMilestone: true, milestoneType: "WEEKLY" };
  }
  if (lower.includes("jalon") || lower.includes("milestone")) {
    return { isMilestone: true, milestoneType: "CUSTOM" };
  }
  return { isMilestone: false, milestoneType: null };
}

function isNeutralFill(hex: string | null): boolean {
  if (!hex) return true;
  const upper = hex.toUpperCase();
  return (
    upper === "#FFFFFF" ||
    upper === "#000000" ||
    upper === "#D9D9D9" ||
    upper === "#EFEFEF" ||
    upper === "#CCCCCC" ||
    upper === "#F3F3F3"
  );
}

function parseWeekCellStatus(raw: string): RetroStatus | null {
  const stripped = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return normalizeRetroStatus(stripped);
}

/**
 * Parses week block definitions from header rows (supporting both 7-col PROD blocks and 1-col value columns).
 */
function extractWeekBlocksFromValues(
  rows: unknown[][],
  headerRowIdx0: number,
  tacheColIdx: number,
  defaultYear = 2026
): WeekBlockMeta[] {
  const blocks: WeekBlockMeta[] = [];
  const headerRow = rows[headerRowIdx0] ?? [];
  const prevRow = headerRowIdx0 > 0 ? rows[headerRowIdx0 - 1] ?? [] : [];

  // Scan from after TACHES (or col 4+) across both headerRow and prevRow
  const maxCols = Math.max(headerRow.length, prevRow.length);
  const startSearch = Math.max(tacheColIdx + 1, 0);

  let anchorStart: Date | null = null;
  let lastWeekStart: Date | null = null;

  // Detect if SEMAINE headers sit in prevRow (PROD Row 6 = index 5, while PHASES/TACHES = index 6)
  for (let c = startSearch; c < maxCols; c++) {
    const prevCell = String(prevRow[c] ?? "").trim();
    const curCell = String(headerRow[c] ?? "").trim();
    const semaineMatch =
      /^(?:SEMAINE|S)\s*(\d+)$/i.exec(prevCell) ??
      /^(?:SEMAINE|S)\s*(\d+)$/i.exec(curCell);

    if (semaineMatch) {
      const weekNum = Number.parseInt(semaineMatch[1], 10);
      // Determine block width: distance to next SEMAINE header or 1 if adjacent
      let nextCol = c + 1;
      while (nextCol < maxCols) {
        const pNext = String(prevRow[nextCol] ?? "").trim();
        const cNext = String(headerRow[nextCol] ?? "").trim();
        if (
          /^(?:SEMAINE|S)\s*\d+$/i.test(pNext) ||
          /^(?:SEMAINE|S)\s*\d+$/i.test(cNext)
        ) {
          break;
        }
        nextCol++;
      }
      const width = nextCol < maxCols ? Math.max(1, nextCol - c) : c > startSearch && blocks.length > 0 ? blocks[blocks.length - 1].colWidth : 1;

      const parsedRange = parseDdMmPair(curCell, defaultYear) ?? parseDdMmPair(prevCell, defaultYear);
      let weekStart: Date;
      let weekEnd: Date;

      if (anchorStart && blocks.length > 0) {
        // Resilient progression immune to PROD Row 7 date typos (e.g. S10 "24/07 au 30/08", S19 "26/10 au 01/10")
        const expectedStart = addUtcDays(anchorStart, (weekNum - 1) * 7);
        if (
          parsedRange &&
          parsedRange.end.getTime() >= parsedRange.start.getTime() &&
          (!lastWeekStart || parsedRange.start.getTime() > lastWeekStart.getTime()) &&
          Math.abs(parsedRange.start.getTime() - expectedStart.getTime()) <= 2 * 86_400_000
        ) {
          weekStart = parsedRange.start;
          weekEnd = addUtcDays(weekStart, 6);
        } else {
          weekStart = expectedStart;
          weekEnd = addUtcDays(weekStart, 6);
        }
      } else if (parsedRange) {
        weekStart = parsedRange.start;
        weekEnd = addUtcDays(weekStart, 6);
        if (weekNum === 1) {
          anchorStart = weekStart;
        } else {
          anchorStart = addUtcDays(weekStart, -((weekNum - 1) * 7));
        }
      } else {
        // Fallback default Monday anchor
        anchorStart = anchorStart ?? new Date(Date.UTC(defaultYear, 5, 22, 12, 0, 0, 0));
        weekStart = addUtcDays(anchorStart, (weekNum - 1) * 7);
        weekEnd = addUtcDays(weekStart, 6);
      }

      lastWeekStart = weekStart;
      blocks.push({
        weekNumber: weekNum,
        startCol: c,
        colWidth: width,
        startDate: weekStart,
        endDate: weekEnd,
      });

      if (width > 1) {
        c += width - 1;
      }
    } else if (parseDdMmPair(curCell, defaultYear)) {
      const parsed = parseDdMmPair(curCell, defaultYear)!;
      const weekNum = blocks.length + 1;
      blocks.push({
        weekNumber: weekNum,
        startCol: c,
        colWidth: 1,
        startDate: parsed.start,
        endDate: parsed.end,
      });
    }
  }

  return blocks;
}

export function discoverLayoutFromValues(
  rows: unknown[][],
  sheetId: number | null = null
): SheetColumnLayout {
  let headerRowIdx0 = -1;
  let colMap = {
    id: null as number | null,
    phase: 0,
    etape: 1,
    tache: 2,
    owner: null as number | null,
    startDate: null as number | null,
    endDate: null as number | null,
    status: null as number | null,
    isMilestone: null as number | null,
    milestoneType: null as number | null,
  };

  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r] ?? [];
    const normalized = row.map(normalizeHeader);
    const phaseIdx = normalized.findIndex((h) => h === "PHASES" || h === "PHASE");
    const tacheIdx = normalized.findIndex((h) => h === "TACHES" || h === "TACHE");
    if (phaseIdx !== -1 && tacheIdx !== -1) {
      headerRowIdx0 = r;
      const etapeIdx = normalized.findIndex((h) => h === "ETAPES" || h === "ETAPE");
      const idIdx = normalized.findIndex((h) => h === "ID" || h === "TASK_ID");
      const ownerIdx = normalized.findIndex((h) => h === "OWNER" || h === "RESPONSABLE");
      const startIdx = normalized.findIndex(
        (h) => h === "DEBUT" || h === "START" || h === "STARTDATE" || h === "START_DATE"
      );
      const endIdx = normalized.findIndex(
        (h) => h === "FIN" || h === "END" || h === "ENDDATE" || h === "END_DATE"
      );
      const statusIdx = normalized.findIndex(
        (h) => h === "STATUT" || h === "STATUS"
      );
      const milestoneIdx = normalized.findIndex(
        (h) => h === "JALON" || h === "ISMILESTONE" || h === "IS_MILESTONE"
      );
      const milestoneTypeIdx = normalized.findIndex(
        (h) => h === "TYPE_JALON" || h === "MILESTONETYPE" || h === "MILESTONE_TYPE"
      );

      colMap = {
        id: idIdx !== -1 ? idIdx : null,
        phase: phaseIdx,
        etape: etapeIdx !== -1 ? etapeIdx : phaseIdx + 1,
        tache: tacheIdx,
        owner: ownerIdx !== -1 ? ownerIdx : null,
        startDate: startIdx !== -1 ? startIdx : null,
        endDate: endIdx !== -1 ? endIdx : null,
        status: statusIdx !== -1 ? statusIdx : null,
        isMilestone: milestoneIdx !== -1 ? milestoneIdx : null,
        milestoneType: milestoneTypeIdx !== -1 ? milestoneTypeIdx : null,
      };
      break;
    }
  }

  if (headerRowIdx0 === -1) {
    // Empty or uninitialized value sheet -> reserve Row 1, put headers on Row 2, data from Row 3
    return {
      headerRowIndex1Based: 2,
      colMap: {
        id: 0,
        phase: 1,
        etape: 2,
        tache: 3,
        owner: 4,
        startDate: 5,
        endDate: 6,
        status: 7,
        isMilestone: 8,
        milestoneType: 9,
      },
      weekBlocks: [],
      nextEmptyRow1Based: Math.max(3, rows.length + 1),
      sheetId,
      isEmptySheet: rows.length === 0,
    };
  }

  const weekBlocks = extractWeekBlocksFromValues(
    rows,
    headerRowIdx0,
    colMap.tache
  );

  // Find last non-empty row after header
  let lastDataIdx0 = headerRowIdx0;
  for (let r = headerRowIdx0 + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.some((cell) => String(cell ?? "").trim().length > 0)) {
      lastDataIdx0 = r;
    }
  }

  return {
    headerRowIndex1Based: headerRowIdx0 + 1,
    colMap,
    weekBlocks,
    nextEmptyRow1Based: lastDataIdx0 + 2,
    sheetId,
    isEmptySheet: false,
  };
}

export function parseParSemaineValues(values: unknown[][]): ParsedSheetTask[] {
  if (!Array.isArray(values) || values.length === 0) return [];
  const layout = discoverLayoutFromValues(values);
  if (layout.isEmptySheet) return [];

  const headerRowIdx0 = layout.headerRowIndex1Based - 1;
  const tasks: ParsedSheetTask[] = [];
  let currentPhase = "";
  let currentEtape = "";

  for (let r = headerRowIdx0 + 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const rawId = layout.colMap.id !== null ? String(row[layout.colMap.id] ?? "").trim() : "";
    const rawPhase = String(row[layout.colMap.phase] ?? "").trim();
    const rawEtape = String(row[layout.colMap.etape] ?? "").trim();
    const rawTache = String(row[layout.colMap.tache] ?? "").trim();

    if (rawPhase) currentPhase = rawPhase;
    if (rawEtape) currentEtape = rawEtape;

    // Handle merged KICK OFF / Point d'Etape / Milestone rows where PHASES is populated and TACHES is empty
    const effectiveTache = rawTache || (rawPhase && !rawEtape ? rawPhase : "");
    if (!effectiveTache) continue;

    const effectivePhase = currentPhase || "Général";
    const effectiveEtape = currentEtape || effectivePhase;

    const owner =
      layout.colMap.owner !== null
        ? String(row[layout.colMap.owner] ?? "").trim() || null
        : null;

    let startDate =
      layout.colMap.startDate !== null
        ? parseStrictCalendarDate(String(row[layout.colMap.startDate] ?? ""))
        : null;
    let endDate =
      layout.colMap.endDate !== null
        ? parseStrictCalendarDate(String(row[layout.colMap.endDate] ?? ""))
        : null;

    let status: RetroStatus =
      (layout.colMap.status !== null
        ? normalizeRetroStatus(String(row[layout.colMap.status] ?? ""))
        : null) ?? "A_FAIRE";

    // Infer dates / inline status from week columns if present
    if ((!startDate || !endDate || layout.colMap.status === null) && layout.weekBlocks.length > 0) {
      let firstBlock: WeekBlockMeta | null = null;
      let lastBlock: WeekBlockMeta | null = null;
      for (const wb of layout.weekBlocks) {
        let marked = false;
        for (let c = wb.startCol; c < wb.startCol + wb.colWidth; c++) {
          const val = String(row[c] ?? "").trim();
          if (val.length > 0) {
            marked = true;
            const inferredStatus = parseWeekCellStatus(val);
            if (inferredStatus) {
              status = inferredStatus;
            }
          }
        }
        if (marked) {
          if (!firstBlock) firstBlock = wb;
          lastBlock = wb;
        }
      }
      if (!startDate && firstBlock) startDate = firstBlock.startDate;
      if (!endDate && lastBlock) endDate = lastBlock.endDate;
    }

    const milestoneFlagRaw =
      layout.colMap.isMilestone !== null
        ? String(row[layout.colMap.isMilestone] ?? "").trim().toUpperCase()
        : "";
    const milestoneTypeRaw =
      layout.colMap.milestoneType !== null
        ? String(row[layout.colMap.milestoneType] ?? "").trim().toUpperCase()
        : "";

    const inferredM = inferMilestoneFromText(effectiveTache);
    const isMilestone =
      milestoneFlagRaw === "OUI" ||
      milestoneFlagRaw === "TRUE" ||
      milestoneFlagRaw === "1" ||
      inferredM.isMilestone;
    const validTypes: readonly string[] = ["INFLUENCE", "LANCEMENT_MAP", "WEEKLY", "CUSTOM"];
    const milestoneType = (
      validTypes.includes(milestoneTypeRaw)
        ? milestoneTypeRaw
        : isMilestone
          ? inferredM.milestoneType ?? "CUSTOM"
          : null
    ) as MilestoneType | null;

    tasks.push({
      ...(rawId ? { id: rawId } : {}),
      phase: effectivePhase,
      etape: effectiveEtape,
      tache: effectiveTache,
      owner,
      startDate,
      endDate,
      status,
      sheetRowIndex: r + 1,
      isMilestone,
      milestoneType,
    });
  }

  return tasks;
}

interface GridCellData {
  formattedValue?: string;
  effectiveFormat?: {
    backgroundColor?: { red?: number; green?: number; blue?: number };
  };
}

interface GridRowData {
  values?: GridCellData[];
}

export function parseParSemaineGridData(
  spreadsheet: Record<string, unknown>
): { tasks: ParsedSheetTask[]; sheetId: number | null; layout: SheetColumnLayout } | null {
  const sheets = Array.isArray(spreadsheet.sheets)
    ? (spreadsheet.sheets as Array<Record<string, unknown>>)
    : [];
  if (sheets.length === 0) return null;

  const targetSheet =
    sheets.find(
      (s) =>
        typeof (s.properties as { title?: string } | undefined)?.title === "string" &&
        (s.properties as { title: string }).title.trim().toLowerCase() ===
          RETRO_SHEET_TAB.toLowerCase()
    ) ?? sheets[0];

  const sheetId =
    typeof (targetSheet.properties as { sheetId?: number } | undefined)?.sheetId ===
    "number"
      ? (targetSheet.properties as { sheetId: number }).sheetId
      : null;

  const dataBlocks = Array.isArray(targetSheet.data)
    ? (targetSheet.data as Array<{ rowData?: GridRowData[] }>)
    : [];
  const rowData = dataBlocks[0]?.rowData;
  if (!Array.isArray(rowData) || rowData.length === 0) {
    return null;
  }

  // Convert formattedValues to 2D matrix to discover headers and week blocks
  const valuesMatrix: unknown[][] = rowData.map((r) =>
    (r.values ?? []).map((cell) => cell.formattedValue ?? "")
  );

  const layout = discoverLayoutFromValues(valuesMatrix, sheetId);
  if (layout.isEmptySheet) return null;

  // If explicit startDate/endDate/status columns exist in valuesMatrix, prefer value parser
  if (layout.colMap.startDate !== null && layout.colMap.endDate !== null) {
    return {
      tasks: parseParSemaineValues(valuesMatrix),
      sheetId,
      layout,
    };
  }

  const headerRowIdx0 = layout.headerRowIndex1Based - 1;
  const tasks: ParsedSheetTask[] = [];
  let currentPhase = "";
  let currentEtape = "";

  for (let r = headerRowIdx0 + 1; r < rowData.length; r++) {
    const cells = rowData[r]?.values ?? [];
    const getText = (colIdx: number | null) =>
      colIdx !== null && colIdx >= 0 ? String(cells[colIdx]?.formattedValue ?? "").trim() : "";

    const rawId = getText(layout.colMap.id);
    const rawPhase = getText(layout.colMap.phase);
    const rawEtape = getText(layout.colMap.etape);
    const rawTache = getText(layout.colMap.tache);

    if (rawPhase) currentPhase = rawPhase;
    if (rawEtape) currentEtape = rawEtape;

    const effectiveTache = rawTache || (rawPhase && !rawEtape ? rawPhase : "");
    if (!effectiveTache) continue;

    const effectivePhase = currentPhase || "Général";
    const effectiveEtape = currentEtape || effectivePhase;

    const owner = getText(layout.colMap.owner) || null;
    let status: RetroStatus =
      normalizeRetroStatus(getText(layout.colMap.status)) ?? "A_FAIRE";

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (layout.weekBlocks.length > 0) {
      let firstBlock: WeekBlockMeta | null = null;
      let lastBlock: WeekBlockMeta | null = null;

      for (const wb of layout.weekBlocks) {
        let blockActive = false;
        const scanEnd = Math.min(wb.startCol + wb.colWidth, cells.length);
        // Check weekday columns (first 5 cols in 7-col block, or all cols if width <= 5)
        const activeSpan = wb.colWidth >= 7 ? wb.startCol + 5 : scanEnd;

        for (let c = wb.startCol; c < Math.min(activeSpan, cells.length); c++) {
          const cell = cells[c];
          const text = String(cell?.formattedValue ?? "").trim();
          const bgHex = rgbToHex(cell?.effectiveFormat?.backgroundColor);

          if (text.length > 0) {
            blockActive = true;
            const textStatus = parseWeekCellStatus(text);
            if (textStatus) status = textStatus;
          }
          if (!isNeutralFill(bgHex)) {
            blockActive = true;
            if (bgHex === "#0B5394" && status === "A_FAIRE") {
              status = "EN_ATTENTE_CLIENT";
            } else if (bgHex === "#93C47D" && status === "A_FAIRE") {
              status = "TERMINE";
            }
          }
        }

        if (blockActive) {
          if (!firstBlock) firstBlock = wb;
          lastBlock = wb;
        }
      }

      if (firstBlock) startDate = firstBlock.startDate;
      if (lastBlock) {
        endDate =
          lastBlock.colWidth >= 7
            ? addUtcDays(lastBlock.startDate, 4) // Friday of week block
            : lastBlock.endDate;
      }
    }

    const inferredM = inferMilestoneFromText(effectiveTache);
    tasks.push({
      ...(rawId ? { id: rawId } : {}),
      phase: effectivePhase,
      etape: effectiveEtape,
      tache: effectiveTache,
      owner,
      startDate,
      endDate,
      status,
      sheetRowIndex: r + 1,
      isMilestone: inferredM.isMilestone,
      milestoneType: inferredM.milestoneType,
    });
  }

  return { tasks, sheetId, layout };
}

export async function readTasksFromRetroSheet(
  sheets: SheetsPort,
  spreadsheetId: string
): Promise<{ tasks: ParsedSheetTask[]; layout: SheetColumnLayout }> {
  const [spreadsheetRes, valuesRes] = await Promise.all([
    sheets
      .getSpreadsheet({
        spreadsheetId,
        ranges: [RETRO_SHEET_TAB],
        includeGridData: true,
      })
      .catch(() => ({})),
    sheets
      .getValues({
        spreadsheetId,
        range: `'${RETRO_SHEET_TAB}'!A1:ZZ250`,
      })
      .catch(() => [] as unknown[][]),
  ]);

  const parsedGrid = parseParSemaineGridData(spreadsheetRes);
  if (parsedGrid && parsedGrid.tasks.length > 0) {
    return { tasks: parsedGrid.tasks, layout: parsedGrid.layout };
  }

  const layout = discoverLayoutFromValues(valuesRes, parsedGrid?.sheetId ?? null);
  const tasks = parseParSemaineValues(valuesRes);
  return { tasks, layout };
}

export async function writeTaskToRetroSheet(
  sheets: SheetsPort,
  spreadsheetId: string,
  task: RetroTask
): Promise<{ sheetRowIndex: number }> {
  const [valuesRes, spreadsheetRes] = await Promise.all([
    sheets
      .getValues({
        spreadsheetId,
        range: `'${RETRO_SHEET_TAB}'!A1:ZZ250`,
      })
      .catch(() => [] as unknown[][]),
    sheets
      .getSpreadsheet({
        spreadsheetId,
        ranges: [RETRO_SHEET_TAB],
        includeGridData: false,
      })
      .catch(() => ({})),
  ]);

  let sheetId: number | null = null;
  if (Array.isArray((spreadsheetRes as { sheets?: unknown[] }).sheets)) {
    const sList = (spreadsheetRes as { sheets: Array<{ properties?: { title?: string; sheetId?: number } }> }).sheets;
    const match =
      sList.find(
        (s) =>
          s.properties?.title?.trim().toLowerCase() ===
          RETRO_SHEET_TAB.toLowerCase()
      ) ?? sList[0];
    if (typeof match?.properties?.sheetId === "number") {
      sheetId = match.properties.sheetId;
    }
  }

  const layout = discoverLayoutFromValues(valuesRes, sheetId);

  // Initialize header on Row 2 (never touching Row 1) if the sheet has no headers yet
  if (layout.isEmptySheet) {
    await sheets.updateValues({
      spreadsheetId,
      range: `'${RETRO_SHEET_TAB}'!A2:J2`,
      values: [
        [
          "ID",
          "PHASES",
          "ÉTAPES",
          "TACHES",
          "OWNER",
          "DÉBUT",
          "FIN",
          "STATUT",
          "JALON",
          "TYPE_JALON",
        ],
      ],
      valueInputOption: "USER_ENTERED",
    });
  }

  const startIso = toIsoDateOnly(task.startDate) ?? "";
  const endIso = toIsoDateOnly(task.endDate) ?? "";

  // Determine target row (update existing row if known or matched by ID/tache, else append)
  let targetRow1Based = task.sheetRowIndex ?? null;
  if (!targetRow1Based && !layout.isEmptySheet) {
    const headerIdx0 = layout.headerRowIndex1Based - 1;
    for (let r = headerIdx0 + 1; r < valuesRes.length; r++) {
      const row = valuesRes[r] ?? [];
      const rowId =
        layout.colMap.id !== null ? String(row[layout.colMap.id] ?? "").trim() : "";
      const rowTache = String(row[layout.colMap.tache] ?? "").trim();
      if ((rowId && rowId === task.id) || (rowTache && rowTache === task.tache)) {
        targetRow1Based = r + 1;
        break;
      }
    }
  }

  // Build row array preserving column alignment
  const maxWeekCol =
    layout.weekBlocks.length > 0
      ? layout.weekBlocks[layout.weekBlocks.length - 1].startCol +
        layout.weekBlocks[layout.weekBlocks.length - 1].colWidth -
        1
      : 0;
  const maxColIndex = Math.max(
    9,
    layout.colMap.phase,
    layout.colMap.etape,
    layout.colMap.tache,
    layout.colMap.owner ?? 0,
    layout.colMap.startDate ?? 0,
    layout.colMap.endDate ?? 0,
    layout.colMap.status ?? 0,
    maxWeekCol
  );

  const rowValues: string[] = Array.from({ length: maxColIndex + 1 }, () => "");
  if (layout.colMap.id !== null) rowValues[layout.colMap.id] = task.id;
  rowValues[layout.colMap.phase] = task.phase;
  rowValues[layout.colMap.etape] = task.etape ?? "";
  rowValues[layout.colMap.tache] = task.tache;
  if (layout.colMap.owner !== null) {
    rowValues[layout.colMap.owner] = task.owner ?? "";
  }
  if (layout.colMap.startDate !== null) {
    rowValues[layout.colMap.startDate] = startIso;
  }
  if (layout.colMap.endDate !== null) {
    rowValues[layout.colMap.endDate] = endIso;
  }
  if (layout.colMap.status !== null) {
    rowValues[layout.colMap.status] = task.status;
  }
  if (layout.colMap.isMilestone !== null) {
    rowValues[layout.colMap.isMilestone] = task.isMilestone ? "OUI" : "NON";
  }
  if (layout.colMap.milestoneType !== null) {
    rowValues[layout.colMap.milestoneType] = task.milestoneType ?? "";
  }

  // Also ensure status & dates appear in trailing metadata columns if PROD layout lacks explicit start/end/status columns
  if (layout.colMap.status === null && layout.weekBlocks.length === 0) {
    rowValues[4] = task.owner ?? "";
    rowValues[5] = startIso;
    rowValues[6] = endIso;
    rowValues[7] = task.status;
  }

  // Mark overlapping week blocks with "x" (or status marker in first overlapping block if PROD layout)
  if (layout.weekBlocks.length > 0 && task.startDate && task.endDate) {
    const taskStartMs = parseStrictCalendarDate(startIso)?.getTime() ?? 0;
    const taskEndMs = parseStrictCalendarDate(endIso)?.getTime() ?? 0;
    let markedFirst = false;

    for (const wb of layout.weekBlocks) {
      const overlaps =
        wb.startDate.getTime() <= taskEndMs &&
        wb.endDate.getTime() >= taskStartMs;
      if (overlaps) {
        if (!markedFirst && layout.colMap.status === null) {
          rowValues[wb.startCol] = `${task.status} (${startIso} -> ${endIso})`;
          markedFirst = true;
        } else {
          rowValues[wb.startCol] = "x";
        }
      }
    }
  }

  const endColLetter = indexToColumnLetter(rowValues.length - 1);

  if (targetRow1Based && targetRow1Based >= 2) {
    const range = `'${RETRO_SHEET_TAB}'!A${targetRow1Based}:${endColLetter}${targetRow1Based}`;
    await sheets.updateValues({
      spreadsheetId,
      range,
      values: [rowValues],
      valueInputOption: "USER_ENTERED",
    });

    // If PROD layout has sheetId + weekBlocks, also paint colored Gantt bars via batchUpdate
    if (sheetId !== null && layout.weekBlocks.length > 0 && task.startDate && task.endDate) {
      await applyWeekBlockColors(
        sheets,
        spreadsheetId,
        sheetId,
        targetRow1Based - 1,
        layout.weekBlocks,
        task
      ).catch(() => {
        // Non-fatal if double/mock doesn't implement rich formatting
      });
    }

    return { sheetRowIndex: targetRow1Based };
  }

  const insertRow1Based = Math.max(
    layout.isEmptySheet ? 3 : layout.headerRowIndex1Based + 1,
    layout.nextEmptyRow1Based
  );
  const appendRange = `'${RETRO_SHEET_TAB}'!A${insertRow1Based}:${endColLetter}${insertRow1Based}`;
  await sheets.appendValues({
    spreadsheetId,
    range: appendRange,
    values: [rowValues],
    valueInputOption: "USER_ENTERED",
  });

  if (sheetId !== null && layout.weekBlocks.length > 0 && task.startDate && task.endDate) {
    await applyWeekBlockColors(
      sheets,
      spreadsheetId,
      sheetId,
      insertRow1Based - 1,
      layout.weekBlocks,
      task
    ).catch(() => {});
  }

  return { sheetRowIndex: insertRow1Based };
}

async function applyWeekBlockColors(
  sheets: SheetsPort,
  spreadsheetId: string,
  sheetId: number,
  rowIndex0: number,
  weekBlocks: WeekBlockMeta[],
  task: RetroTask
): Promise<void> {
  const startIso = toIsoDateOnly(task.startDate);
  const endIso = toIsoDateOnly(task.endDate);
  if (!startIso || !endIso) return;

  const taskStartMs = parseStrictCalendarDate(startIso)?.getTime() ?? 0;
  const taskEndMs = parseStrictCalendarDate(endIso)?.getTime() ?? 0;

  const activeColor =
    task.status === "EN_ATTENTE_CLIENT"
      ? { red: 0.043, green: 0.325, blue: 0.58 } // #0B5394
      : task.status === "TERMINE"
        ? { red: 0.576, green: 0.769, blue: 0.49 } // #93C47D
        : task.isMilestone
          ? { red: 0.8, green: 0, blue: 0 } // #CC0000
          : { red: 0.918, green: 0.82, blue: 0.863 }; // #EAD1DC

  const whiteColor = { red: 1, green: 1, blue: 1 };
  const requests: Record<string, unknown>[] = [];

  for (const wb of weekBlocks) {
    const overlaps =
      wb.startDate.getTime() <= taskEndMs && wb.endDate.getTime() >= taskStartMs;
    const weekdayCols = wb.colWidth >= 7 ? 5 : wb.colWidth;
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowIndex0,
          endRowIndex: rowIndex0 + 1,
          startColumnIndex: wb.startCol,
          endColumnIndex: wb.startCol + weekdayCols,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: overlaps ? activeColor : whiteColor,
          },
        },
        fields: "userEnteredFormat.backgroundColor",
      },
    });
  }

  if (requests.length > 0) {
    await sheets.batchUpdate({ spreadsheetId, requests });
  }
}
