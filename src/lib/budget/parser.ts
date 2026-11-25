import ExcelJS from "exceljs";
import { AppHttpError } from "@/lib/errors";
import {
  type NormalizedExpenseType,
  normalizeExpenseType,
  round2,
} from "@/lib/budget/calculator";

export interface ParsedBudgetLine {
  category: string;
  objet: string;
  realisePar: string | null;
  expenseType: NormalizedExpenseType;
  saleQty: number;
  saleDays: number;
  saleUnitPrice: number;
  saleTotalHt: number;
  preOpUnitCost: number;
  preOpTotalHt: number;
  postOpQty: number;
  postOpDays: number;
  postOpUnitCost: number;
  postOpTotalHt: number;
  sheetRowIndex: number;
  invoiceNumbersNote: string | null;
}

export interface BudgetSheetLayout {
  postesSheetTitle: string;
  postesSheetId: number;
  bannerRowIndex: number | null; // 0-based
  headerRowIndex: number; // 0-based
  objetCol: number;
  realiseParCol: number | null;
  saleQtyCol: number | null;
  saleDaysCol: number | null;
  saleUnitCol: number | null;
  saleTotalCol: number;
  expenseTypeCol: number | null;
  preOpUnitCol: number | null;
  preOpTotalCol: number;
  postOpQtyCol: number | null;
  postOpDaysCol: number | null;
  postOpUnitCol: number | null;
  postOpTotalCol: number;
}

export interface ParsedBudgetResult {
  lines: ParsedBudgetLine[];
  warnings: string[];
  layout: BudgetSheetLayout;
  detectedMeta: {
    vueTitle: string | null;
    vueCodeProjet: string | null;
    postesTitle: string | null;
  };
}

export interface BudgetProjectContext {
  codeProjet: string;
  client: string;
  nomJeu: string;
}

interface RawCell {
  value: unknown;
  formula?: string | null;
  note?: string | null;
}

function stripDiacritics(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFrenchNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "boolean") return null;
  if (typeof raw !== "string") return null;

  let s = raw
    .replace(/€/g, "")
    .replace(/\bEUR\b/gi, "")
    .replace(/%/g, "")
    .replace(/[\u00a0\u202f\s]/g, "")
    .trim();

  if (!s || s === "-" || s === "—" || s === "N/A") {
    return null;
  }

  // Handle French/European vs US decimal/thousand separators
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      // e.g. 1.250,50
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // e.g. 1,250.50
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    if (/^-?\d+,\d{1,6}$/.test(s)) {
      s = s.replace(",", ".");
    } else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) {
      s = s.replace(/,/g, "");
    } else {
      s = s.replace(",", ".");
    }
  }

  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    return null;
  }

  const parsed = Number(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function cellToString(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  return "";
}

function colLetterToIndex(col: string): number {
  let idx = 0;
  const upper = col.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    idx = idx * 26 + (upper.charCodeAt(i) - 64);
  }
  return idx - 1;
}

