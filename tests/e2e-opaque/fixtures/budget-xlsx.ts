/**
 * Pure-JS OOXML (.xlsx) & ZIP Builder/Inspector + Budget 3-Block Fixtures.
 * Aligned with live-verified PROD Budget Sheet coordinates:
 *  - Tabs: "Vue d'ensemble" & "Postes de dépenses"
 *  - Row 8 blocks: A8 ("Prix de vente"), J8 ("Couts réels pré-opération"), P8 ("Couts réels post-opération")
 *  - Row 11 headers: C:H, J:L, P:S
 *
 * Zero external dependencies (no exceljs, no src/, no prisma/).
 */

import { Buffer } from "node:buffer";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export type XlsxCellValue = string | number | boolean | null;

export interface XlsxSheetSpec {
  name: string;
  rows: XlsxCellValue[][];
}

export interface BudgetFixtureData {
  buffer: Buffer;
  filename: string;
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  expectedSummary: {
    soldTotalHt: number;
    preOpTotalHt: number;
    postOpTotalHt: number;
    plannedMarginHt: number;
    plannedMarginPct: number;
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZipArchive(entries: ReadonlyArray<{ name: string; data: Buffer }>): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const uncompressed = entry.data;
    const compressed = deflateRawSync(uncompressed);
    const checksum = crc32(uncompressed);

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed to extract
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8); // compression method: deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x5421, 12); // mod date
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    localChunks.push(localHeader, nameBuf, compressed);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirBuffer = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirBuffer, eocd]);
}