export function colIndexToLetter(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function getNumericCellFromGrid(
  grid: RawCell[][],
  rowIdx: number,
  colIdx: number,
  visited: Set<string>
): number | null {
  if (rowIdx < 0 || rowIdx >= grid.length) return null;
  const row = grid[rowIdx];
  if (!row || colIdx < 0 || colIdx >= row.length) return null;
  const cell = row[colIdx];
  if (!cell) return null;

  const direct = parseFrenchNumber(cell.value);
  if (direct !== null) return direct;

  if (cell.formula) {
    const key = `${rowIdx}:${colIdx}`;
    if (visited.has(key)) return null;
    visited.add(key);
    const evaluated = evaluateSimpleFormula(cell.formula, grid, visited);
    visited.delete(key);
    return evaluated;
  }
  return null;
}

function evaluateArithmeticExpression(expr: string): number | null {
  // Tokenize +, -, *, /, (, ), numbers
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ("+-*/()".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (/[\d.]/.test(ch)) {
      let numStr = "";
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        numStr += expr[i];
        i++;
      }
      tokens.push(numStr);
      continue;
    }
    return null;
  }

  let pos = 0;
  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    while (pos < tokens.length && (tokens[pos] === "+" || tokens[pos] === "-")) {
      const op = tokens[pos++];
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    while (pos < tokens.length && (tokens[pos] === "*" || tokens[pos] === "/")) {
      const op = tokens[pos++];
      const right = parseFactor();
      if (right === null) return null;
      if (op === "/") {
        if (right === 0) return 0;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  function parseFactor(): number | null {
    if (pos >= tokens.length) return null;
    const tok = tokens[pos];
    if (tok === "-") {
      pos++;
      const val = parseFactor();
      return val === null ? null : -val;
    }
    if (tok === "+") {
      pos++;
      return parseFactor();
    }
    if (tok === "(") {
      pos++;
      const val = parseExpr();
      if (val === null || tokens[pos] !== ")") return null;
      pos++;
      return val;
    }
    pos++;
    const num = Number(tok);
    return Number.isFinite(num) ? num : null;
  }

  const res = parseExpr();
  if (res === null || pos !== tokens.length || !Number.isFinite(res)) {
    return null;
  }
  return res;
}

function evaluateSimpleFormula(
  formulaRaw: string,
  grid: RawCell[][],
  visited = new Set<string>()
): number | null {
  const formula = formulaRaw.trim().replace(/^=/, "").trim();
  if (!formula) return null;

  // Handle SUM(X1:Xn)
  const sumMatch = /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/i.exec(formula);
  if (sumMatch) {
    const c1 = colLetterToIndex(sumMatch[1]);
    const r1 = Number(sumMatch[2]) - 1;
    const c2 = colLetterToIndex(sumMatch[3]);
    const r2 = Number(sumMatch[4]) - 1;
    let total = 0;
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        const val = getNumericCellFromGrid(grid, r, c, visited);
        if (val !== null) total += val;
      }
    }
    return round2(total);
  }

  // Replace cell references like $E$13 or E13 with resolved numeric values
  const replaced = formula.replace(
    /\$?([A-Z]{1,3})\$?(\d+)/gi,
    (_full, colStr: string, rowStr: string) => {
      const c = colLetterToIndex(colStr);
      const r = Number(rowStr) - 1;
      const val = getNumericCellFromGrid(grid, r, c, visited);
      return String(val ?? 0);
    }
  );

  // Only allow safe arithmetic characters after substitution
  if (!/^[\d+\-*/().\s]+$/.test(replaced)) {
    return null;
  }

  const result = evaluateArithmeticExpression(replaced);
  return result !== null ? round2(result) : null;
}

function unwrapExcelJsCell(cell: ExcelJS.Cell, warnings: string[]): RawCell {
  // Handle merged cells carefully:
  // Only keep the master cell itself; ignore slave cells so numbers/labels do not leak
  if (cell.isMerged && cell.master && cell.master !== cell) {
    return { value: null, formula: null, note: null };
  }

  let note: string | null = null;
  if (typeof cell.note === "string") {
    note = cell.note.trim() || null;
  } else if (
    cell.note &&
    typeof cell.note === "object" &&
    "texts" in cell.note &&
    Array.isArray(cell.note.texts)
  ) {
    note =
      cell.note.texts
        .map((t) => (typeof t.text === "string" ? t.text : ""))
        .join("")
        .trim() || null;
  }

  const val = cell.value;
  if (val === null || val === undefined) {
    return { value: null, formula: null, note };
  }

  if (typeof val === "object") {
    if ("richText" in val && Array.isArray(val.richText)) {
      const text = val.richText.map((rt) => rt.text ?? "").join("");
      return { value: text, formula: null, note };
    }
    if ("hyperlink" in val && "text" in val) {
      return { value: val.text ?? "", formula: null, note };
    }
    if ("formula" in val || "sharedFormula" in val) {
      const formula =
        ("formula" in val && typeof val.formula === "string"
          ? val.formula
          : null) ??
        ("sharedFormula" in val && typeof val.sharedFormula === "string"
          ? val.sharedFormula
          : null);
      const res = "result" in val ? val.result : undefined;
      if (res !== undefined && res !== null) {
        if (typeof res === "object" && "error" in res) {
          warnings.push(
            `Cellule ${cell.address} contient une erreur de formule Excel (${String(res.error)}).`
          );
          return { value: null, formula, note };
        }
        return { value: res, formula, note };
      }
      return { value: null, formula, note };
    }
    if (val instanceof Date) {
      return { value: val.toISOString().slice(0, 10), formula: null, note };
    }
    if ("error" in val) {
      warnings.push(
        `Cellule ${cell.address} contient une erreur Excel (${String((val as { error: unknown }).error)}).`
      );
      return { value: null, formula: null, note };
    }
  }

  return { value: val, formula: null, note };
}

function worksheetToRawGrid(
  ws: ExcelJS.Worksheet,
  warnings: string[]
): RawCell[][] {
  const rowCount = ws.rowCount;
  const colCount = Math.max(ws.columnCount, 20);
  const grid: RawCell[][] = [];

  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const cells: RawCell[] = [];
    for (let c = 1; c <= colCount; c++) {
      cells.push(unwrapExcelJsCell(row.getCell(c), warnings));
    }
    grid.push(cells);
  }
  return grid;
}

function matrixToRawGrid(
  matrix: unknown[][],
  notesGrid?: Array<Array<string | null | undefined>>
): RawCell[][] {
  return matrix.map((row, rIdx) =>
    row.map((val, cIdx) => {
      const str = typeof val === "string" ? val.trim() : null;
      const isFormula = Boolean(str && str.startsWith("="));
      return {
        value: isFormula ? null : val,
        formula: isFormula ? str : null,
        note: notesGrid?.[rIdx]?.[cIdx]?.trim() || null,
      };
    })
  );
}

function detectThreeBlockLayout(
  grid: RawCell[][],
  postesSheetTitle: string,
  postesSheetId: number
): BudgetSheetLayout {
  let bannerRowIndex: number | null = null;
  let preOpBlockCol: number | null = null;
  let postOpBlockCol: number | null = null;

  const scanLimit = Math.min(grid.length, 35);
  for (let r = 0; r < scanLimit; r++) {
    const row = grid[r] ?? [];
    let sCol: number | null = null;
    let preCol: number | null = null;
    let postCol: number | null = null;

    for (let c = 0; c < row.length; c++) {
      const norm = stripDiacritics(cellToString(row[c]?.value));
      if (!norm) continue;
      if (sCol === null && /prix\s*de\s*vente/.test(norm)) {
        sCol = c;
      } else if (
        preCol === null &&
        /couts?\s*reels?\s*pre[\s-]*op/.test(norm)
      ) {
        preCol = c;
      } else if (
        postCol === null &&
        /couts?\s*reels?\s*post[\s-]*op/.test(norm)
      ) {
        postCol = c;
      }
    }

    if (sCol !== null && preCol !== null && postCol !== null) {
      bannerRowIndex = r;
      preOpBlockCol = preCol;
      postOpBlockCol = postCol;
      break;
    }
  }

  const headerSearchStart = bannerRowIndex !== null ? bannerRowIndex + 1 : 0;
  const headerSearchEnd =
    bannerRowIndex !== null
      ? Math.min(grid.length, bannerRowIndex + 10)
      : Math.min(grid.length, 35);

  let headerRowIndex: number | null = null;
  for (let r = headerSearchStart; r < headerSearchEnd; r++) {
    const row = grid[r] ?? [];
    let hasObjet = false;
    let hasPriceOrCost = false;
    let costHeaderCount = 0;

    for (const cell of row) {
      const norm = stripDiacritics(cellToString(cell?.value));
      if (!norm) continue;
      if (/^(objet|poste|libelle|designation)$/.test(norm)) {
        hasObjet = true;
      }
      if (/^prix\b/.test(norm)) {
        hasPriceOrCost = true;
      }
      if (/cout\s*reel/.test(norm) && !/\/\s*u/.test(norm)) {
        costHeaderCount++;
      }
    }

    if (hasObjet && (hasPriceOrCost || costHeaderCount >= 2)) {
      headerRowIndex = r;
      break;
    }
  }

  if (headerRowIndex === null) {
    throw new AppHttpError(
      422,
      "INVALID_3BLOCK_STRUCTURE",
      "Structure budgétaire à 3 blocs introuvable (en-têtes 'Objet', 'Prix de vente', 'Coûts réels pré-op' / 'post-op' absents)."
    );
  }

  const headerRow = grid[headerRowIndex] ?? [];
  const normHeaders = headerRow.map((c) =>
    stripDiacritics(cellToString(c?.value))
  );

  // If banner row wasn't explicit, infer band split from header columns
  if (preOpBlockCol === null || postOpBlockCol === null) {
    const typeIdx = normHeaders.findIndex((h) => /type\s*de\s*depense/.test(h));
    if (typeIdx !== -1) {
      preOpBlockCol = typeIdx;
    }
    const costTotalCols: number[] = [];
    normHeaders.forEach((h, idx) => {
      if (/cout\s*reel/.test(h) && !/\/\s*u/.test(h)) {
        costTotalCols.push(idx);
      }
    });
    if (preOpBlockCol === null && costTotalCols.length >= 2) {
      preOpBlockCol = Math.max(0, costTotalCols[0] - 2);
    }
    if (costTotalCols.length >= 2) {
      postOpBlockCol = costTotalCols[0] + 1;
    }
  }

  if (
    preOpBlockCol === null ||
    postOpBlockCol === null ||
    preOpBlockCol >= postOpBlockCol
  ) {
    throw new AppHttpError(
      422,
      "INVALID_3BLOCK_STRUCTURE",
      "Structure à 3 blocs incomplète : impossible de distinguer Prix de vente, Pré-opération et Post-opération."
    );
  }

  const saleEnd = preOpBlockCol;
  const preEnd = postOpBlockCol;

  let objetCol: number | null = null;
  let realiseParCol: number | null = null;
  let saleQtyCol: number | null = null;
  let saleDaysCol: number | null = null;
  let saleUnitCol: number | null = null;
  let saleTotalCol: number | null = null;

  for (let c = 0; c < saleEnd; c++) {
    const h = normHeaders[c] ?? "";
    if (!h) continue;
    if (objetCol === null && /(objet|poste|libelle|designation)/.test(h)) {
      objetCol = c;
    } else if (realiseParCol === null && /realise\s*par|prestataire/.test(h)) {
      realiseParCol = c;
    } else if (saleQtyCol === null && /quantit|qte/.test(h)) {
      saleQtyCol = c;
    } else if (saleDaysCol === null && /jour/.test(h)) {
      saleDaysCol = c;
    } else if (
      saleUnitCol === null &&
      (/(cout|prix).*\/\s*u/.test(h) || /cout\s*\/\s*unite/.test(h))
    ) {
      saleUnitCol = c;
    } else if (saleTotalCol === null && /^prix/.test(h) && !/\/\s*u/.test(h)) {
      saleTotalCol = c;
    }
  }

  let expenseTypeCol: number | null = null;
  let preOpUnitCol: number | null = null;
  let preOpTotalCol: number | null = null;

  for (let c = preOpBlockCol; c < preEnd; c++) {
    const h = normHeaders[c] ?? "";
    if (!h) continue;
    if (expenseTypeCol === null && /type\s*de\s*depense/.test(h)) {
      expenseTypeCol = c;
    } else if (preOpUnitCol === null && /\/\s*u|unite/.test(h)) {
      preOpUnitCol = c;
    } else if (preOpTotalCol === null && /cout\s*reel/.test(h) && !/\/\s*u/.test(h)) {
      preOpTotalCol = c;
    }
  }

  let postOpQtyCol: number | null = null;
  let postOpDaysCol: number | null = null;
  let postOpUnitCol: number | null = null;
  let postOpTotalCol: number | null = null;

  for (let c = postOpBlockCol; c < normHeaders.length; c++) {
    const h = normHeaders[c] ?? "";
    if (!h) continue;
    if (postOpQtyCol === null && /quantit|qte/.test(h)) {
      postOpQtyCol = c;
    } else if (postOpDaysCol === null && /jour/.test(h)) {
      postOpDaysCol = c;
    } else if (postOpUnitCol === null && /\/\s*u|unite/.test(h)) {
      postOpUnitCol = c;
    } else if (
      postOpTotalCol === null &&
      /cout\s*reel/.test(h) &&
      !/\/\s*u/.test(h)
    ) {
      postOpTotalCol = c;
    }
  }

  if (
    objetCol === null ||
    saleTotalCol === null ||
    preOpTotalCol === null ||
    postOpTotalCol === null
  ) {
    throw new AppHttpError(
      422,
      "INVALID_3BLOCK_STRUCTURE",
      "Colonnes obligatoires des 3 blocs introuvables (Objet, Prix (€), Coût réel pré-op (€), Coût réel post-op (€))."
    );
  }

  return {
    postesSheetTitle,
    postesSheetId,
    bannerRowIndex,
    headerRowIndex,
    objetCol,
    realiseParCol,
    saleQtyCol,
    saleDaysCol,
    saleUnitCol,
    saleTotalCol,
    expenseTypeCol,
    preOpUnitCol,
    preOpTotalCol,
    postOpQtyCol,
    postOpDaysCol,
    postOpUnitCol,
    postOpTotalCol,
  };
}