export function readZipEntries(zipBuffer: Buffer): Map<string, Buffer> {
  if (zipBuffer.length < 22 || zipBuffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("Invalid ZIP archive: missing PK\\x03\\x04 signature");
  }

  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65557); i -= 1) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("Invalid ZIP archive: EOCD not found");
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  let cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const result = new Map<string, Buffer>();

  for (let i = 0; i < totalEntries; i += 1) {
    if (zipBuffer.readUInt32LE(cdOffset) !== 0x02014b50) {
      throw new Error(`Invalid central directory header at ${cdOffset}`);
    }
    const method = zipBuffer.readUInt16LE(cdOffset + 10);
    const compressedSize = zipBuffer.readUInt32LE(cdOffset + 20);
    const nameLen = zipBuffer.readUInt16LE(cdOffset + 28);
    const extraLen = zipBuffer.readUInt16LE(cdOffset + 30);
    const commentLen = zipBuffer.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(cdOffset + 42);
    const name = zipBuffer.toString("utf8", cdOffset + 46, cdOffset + 46 + nameLen);

    if (zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid local file header at ${localHeaderOffset}`);
    }
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawSlice = zipBuffer.subarray(dataStart, dataStart + compressedSize);

    let fileData: Buffer;
    if (method === 0) {
      fileData = Buffer.from(rawSlice);
    } else if (method === 8) {
      fileData = inflateRawSync(rawSlice);
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    }

    result.set(name, fileData);
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }

  return result;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function colIndexToLetter(colIdxZeroBased: number): string {
  let n = colIdxZeroBased + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function colLetterToIndex(colLetters: string): number {
  let idx = 0;
  for (let i = 0; i < colLetters.length; i += 1) {
    idx = idx * 26 + (colLetters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

export function buildXlsxWorkbook(sheets: readonly XlsxSheetSpec[]): Buffer {
  if (sheets.length === 0) {
    throw new Error("buildXlsxWorkbook requires at least one sheet");
  }

  const sharedStrings: string[] = [];
  const sharedStringIndex = new Map<string, number>();

  const internString = (val: string): number => {
    const existing = sharedStringIndex.get(val);
    if (existing !== undefined) {
      return existing;
    }
    const idx = sharedStrings.length;
    sharedStrings.push(val);
    sharedStringIndex.set(val, idx);
    return idx;
  };

  const worksheetEntries: Array<{ name: string; data: Buffer }> = [];

  for (let sIdx = 0; sIdx < sheets.length; sIdx += 1) {
    const sheet = sheets[sIdx];
    const rowXmlParts: string[] = [];

    for (let rIdx = 0; rIdx < sheet.rows.length; rIdx += 1) {
      const row = sheet.rows[rIdx];
      const cellXmlParts: string[] = [];
      for (let cIdx = 0; cIdx < row.length; cIdx += 1) {
        const val = row[cIdx];
        if (val === null || val === undefined) {
          continue;
        }
        const ref = `${colIndexToLetter(cIdx)}${rIdx + 1}`;
        if (typeof val === "number") {
          cellXmlParts.push(`<c r="${ref}"><v>${Number.isFinite(val) ? val : 0}</v></c>`);
        } else if (typeof val === "boolean") {
          cellXmlParts.push(`<c r="${ref}" t="b"><v>${val ? 1 : 0}</v></c>`);
        } else {
          const strIdx = internString(String(val));
          cellXmlParts.push(`<c r="${ref}" t="s"><v>${strIdx}</v></c>`);
        }
      }
      if (cellXmlParts.length > 0) {
        rowXmlParts.push(`<row r="${rIdx + 1}">${cellXmlParts.join("")}</row>`);
      }
    }

    const sheetXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData>${rowXmlParts.join("")}</sheetData>` +
      `</worksheet>`;

    worksheetEntries.push({
      name: `xl/worksheets/sheet${sIdx + 1}.xml`,
      data: Buffer.from(sheetXml, "utf8"),
    });
  }

  const contentTypeOverrides = sheets
    .map(
      (_s, idx) =>
        `<Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("");

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    contentTypeOverrides +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookSheetsXml = sheets
    .map(
      (s, idx) =>
        `<sheet name="${escapeXml(s.name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`
    )
    .join("");

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${workbookSheetsXml}</sheets>` +
    `</workbook>`;

  const sheetRelsXml = sheets
    .map(
      (_s, idx) =>
        `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`
    )
    .join("");

  const workbookRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheetRelsXml +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`;

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
    `</styleSheet>`;

  const sharedStringsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` +
    sharedStrings.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join("") +
    `</sst>`;

  return buildZipArchive([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(stylesXml, "utf8") },
    { name: "xl/sharedStrings.xml", data: Buffer.from(sharedStringsXml, "utf8") },
    ...worksheetEntries,
  ]);
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(xml)) !== null) {
    const inner = siMatch[1];
    const tParts: string[] = [];
    const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(inner)) !== null) {
      tParts.push(unescapeXml(tMatch[1]));
    }
    strings.push(tParts.join(""));
  }
  return strings;
}

function parseWorksheetRows(xml: string, sharedStrings: readonly string[]): string[][] {
  const rowMap = new Map<number, Map<number, string>>();
  let maxRow = 0;

  const rowRegex = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowAttrs = rowMatch[1];
    const rowBody = rowMatch[2];
    if (rowBody === undefined) continue;

    const rowNumMatch = /\br="(\d+)"/.exec(rowAttrs);
    if (!rowNumMatch) continue;
    const rowNum = Number.parseInt(rowNumMatch[1], 10);
    if (rowNum > maxRow) maxRow = rowNum;
    const cells = rowMap.get(rowNum) ?? new Map<number, string>();

    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowBody)) !== null) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      if (body === undefined) continue;
      const refMatch = /\br="([A-Z]+)\d+"/.exec(attrs);
      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      if (!refMatch) continue;

      const colIdx = colLetterToIndex(refMatch[1]);
      const cellType = typeMatch ? typeMatch[1] : "";
      let valueText = "";

      if (cellType === "inlineStr") {
        const tMatch = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
        valueText = tMatch ? unescapeXml(tMatch[1]) : "";
      } else {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
        const rawV = vMatch ? unescapeXml(vMatch[1]) : "";
        if (cellType === "s") {
          const idx = Number.parseInt(rawV, 10);
          valueText = Number.isFinite(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : "";
        } else {
          valueText = rawV;
        }
      }
      cells.set(colIdx, valueText);
    }

    rowMap.set(rowNum, cells);
  }

  const rows: string[][] = [];
  for (let r = 1; r <= maxRow; r += 1) {
    const cells = rowMap.get(r);
    if (!cells || cells.size === 0) {
      rows.push([]);
      continue;
    }
    const maxCol = Math.max(...cells.keys());
    const arr: string[] = Array.from({ length: maxCol + 1 }, () => "");
    for (const [c, v] of cells.entries()) {
      arr[c] = v;
    }
    rows.push(arr);
  }
  return rows;
}

export function inspectXlsxWorkbook(xlsxBuffer: Buffer): {
  sheetNames: string[];
  sheets: Record<string, string[][]>;
} {
  const entries = readZipEntries(xlsxBuffer);
  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8") ?? "";
  if (!workbookXml) {
    throw new Error("Invalid .xlsx workbook: xl/workbook.xml missing");
  }

  const sharedStringsXml = entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];

  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relTargets = new Map<string, string>();
  const relRegex = /<Relationship\b([^>]+)\/>/g;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relRegex.exec(relsXml)) !== null) {
    const idM = /\bId="([^"]+)"/.exec(relMatch[1]);
    const targetM = /\bTarget="([^"]+)"/.exec(relMatch[1]);
    if (idM && targetM) {
      const normalized = targetM[1].startsWith("/") ? targetM[1].slice(1) : `xl/${targetM[1].replace(/^xl\//, "")}`;
      relTargets.set(idM[1], normalized);
    }
  }

  const sheetNames: string[] = [];
  const sheets: Record<string, string[][]> = {};
  const sheetTagRegex = /<sheet\b([^>]+)\/>/g;
  let sheetMatch: RegExpExecArray | null;
  let sheetOrder = 1;

  while ((sheetMatch = sheetTagRegex.exec(workbookXml)) !== null) {
    const attrs = sheetMatch[1];
    const nameM = /\bname="([^"]+)"/.exec(attrs);
    const rIdM = /\br:id="([^"]+)"/.exec(attrs);
    if (!nameM) continue;

    const name = unescapeXml(nameM[1]);
    sheetNames.push(name);

    const targetPath = (rIdM && relTargets.get(rIdM[1])) ?? `xl/worksheets/sheet${sheetOrder}.xml`;
    const sheetXml = entries.get(targetPath)?.toString("utf8") ?? "";
    sheets[name] = sheetXml ? parseWorksheetRows(sheetXml, sharedStrings) : [];
    sheetOrder += 1;
  }

  return { sheetNames, sheets };
}