function isFormulaSum(formula: string | null | undefined): boolean {
  if (!formula) return false;
  return /^\s*=?\s*SUM\(/i.test(formula);
}

function isRepeatedColumnHeaderRow(
  row: RawCell[],
  layout: BudgetSheetLayout
): boolean {
  const objNorm = stripDiacritics(cellToString(row[layout.objetCol]?.value));
  const saleTotalNorm = stripDiacritics(
    cellToString(row[layout.saleTotalCol]?.value)
  );
  const preTotalNorm = stripDiacritics(
    cellToString(row[layout.preOpTotalCol]?.value)
  );
  return (
    /^(objet|poste|libelle|designation)$/.test(objNorm) &&
    (/^prix/.test(saleTotalNorm) || /cout\s*reel/.test(preTotalNorm))
  );
}

function resolveNumericOrFormula(
  grid: RawCell[][],
  rowIdx: number,
  colIdx: number | null
): number | null {
  if (colIdx === null) return null;
  const row = grid[rowIdx];
  if (!row || !row[colIdx]) return null;
  const cell = row[colIdx];
  const parsed = parseFrenchNumber(cell.value);
  if (parsed !== null) return parsed;
  if (cell.formula) {
    return evaluateSimpleFormula(cell.formula, grid);
  }
  return null;
}

function inspectVueEnsembleMetadata(
  vueGrid: RawCell[][] | null,
  postesGrid: RawCell[][],
  projectContext?: BudgetProjectContext
): {
  warnings: string[];
  vueTitle: string | null;
  vueCodeProjet: string | null;
  postesTitle: string | null;
} {
  const warnings: string[] = [];
  let vueTitle: string | null = null;
  let vueCodeProjet: string | null = null;
  let postesTitle: string | null = null;

  // Scan top of Postes de dépenses (e.g. D3)
  for (let r = 0; r < Math.min(6, postesGrid.length); r++) {
    for (let c = 0; c < Math.min(8, postesGrid[r]?.length ?? 0); c++) {
      const text = cellToString(postesGrid[r]?.[c]?.value);
      if (text && /x/i.test(text) && text.length > 4) {
        postesTitle = text;
        break;
      }
    }
    if (postesTitle) break;
  }

  if (vueGrid) {
    for (let r = 0; r < Math.min(10, vueGrid.length); r++) {
      const row = vueGrid[r] ?? [];
      for (let c = 0; c < Math.min(8, row.length); c++) {
        const text = cellToString(row[c]?.value);
        if (!text) continue;
        const norm = stripDiacritics(text);
        if (!vueTitle && /\bx\b/.test(norm) && !/code\s*projet/.test(norm)) {
          vueTitle = text;
        }
        if (/code\s*projet/.test(norm)) {
          const inlineMatch = /code\s*projet\s*[:=\-#]?\s*(\d{4,8})/i.exec(text);
          if (inlineMatch?.[1]) {
            vueCodeProjet = inlineMatch[1];
          } else {
            // Check adjacent cell(s) to the right
            const right = cellToString(row[c + 1]?.value);
            vueCodeProjet = right || "";
          }
        }
      }
    }
  }

  if (projectContext) {
    const activeCp = projectContext.codeProjet.trim();
    const activeClientNorm = stripDiacritics(projectContext.client);

    if (vueCodeProjet !== null) {
      const trimmedCp = vueCodeProjet.trim();
      if (trimmedCp === "") {
        warnings.push(
          `En-tête 'Vue d'ensemble' incomplet : Code projet vide (titre: '${vueTitle ?? "N/A"}'). Le projet actif CP ${activeCp} (${projectContext.client}) fait foi sans modification.`
        );
      } else if (trimmedCp !== activeCp) {
        warnings.push(
          `En-tête 'Vue d'ensemble' discordant : Code projet '${trimmedCp}' ≠ projet actif CP ${activeCp}. Le projet actif reste inchangé.`
        );
      }
    }

    if (vueTitle) {
      const titleNorm = stripDiacritics(vueTitle);
      if (
        activeClientNorm &&
        !titleNorm.includes(activeClientNorm) &&
        !/nom du projet/.test(titleNorm)
      ) {
        warnings.push(
          `En-tête 'Vue d'ensemble' discordant ('${vueTitle}') par rapport au client actif '${projectContext.client}'. Le projet actif n'a pas été modifié.`
        );
      }
    }
  }

  return { warnings, vueTitle, vueCodeProjet, postesTitle };
}

export function parseBudgetSheetMatrices(params: {
  postesMatrix: unknown[][];
  postesSheetTitle?: string;
  postesSheetId?: number;
  postesNotes?: Array<Array<string | null | undefined>>;
  vueEnsembleMatrix?: unknown[][] | null;
  projectContext?: BudgetProjectContext;
}): ParsedBudgetResult {
  const postesGrid = matrixToRawGrid(params.postesMatrix, params.postesNotes);
  const vueGrid = params.vueEnsembleMatrix
    ? matrixToRawGrid(params.vueEnsembleMatrix)
    : null;

  return parseBudgetRawGrids({
    postesGrid,
    postesSheetTitle: params.postesSheetTitle ?? "Postes de dépenses",
    postesSheetId: params.postesSheetId ?? 0,
    vueGrid,
    projectContext: params.projectContext,
  });
}

function parseBudgetRawGrids(params: {
  postesGrid: RawCell[][];
  postesSheetTitle: string;
  postesSheetId: number;
  vueGrid: RawCell[][] | null;
  projectContext?: BudgetProjectContext;
  initialWarnings?: string[];
}): ParsedBudgetResult {
  const warnings = [...(params.initialWarnings ?? [])];
  const { postesGrid, vueGrid } = params;

  const layout = detectThreeBlockLayout(
    postesGrid,
    params.postesSheetTitle,
    params.postesSheetId
  );

  const meta = inspectVueEnsembleMetadata(
    vueGrid,
    postesGrid,
    params.projectContext
  );
  warnings.push(...meta.warnings);

  const lines: ParsedBudgetLine[] = [];
  let currentCategory = "Général";

  // PROD sheets place the first category header row (e.g. R9 "PRODUCTION")
  // between the 3-block banner row (R8) and the first column header row (R11).
  const preHeaderStart =
    layout.bannerRowIndex !== null ? layout.bannerRowIndex + 1 : 0;
  for (let r = preHeaderStart; r < layout.headerRowIndex; r++) {
    const row = postesGrid[r] ?? [];
    const obj = cellToString(row[layout.objetCol]?.value);
    const expRaw =
      layout.expenseTypeCol !== null
        ? cellToString(row[layout.expenseTypeCol]?.value)
        : "";
    const postRaw =
      layout.postOpQtyCol !== null
        ? cellToString(row[layout.postOpQtyCol]?.value)
        : "";
    if (
      obj &&
      !/^(total|sous-total|marge|prix de vente|couts? reels?|general cost)/i.test(
        stripDiacritics(obj)
      )
    ) {
      if (
        stripDiacritics(expRaw) === "total" ||
        stripDiacritics(postRaw) === "total" ||
        !expRaw
      ) {
        currentCategory = obj;
      }
    }
  }

  for (let r = layout.headerRowIndex + 1; r < postesGrid.length; r++) {
    const row = postesGrid[r] ?? [];
    if (isRepeatedColumnHeaderRow(row, layout)) {
      continue;
    }

    const objet = cellToString(row[layout.objetCol]?.value);
    const realisePar =
      layout.realiseParCol !== null
        ? cellToString(row[layout.realiseParCol]?.value)
        : "";
    const expenseTypeRaw =
      layout.expenseTypeCol !== null
        ? cellToString(row[layout.expenseTypeCol]?.value)
        : "";
    const postQtyRaw =
      layout.postOpQtyCol !== null
        ? cellToString(row[layout.postOpQtyCol]?.value)
        : "";

    const saleQtyVal = resolveNumericOrFormula(postesGrid, r, layout.saleQtyCol);
    const saleDaysVal = resolveNumericOrFormula(
      postesGrid,
      r,
      layout.saleDaysCol
    );
    const saleUnitVal = resolveNumericOrFormula(
      postesGrid,
      r,
      layout.saleUnitCol
    );
    const saleTotalVal = resolveNumericOrFormula(
      postesGrid,
      r,
      layout.saleTotalCol
    );

    const preUnitVal = resolveNumericOrFormula(
      postesGrid,
      r,
      layout.preOpUnitCol
    );
    const preTotalVal = resolveNumericOrFormula(
      postesGrid,
      r,
      layout.preOpTotalCol
    );

    const postQtyVal = resolveNumericOrFormula(
      postesGrid,
      r,
      layout.postOpQtyCol
    );
    const postDaysVal = resolveNumericOrFormula(
      postesGrid,
      r,
      layout.postOpDaysCol
    );
    const postUnitVal = resolveNumericOrFormula(
      postesGrid,
      r,
      layout.postOpUnitCol
    );
    const postTotalVal = resolveNumericOrFormula(
      postesGrid,
      r,
      layout.postOpTotalCol
    );

    // Check if row is completely blank or orphan blank-Objet row (e.g. R77)
    if (!objet) {
      // Check if an unmerged category title sits in col 0..objetCol-1 with NO data fields
      const hasAnyDataField =
        Boolean(realisePar) ||
        Boolean(expenseTypeRaw) ||
        saleQtyVal !== null ||
        saleUnitVal !== null ||
        preUnitVal !== null ||
        preTotalVal !== null ||
        postUnitVal !== null ||
        postTotalVal !== null;

      if (!hasAnyDataField) {
        for (let c = 0; c < layout.objetCol; c++) {
          const leftLabel = cellToString(row[c]?.value);
          if (
            leftLabel &&
            !/^(total|sous-total|marge|prix de vente)/i.test(
              stripDiacritics(leftLabel)
            )
          ) {
            currentCategory = leftLabel;
            break;
          }
        }
      }
      continue;
    }

    const objetNorm = stripDiacritics(objet);
    if (
      /^(total|sous-total|marge|difference|resume|bilan|general cost)\b/.test(
        objetNorm
      )
    ) {
      continue;
    }

    // Category header row detection:
    // 1. PROD style: expenseTypeCol === "TOTAL" or postOpQtyCol === "TOTAL"
    // 2. Clean header style: no realisePar, no expenseType, and all line-level numeric cells are null (totals either null or SUM(...))
    const isTotalMarkerCategory =
      stripDiacritics(expenseTypeRaw) === "total" ||
      stripDiacritics(postQtyRaw) === "total";

    const hasNoLineInputs =
      !realisePar &&
      !expenseTypeRaw &&
      saleQtyVal === null &&
      saleDaysVal === null &&
      saleUnitVal === null &&
      preUnitVal === null &&
      postQtyVal === null &&
      postDaysVal === null &&
      postUnitVal === null;

    const totalsAreNullOrSum =
      (saleTotalVal === null ||
        isFormulaSum(row[layout.saleTotalCol]?.formula)) &&
      (preTotalVal === null ||
        isFormulaSum(row[layout.preOpTotalCol]?.formula)) &&
      (postTotalVal === null ||
        isFormulaSum(row[layout.postOpTotalCol]?.formula));

    if (isTotalMarkerCategory || (hasNoLineInputs && totalsAreNullOrSum)) {
      currentCategory = objet;
      continue;
    }

    const saleQty = saleQtyVal ?? 1;
    const saleDays = saleDaysVal ?? 1;
    const saleUnitPrice = saleUnitVal ?? 0;
    const saleTotalHt = round2(
      saleTotalVal ?? saleQty * saleDays * saleUnitPrice
    );

    const preOpUnitCost = preUnitVal ?? 0;
    const preOpTotalHt = round2(
      preTotalVal ?? preOpUnitCost * saleQty * saleDays
    );

    const postOpQty = postQtyVal ?? 0;
    const postOpDays = postDaysVal ?? 0;
    const postOpUnitCost = postUnitVal ?? 0;
    const postOpTotalHt = round2(
      postTotalVal ?? postOpQty * postOpDays * postOpUnitCost
    );

    // Note on Post-Op Total HT cell if present
    const note = row[layout.postOpTotalCol]?.note ?? null;

    lines.push({
      category: currentCategory,
      objet,
      realisePar: realisePar || null,
      expenseType: normalizeExpenseType(expenseTypeRaw),
      saleQty: round2(saleQty),
      saleDays: round2(saleDays),
      saleUnitPrice: round2(saleUnitPrice),
      saleTotalHt,
      preOpUnitCost: round2(preOpUnitCost),
      preOpTotalHt,
      postOpQty: round2(postOpQty),
      postOpDays: round2(postOpDays),
      postOpUnitCost: round2(postOpUnitCost),
      postOpTotalHt,
      sheetRowIndex: r + 1, // 1-based sheet row
      invoiceNumbersNote: note,
    });
  }

  if (lines.length === 0) {
    throw new AppHttpError(
      422,
      "EMPTY_BUDGET_LINES",
      "Aucune ligne budgétaire valide trouvée dans l'onglet 'Postes de dépenses'."
    );
  }

  return {
    lines,
    warnings,
    layout,
    detectedMeta: {
      vueTitle: meta.vueTitle,
      vueCodeProjet: meta.vueCodeProjet,
      postesTitle: meta.postesTitle,
    },
  };
}

export async function parseBudgetXlsxBuffer(
  buffer: Buffer,
  projectContext?: BudgetProjectContext
): Promise<ParsedBudgetResult> {
  if (!buffer || buffer.length < 30) {
    throw new AppHttpError(
      422,
      "INVALID_BUDGET_XLSX",
      "Fichier .xlsx vide ou corrompu."
    );
  }

  // ZIP magic header check ("PK")
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new AppHttpError(
      422,
      "INVALID_BUDGET_XLSX",
      "Le fichier fourni n'est pas un classeur .xlsx valide."
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new AppHttpError(
      422,
      "INVALID_BUDGET_XLSX",
      "Impossible de lire le classeur .xlsx (archive corrompue ou format non supporté)."
    );
  }

  const worksheets = workbook.worksheets;
  if (!worksheets || worksheets.length === 0) {
    throw new AppHttpError(
      422,
      "INVALID_BUDGET_STRUCTURE",
      "Le classeur .xlsx ne contient aucun onglet."
    );
  }

  const postesWs =
    worksheets.find((ws) =>
      stripDiacritics(ws.name).includes("postes de depenses")
    ) ??
    worksheets.find((ws) => stripDiacritics(ws.name).includes("postes"));

  if (!postesWs) {
    throw new AppHttpError(
      422,
      "INVALID_BUDGET_STRUCTURE",
      "Onglet 'Postes de dépenses' introuvable dans le classeur .xlsx."
    );
  }

  const vueWs = worksheets.find((ws) => {
    const n = stripDiacritics(ws.name);
    return n.includes("vue d'ensemble") || n.includes("vue d ensemble");
  });

  const warnings: string[] = [];
  const postesGrid = worksheetToRawGrid(postesWs, warnings);
  const vueGrid = vueWs ? worksheetToRawGrid(vueWs, warnings) : null;

  return parseBudgetRawGrids({
    postesGrid,
    postesSheetTitle: postesWs.name,
    postesSheetId: postesWs.id ?? 0,
    vueGrid,
    projectContext,
    initialWarnings: warnings,
  });
}

export function resolvePostOpLayoutFromMatrix(
  matrix: unknown[][],
  sheetTitle = "Postes de dépenses",
  sheetId = 0
): BudgetSheetLayout | null {
  try {
    const grid = matrixToRawGrid(matrix);
    return detectThreeBlockLayout(grid, sheetTitle, sheetId);
  } catch {
    return null;
  }
}

export function buildCanonicalPostesMatrix(
  lines: Array<{
    category: string;
    objet: string;
    realisePar?: string | null;
    expenseType: string;
    saleQty: number;
    saleDays: number;
    saleUnitPrice: number;
    saleTotalHt: number;
    preOpUnitCost: number;
    preOpTotalHt: number;
    postOpQty: number;
    postOpDays: number;
    postOpUnitCost: number;
    postOpTotalHt: number;
  }>,
  projectTitle = "Budget Projet"
): { matrix: unknown[][]; rowIndices: number[] } {
  // Build canonical PROD-compatible matrix starting at Row 1..11+
  const matrix: unknown[][] = [];
  for (let r = 0; r < 11; r++) {
    matrix.push(new Array(19).fill(""));
  }
  matrix[2][3] = projectTitle;
  matrix[7][0] = "Prix de vente";
  matrix[7][9] = "Coûts réels pré-opération";
  matrix[7][15] = "Coûts réels post-opération";

  const writeHeaders = (row: unknown[]) => {
    row[2] = "Objet";
    row[3] = "Réalisé par";
    row[4] = "Quantité";
    row[5] = "Jours";
    row[6] = "Coût/unité (€)";
    row[7] = "Prix (€)";
    row[9] = "Type de dépenses";
    row[10] = "Coût réel/u (€)";
    row[11] = "Coût réel (€)";
    row[15] = "Qté";
    row[16] = "Jours";
    row[17] = "Coût réel/u (€)";
    row[18] = "Coût réel (€)";
  };
  writeHeaders(matrix[10]);

  const rowIndices: number[] = [];
  let lastCategory = "";

  for (const line of lines) {
    const cat = line.category.trim() || "Général";
    if (cat !== lastCategory) {
      const catRow = new Array(19).fill("");
      catRow[2] = cat;
      catRow[9] = "TOTAL";
      catRow[15] = "TOTAL";
      matrix.push(catRow);
      lastCategory = cat;
    }

    const dataRow = new Array(19).fill("");
    dataRow[2] = line.objet;
    dataRow[3] = line.realisePar ?? "";
    dataRow[4] = line.saleQty;
    dataRow[5] = line.saleDays;
    dataRow[6] = line.saleUnitPrice;
    dataRow[7] = line.saleTotalHt;
    dataRow[9] = line.expenseType;
    dataRow[10] = line.preOpUnitCost;
    dataRow[11] = line.preOpTotalHt;
    dataRow[15] = line.postOpQty;
    dataRow[16] = line.postOpDays;
    dataRow[17] = line.postOpUnitCost;
    dataRow[18] = line.postOpTotalHt;
    matrix.push(dataRow);
    rowIndices.push(matrix.length); // 1-based row index
  }

  return { matrix, rowIndices };
}