function makeEmptyRow(length = 20): XlsxCellValue[] {
  return Array.from({ length }, () => null);
}

/**
 * Helper to place a Budget line into exact PROD Row 11+ coordinates:
 * - C(2): Objet, D(3): Réalisé par, E(4): Quantité, F(5): Jours, G(6): Coût/u, H(7): Prix (€)
 * - J(9): Type de dépenses, K(10): Coût réel/u (€), L(11): Coût réel (€)
 * - P(15): Qté, Q(16): Jours, R(17): Coût réel/u (€), S(18): Coût réel (€)
 */
function buildPosteRow(opts: {
  objet: string;
  realisePar: string;
  saleQty: number;
  saleDays: number;
  saleUnit: number;
  saleTotal: number;
  expenseType: string;
  preOpUnit: number;
  preOpTotal: number;
  postOpQty?: number | null;
  postOpDays?: number | null;
  postOpUnit?: number | null;
  postOpTotal?: number | null;
}): XlsxCellValue[] {
  const row = makeEmptyRow(20);
  row[2] = opts.objet;
  row[3] = opts.realisePar;
  row[4] = opts.saleQty;
  row[5] = opts.saleDays;
  row[6] = opts.saleUnit;
  row[7] = opts.saleTotal;
  row[9] = opts.expenseType;
  row[10] = opts.preOpUnit;
  row[11] = opts.preOpTotal;
  row[15] = opts.postOpQty ?? 0;
  row[16] = opts.postOpDays ?? 0;
  row[17] = opts.postOpUnit ?? 0;
  row[18] = opts.postOpTotal ?? 0;
  return row;
}

export function buildPilot326027BudgetXlsx(codeProjet = "326027"): BudgetFixtureData {
  const soldTotalHt = 12000;
  const preOpTotalHt = 7000;
  const postOpTotalHt = 0;
  const plannedMarginHt = soldTotalHt - preOpTotalHt;
  const plannedMarginPct = Number(((plannedMarginHt / soldTotalHt) * 100).toFixed(2));

  const vueEnsembleRows: XlsxCellValue[][] = [
    ["Caisse d'Épargne x Fortnite", null, null, null],
    ["Année :", 2026, "Code projet :", codeProjet],
    ["Chef de projet :", "Hugo Debôves", null, null],
    [],
    ["Résumé", null, null, null],
    ["Budget", soldTotalHt, null, null],
    ["Coûts externes", preOpTotalHt, null, null],
    ["MARGE BRUTE (€)", plannedMarginHt, null, null],
    ["MARGE BRUTE (%)", plannedMarginPct, null, null],
    ["Ressources humaines internes", 0, null, null],
    ["Amortissement matériel", 0, null, null],
    ["MARGE NETTE (€)", plannedMarginHt, null, null],
    ["MARGE NETTE (%)", plannedMarginPct, null, null],
    [],
    ["Comparatif post opé", null, null, null],
    ["Couts externes pré-opération", preOpTotalHt, null, null],
    ["Couts réel externes post-opé", postOpTotalHt, null, null],
    ["DIFFERENCE (€)", preOpTotalHt - postOpTotalHt, null, null],
  ];

  // Rows 1..7 (indices 0..6) metadata spacer
  const postesRows: XlsxCellValue[][] = [
    ["Budget : Caisse d'Épargne - Fortnite", null, "Code projet :", codeProjet],
    [],
    [],
    [],
    [],
    [],
    [],
  ];

  // Row 8 (index 7): Exact 3-block headers at A8 (0), J8 (9), P8 (15)
  const row8 = makeEmptyRow(20);
  row8[0] = "Prix de vente";
  row8[9] = "Couts réels pré-opération";
  row8[15] = "Couts réels post-opération";
  postesRows.push(row8);

  // Rows 9..10 (indices 8..9)
  postesRows.push([], []);

  // Row 11 (index 10): Exact column headers C:H, J:L, P:S
  const row11 = makeEmptyRow(20);
  row11[2] = "Objet";
  row11[3] = "Réalisé par";
  row11[4] = "Quantité";
  row11[5] = "Jours";
  row11[6] = "Coût/ unité (€)";
  row11[7] = "Prix (€)";
  row11[9] = "Type de dépenses";
  row11[10] = "Coût réel/u (€)";
  row11[11] = "Coût réel (€)";
  row11[15] = "Qté";
  row11[16] = "Jours";
  row11[17] = "Coût réel/u (€)";
  row11[18] = "Coût réel (€)";
  postesRows.push(row11);

  // Category 1 + Line 1
  postesRows.push([null, null, "CRÉATION DE LA CARTE DANS FORTNITE"]);
  postesRows.push(
    buildPosteRow({
      objet: "Mapping & HUD Fortnite",
      realisePar: "Vertigo Studio",
      saleQty: 1,
      saleDays: 10,
      saleUnit: 1000,
      saleTotal: 10000,
      expenseType: "Externe",
      preOpUnit: 600,
      preOpTotal: 6000,
    })
  );

  // Category 2 + Line 2
  postesRows.push([null, null, "CONCEPTION DE LA CHARTE GRAPHIQUE ET CRÉATION DES ÉLÉMENTS VISUELS ET VIDÉOS"]);
  postesRows.push(
    buildPosteRow({
      objet: "DA / Charte graphique",
      realisePar: "Agency Alpha",
      saleQty: 1,
      saleDays: 4,
      saleUnit: 500,
      saleTotal: 2000,
      expenseType: "Externe",
      preOpUnit: 250,
      preOpTotal: 1000,
    })
  );

  // Category 3 + Zero Pre-Op edge case line
  postesRows.push([null, null, "FRAIS DIVERS AUTOUR DE L'EXPÉRIENCE"]);
  postesRows.push(
    buildPosteRow({
      objet: "Matériel",
      realisePar: "Interne GO",
      saleQty: 1,
      saleDays: 1,
      saleUnit: 0,
      saleTotal: 0,
      expenseType: "Amortissement",
      preOpUnit: 0,
      preOpTotal: 0,
    })
  );

  const buffer = buildXlsxWorkbook([
    { name: "Vue d'ensemble", rows: vueEnsembleRows },
    { name: "Postes de dépenses", rows: postesRows },
  ]);

  return {
    buffer,
    filename: `Budget_CE_Fortnite_${codeProjet}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    expectedSummary: {
      soldTotalHt,
      preOpTotalHt,
      postOpTotalHt,
      plannedMarginHt,
      plannedMarginPct,
    },
  };
}

export function buildZeroPreOpBudgetXlsx(codeProjet = "326027"): Buffer {
  const row8 = makeEmptyRow(20);
  row8[0] = "Prix de vente";
  row8[9] = "Couts réels pré-opération";
  row8[15] = "Couts réels post-opération";

  const row11 = makeEmptyRow(20);
  row11[2] = "Objet";
  row11[3] = "Réalisé par";
  row11[4] = "Quantité";
  row11[5] = "Jours";
  row11[6] = "Coût/ unité (€)";
  row11[7] = "Prix (€)";
  row11[9] = "Type de dépenses";
  row11[10] = "Coût réel/u (€)";
  row11[11] = "Coût réel (€)";
  row11[15] = "Qté";
  row11[16] = "Jours";
  row11[17] = "Coût réel/u (€)";
  row11[18] = "Coût réel (€)";

  return buildXlsxWorkbook([
    {
      name: "Vue d'ensemble",
      rows: [["Caisse d'Épargne x Fortnite"], ["Code projet :", codeProjet]],
    },
    {
      name: "Postes de dépenses",
      rows: [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        row8,
        [],
        [],
        row11,
        [null, null, "CONCEPTION DE LA CHARTE GRAPHIQUE ET CRÉATION DES ÉLÉMENTS VISUELS ET VIDÉOS"],
        buildPosteRow({
          objet: "Visuels Print",
          realisePar: "Print Partner",
          saleQty: 1,
          saleDays: 1,
          saleUnit: 3500,
          saleTotal: 3500,
          expenseType: "Externe",
          preOpUnit: 0,
          preOpTotal: 0,
          postOpQty: 1,
          postOpDays: 1,
          postOpUnit: 2672,
          postOpTotal: 2672,
        }),
      ],
    },
  ]);
}

export function buildMalformedBudgetXlsx(): Buffer {
  return Buffer.from("NOT_A_VALID_XLSX_ZIP_FILE_CORRUPTED", "utf8");
}
