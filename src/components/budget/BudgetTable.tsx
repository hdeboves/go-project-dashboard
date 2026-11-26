"use client";

import {
  Calculator,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Percent,
  Plus,
  Receipt,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  type BudgetAlertDto,
  type BudgetLineDto,
  type InvoiceDto,
  type QuoteDto,
  formatEur,
} from "@/components/budget/types";
import { PdfPreviewModal } from "@/components/ui/PdfPreviewModal";
import {
  DEFAULT_MARGIN_PCT,
  RESOURCE_TYPE_OPTIONS,
  type ResourceTypeOption,
  computeSaleFromCostAndMargin,
  resolveLineMarginPct,
  round2,
  toResourceTypeOption,
} from "@/lib/budget/calculator";
import { showToast } from "@/lib/toast";

interface BudgetTableProps {
  projectId: string;
  lines: BudgetLineDto[];
  alerts: BudgetAlertDto[];
  invoices?: InvoiceDto[];
  quotes?: QuoteDto[];
  selectedCategory?: string | null;
  onSelectCategory?: (category: string | null) => void;
  overrunsOnly?: boolean;
  onToggleOverrunsOnly?: (next: boolean) => void;
  onLineSaved: () => Promise<void>;
  onError: (status: number, payload: { error?: string; code?: string }) => void;
}

type EditableField =
  | "objet"
  | "saleQty"
  | "saleDays"
  | "marginPct"
  | "saleTotalHt"
  | "preOpTotalHt"
  | "postOpTotalHt";

const SIMPLE_TAB_ORDER: readonly EditableField[] = [
  "objet",
  "saleTotalHt",
  "preOpTotalHt",
  "postOpTotalHt",
];

const DETAILED_TAB_ORDER: readonly EditableField[] = [
  "objet",
  "saleQty",
  "saleDays",
  "marginPct",
  "saleTotalHt",
  "preOpTotalHt",
  "postOpTotalHt",
];

/**
 * Evaluates simple Excel-style numeric expressions like "1500", "=500*3", "1200+300", "2500/2".
 */
function parseSpreadsheetNumber(raw: string): number {
  const cleaned = raw.trim().replace(/^=/, "").replace(/,/g, ".").replace(/\s+/g, "");
  if (!cleaned) return 0;
  if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) {
    return round2(Math.max(0, Number(cleaned) || 0));
  }
  if (/^[\d.+\-*/()]+$/.test(cleaned)) {
    // Simple safe arithmetic evaluator (no eval/Function)
    const tokens = cleaned.match(/\d+(?:\.\d+)?|[+\-*/()]/g);
    if (!tokens) return 0;
    let pos = 0;
    const parseExpr = (): number => {
      let left = parseTerm();
      while (pos < tokens.length && (tokens[pos] === "+" || tokens[pos] === "-")) {
        const op = tokens[pos++];
        const right = parseTerm();
        left = op === "+" ? left + right : left - right;
      }
      return left;
    };
    const parseTerm = (): number => {
      let left = parseFactor();
      while (pos < tokens.length && (tokens[pos] === "*" || tokens[pos] === "/")) {
        const op = tokens[pos++];
        const right = parseFactor();
        left = op === "*" ? left * right : right === 0 ? 0 : left / right;
      }
      return left;
    };
    const parseFactor = (): number => {
      if (tokens[pos] === "(") {
        pos++;
        const v = parseExpr();
        if (tokens[pos] === ")") pos++;
        return v;
      }
      if (tokens[pos] === "-") {
        pos++;
        return -parseFactor();
      }
      const n = Number(tokens[pos++]);
      return Number.isFinite(n) ? n : 0;
    };
    const res = parseExpr();
    return Number.isFinite(res) ? round2(Math.max(0, res)) : 0;
  }
  return round2(Math.max(0, Number(cleaned) || 0));
}

function resourceSelectStyle(resource: ResourceTypeOption): string {
  if (resource === "Interne") {
    return "border-indigo-200 bg-indigo-50/70 text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-200";
  }
  if (resource === "Amortissement") {
    return "border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200";
  }
  return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

function getFieldInitialValue(line: BudgetLineDto, field: EditableField): string {
  switch (field) {
    case "objet":
      return line.objet;
    case "saleQty":
      return String(line.saleQty);
    case "saleDays":
      return String(line.saleDays);
    case "marginPct":
      return String(resolveLineMarginPct(line));
    case "saleTotalHt":
      return String(line.saleTotalHt);
    case "preOpTotalHt":
      return String(line.preOpTotalHt);
    case "postOpTotalHt":
      return String(line.postOpTotalHt);
  }
}

export function BudgetTable({
  projectId,
  lines,
  invoices = [],
  quotes = [],
  selectedCategory = null,
  onSelectCategory,
  overrunsOnly = false,
  onLineSaved,
  onError,
}: BudgetTableProps) {
  const [detailedView, setDetailedView] = useState(false);
  const [defaultMarginFactor, setDefaultMarginFactor] =
    useState<number>(DEFAULT_MARGIN_PCT);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    () => new Set()
  );
  const [expandedLineIds, setExpandedLineIds] = useState<Set<string>>(
    () => new Set()
  );
  const [previewInvoice, setPreviewInvoice] = useState<InvoiceDto | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Active inline spreadsheet cell
  const [inlineEdit, setInlineEdit] = useState<{
    lineId: string;
    field: EditableField;
    value: string;
  } | null>(null);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [insertingBelowId, setInsertingBelowId] = useState<string | null>(null);
  const commitLockRef = useRef(false);

  // Quick-add row for creating a new category or adding at bottom
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [qaCategory, setQaCategory] = useState("PRODUCTION");
  const [qaObjet, setQaObjet] = useState("");
  const [qaResource, setQaResource] = useState<ResourceTypeOption>("Externe");
  const [qaMarged, setQaMarged] = useState(true);
  const [qaPreOp, setQaPreOp] = useState("");
  const [qaSaleOverride, setQaSaleOverride] = useState<string | null>(null);
  const [qaPostOp, setQaPostOp] = useState("0");
  const [qaSaving, setQaSaving] = useState(false);

  const invoicesByLineId = useMemo(() => {
    const map = new Map<string, InvoiceDto[]>();
    for (const inv of invoices) {
      if (!inv.budgetLineId) continue;
      const list = map.get(inv.budgetLineId) ?? [];
      list.push(inv);
      map.set(inv.budgetLineId, list);
    }
    return map;
  }, [invoices]);

  const quoteById = useMemo(() => {
    const map = new Map<string, QuoteDto>();
    for (const q of quotes) map.set(q.id, q);
    return map;
  }, [quotes]);

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) set.add(l.category.trim() || "AUTRES");
    return Array.from(set);
  }, [lines]);

  const filteredLines = useMemo(() => {
    return lines.filter((line) => {
      const cat = line.category.trim() || "AUTRES";
      if (selectedCategory && cat !== selectedCategory) return false;
      if (overrunsOnly && !(line.postOpTotalHt > line.preOpTotalHt)) {
        return false;
      }
      return true;
    });
  }, [lines, selectedCategory, overrunsOnly]);

  const grouped = useMemo(() => {
    const groups: Array<{
      category: string;
      rows: BudgetLineDto[];
      soldTotal: number;
      preOpTotal: number;
      postOpTotal: number;
    }> = [];
    const idxMap = new Map<string, number>();

    for (const line of filteredLines) {
      const cat = line.category.trim() || "AUTRES";
      let idx = idxMap.get(cat);
      if (idx === undefined) {
        idx = groups.length;
        idxMap.set(cat, idx);
        groups.push({
          category: cat,
          rows: [],
          soldTotal: 0,
          preOpTotal: 0,
          postOpTotal: 0,
        });
      }
      groups[idx].rows.push(line);
      groups[idx].soldTotal += line.saleTotalHt;
      groups[idx].preOpTotal += line.preOpTotalHt;
      groups[idx].postOpTotal += line.postOpTotalHt;
    }
    return groups;
  }, [filteredLines]);

  const visibleOrderedRows = useMemo(() => {
    const ordered: BudgetLineDto[] = [];
    for (const g of grouped) {
      if (!collapsedCategories.has(g.category)) {
        ordered.push(...g.rows);
      }
    }
    return ordered;
  }, [grouped, collapsedCategories]);

  const grandTotals = useMemo(() => {
    return filteredLines.reduce(
      (acc, l) => {
        acc.sold += l.saleTotalHt;
        acc.preOp += l.preOpTotalHt;
        acc.postOp += l.postOpTotalHt;
        return acc;
      },
      { sold: 0, preOp: 0, postOp: 0 }
    );
  }, [filteredLines]);

  const grandDiff = round2(grandTotals.postOp - grandTotals.preOp);
  const grandMarginPct =
    grandTotals.sold > 0
      ? round2(((grandTotals.sold - grandTotals.preOp) / grandTotals.sold) * 100)
      : 0;

  function toggleExpandLine(lineId: string) {
    setExpandedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  function toggleCategory(cat: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  async function persistLineUpdate(
    line: BudgetLineDto,
    patch: Partial<{
      category: string;
      objet: string;
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
      marginPct: number | null;
    }>,
    toastLabel?: string
  ): Promise<boolean> {
    setSavingLineId(line.id);
    try {
      const safeQty = Math.max(
        0.01,
        patch.saleQty ?? (line.saleQty > 0 ? line.saleQty : 1)
      );
      const safeDays = Math.max(
        0.01,
        patch.saleDays ?? (line.saleDays > 0 ? line.saleDays : 1)
      );
      const denom = Math.max(0.01, safeQty * safeDays);
      const nextSaleTotal = round2(patch.saleTotalHt ?? line.saleTotalHt);
      const nextPreOpTotal = round2(patch.preOpTotalHt ?? line.preOpTotalHt);
      const nextPostOpTotal = round2(patch.postOpTotalHt ?? line.postOpTotalHt);

      const res = await fetch(`/api/projects/${projectId}/budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: line.id,
          category: (patch.category ?? line.category).trim() || "AUTRES",
          objet: (patch.objet ?? line.objet).trim() || line.objet,
          realisePar: line.realisePar,
          expenseType: patch.expenseType ?? line.expenseType,
          saleQty: safeQty,
          saleDays: safeDays,
          saleUnitPrice: patch.saleUnitPrice ?? round2(nextSaleTotal / denom),
          saleTotalHt: nextSaleTotal,
          preOpUnitCost: patch.preOpUnitCost ?? round2(nextPreOpTotal / denom),
          preOpTotalHt: nextPreOpTotal,
          postOpQty:
            patch.postOpQty ?? (nextPostOpTotal > 0 ? 1 : line.postOpQty),
          postOpDays:
            patch.postOpDays ?? (nextPostOpTotal > 0 ? 1 : line.postOpDays),
          postOpUnitCost:
            patch.postOpUnitCost ??
            (nextPostOpTotal > 0 ? nextPostOpTotal : line.postOpUnitCost),
          postOpTotalHt: nextPostOpTotal,
          marginPct:
            patch.marginPct !== undefined ? patch.marginPct : line.marginPct,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        onError(res.status, err);
        return false;
      }
      if (toastLabel) {
        showToast(toastLabel);
      }
      await onLineSaved();
      return true;
    } finally {
      setSavingLineId(null);
    }
  }

  /**
   * Notion/Sheets-style instant row insertion directly from any row or category footer.
   * Creates a new row immediately in DB and focuses its Poste name cell for instant typing.
   */
  async function handleInsertRow(params: {
    category: string;
    anchorId?: string;
    cloneFrom?: BudgetLineDto;
  }) {
    const { category, anchorId, cloneFrom } = params;
    setInsertingBelowId(anchorId ?? `cat:${category}`);
    try {
      const payload = cloneFrom
        ? {
            category: cloneFrom.category,
            objet: `${cloneFrom.objet} (copie)`,
            expenseType: toResourceTypeOption(cloneFrom.expenseType),
            saleQty: cloneFrom.saleQty,
            saleDays: cloneFrom.saleDays,
            saleUnitPrice: cloneFrom.saleUnitPrice,
            saleTotalHt: cloneFrom.saleTotalHt,
            preOpUnitCost: cloneFrom.preOpUnitCost,
            preOpTotalHt: cloneFrom.preOpTotalHt,
            postOpQty: 0,
            postOpDays: 0,
            postOpUnitCost: 0,
            postOpTotalHt: 0,
            marginPct: resolveLineMarginPct(cloneFrom),
          }
        : {
            category,
            objet: "Nouveau poste",
            expenseType: "Externe",
            saleQty: 1,
            saleDays: 1,
            saleUnitPrice: 0,
            saleTotalHt: 0,
            preOpUnitCost: 0,
            preOpTotalHt: 0,
            postOpQty: 0,
            postOpDays: 0,
            postOpUnitCost: 0,
            postOpTotalHt: 0,
            marginPct: defaultMarginFactor,
          };

      const res = await fetch(`/api/projects/${projectId}/budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as {
        line?: BudgetLineDto;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        onError(res.status, json);
        return;
      }

      // Ensure category is expanded so the new row is visible immediately
      setCollapsedCategories((prev) => {
        if (!prev.has(category)) return prev;
        const next = new Set(prev);
        next.delete(category);
        return next;
      });

      await onLineSaved();
      if (json.line?.id) {
        setInlineEdit({
          lineId: json.line.id,
          field: "objet",
          value: json.line.objet,
        });
      }
      showToast(
        cloneFrom
          ? `Ligne « ${cloneFrom.objet} » dupliquée.`
          : `Nouvelle ligne ajoutée dans ${category}.`
      );
    } finally {
      setInsertingBelowId(null);
    }
  }

  async function handleResourceChange(
    line: BudgetLineDto,
    nextResource: ResourceTypeOption
  ) {
    const currentResource = toResourceTypeOption(line.expenseType);
    if (currentResource === nextResource) return;
    await persistLineUpdate(
      line,
      { expenseType: nextResource },
      `Ressource passée en « ${nextResource} ».`
    );
  }

  async function handleToggleLineMargin(line: BudgetLineDto) {
    const currentMargin = resolveLineMarginPct(line);
    const isCurrentlyMarged = currentMargin > 0.05;
    const nextMargin = isCurrentlyMarged ? 0 : defaultMarginFactor;
    const nextSale =
      line.preOpTotalHt > 0
        ? computeSaleFromCostAndMargin(line.preOpTotalHt, nextMargin)
        : line.saleTotalHt;

    await persistLineUpdate(
      line,
      {
        marginPct: nextMargin,
        saleTotalHt: nextSale,
      },
      nextMargin === 0
        ? `Marge désactivée (0 %) sur « ${line.objet} ».`
        : `Marge ${nextMargin}% appliquée sur « ${line.objet} ».`
    );
  }

  function focusAdjacentCell(
    line: BudgetLineDto,
    field: EditableField,
    nav: "nextCol" | "prevCol" | "nextRow" | "prevRow"
  ) {
    const order = detailedView ? DETAILED_TAB_ORDER : SIMPLE_TAB_ORDER;
    if (nav === "nextRow" || nav === "prevRow") {
      const rowIdx = visibleOrderedRows.findIndex((r) => r.id === line.id);
      const targetIdx = nav === "nextRow" ? rowIdx + 1 : rowIdx - 1;
      if (rowIdx >= 0 && targetIdx >= 0 && targetIdx < visibleOrderedRows.length) {
        const nextLine = visibleOrderedRows[targetIdx];
        setInlineEdit({
          lineId: nextLine.id,
          field,
          value: getFieldInitialValue(nextLine, field),
        });
      } else {
        setInlineEdit(null);
      }
      return;
    }

    const colIdx = order.indexOf(field);
    const nextColIdx = nav === "nextCol" ? colIdx + 1 : colIdx - 1;
    if (nextColIdx >= 0 && nextColIdx < order.length) {
      const nextField = order[nextColIdx];
      setInlineEdit({
        lineId: line.id,
        field: nextField,
        value: getFieldInitialValue(line, nextField),
      });
    } else {
      setInlineEdit(null);
    }
  }

  async function commitInlineCell(
    line: BudgetLineDto,
    field: EditableField,
    rawValue: string,
    nav?: "nextCol" | "prevCol" | "nextRow" | "prevRow"
  ) {
    if (commitLockRef.current) return;
    commitLockRef.current = true;

    try {
      if (field === "objet") {
        const clean = rawValue.trim();
        if (!clean || clean === line.objet) {
          if (nav) focusAdjacentCell(line, field, nav);
          else setInlineEdit(null);
          return;
        }
        const ok = await persistLineUpdate(line, { objet: clean });
        if (ok) {
          if (nav) focusAdjacentCell({ ...line, objet: clean }, field, nav);
          else setInlineEdit(null);
        }
        return;
      }

      const parsed = parseSpreadsheetNumber(rawValue);

      if (field === "marginPct") {
        const clamped = Math.min(95, parsed);
        const currentMargin = resolveLineMarginPct(line);
        if (
          Math.abs(clamped - currentMargin) < 0.01 &&
          line.marginPct === clamped
        ) {
          if (nav) focusAdjacentCell(line, field, nav);
          else setInlineEdit(null);
          return;
        }
        const nextSale =
          line.preOpTotalHt > 0
            ? computeSaleFromCostAndMargin(line.preOpTotalHt, clamped)
            : line.saleTotalHt;
        const ok = await persistLineUpdate(line, {
          marginPct: clamped,
          saleTotalHt: nextSale,
        });
        if (ok) {
          if (nav)
            focusAdjacentCell(
              { ...line, marginPct: clamped, saleTotalHt: nextSale },
              field,
              nav
            );
          else setInlineEdit(null);
        }
        return;
      }

      if (field === "saleTotalHt") {
        if (Math.abs(parsed - line.saleTotalHt) < 0.005) {
          if (nav) focusAdjacentCell(line, field, nav);
          else setInlineEdit(null);
          return;
        }
        const impliedMargin =
          parsed > 0
            ? round2(
                Math.max(
                  0,
                  Math.min(95, ((parsed - line.preOpTotalHt) / parsed) * 100)
                )
              )
            : 0;
        const ok = await persistLineUpdate(line, {
          saleTotalHt: parsed,
          marginPct: impliedMargin,
        });
        if (ok) {
          if (nav)
            focusAdjacentCell(
              { ...line, saleTotalHt: parsed, marginPct: impliedMargin },
              field,
              nav
            );
          else setInlineEdit(null);
        }
        return;
      }

      if (field === "preOpTotalHt") {
        if (Math.abs(parsed - line.preOpTotalHt) < 0.005) {
          if (nav) focusAdjacentCell(line, field, nav);
          else setInlineEdit(null);
          return;
        }
        const activeMargin = resolveLineMarginPct(line);
        const nextSale = computeSaleFromCostAndMargin(parsed, activeMargin);
        const ok = await persistLineUpdate(line, {
          preOpTotalHt: parsed,
          saleTotalHt: nextSale,
          marginPct: activeMargin,
        });
        if (ok) {
          if (nav)
            focusAdjacentCell(
              {
                ...line,
                preOpTotalHt: parsed,
                saleTotalHt: nextSale,
                marginPct: activeMargin,
              },
              field,
              nav
            );
          else setInlineEdit(null);
        }
        return;
      }

      if (field === "postOpTotalHt") {
        if (Math.abs(parsed - line.postOpTotalHt) < 0.005) {
          if (nav) focusAdjacentCell(line, field, nav);
          else setInlineEdit(null);
          return;
        }
        const ok = await persistLineUpdate(line, { postOpTotalHt: parsed });
        if (ok) {
          if (nav)
            focusAdjacentCell({ ...line, postOpTotalHt: parsed }, field, nav);
          else setInlineEdit(null);
        }
        return;
      }

      if (field === "saleQty" || field === "saleDays") {
        const nextQty =
          field === "saleQty" ? Math.max(0.01, parsed) : line.saleQty;
        const nextDays =
          field === "saleDays" ? Math.max(0.01, parsed) : line.saleDays;
        const nextPreOp = round2(line.preOpUnitCost * nextQty * nextDays);
        const nextSale = round2(line.saleUnitPrice * nextQty * nextDays);
        const ok = await persistLineUpdate(line, {
          saleQty: nextQty,
          saleDays: nextDays,
          ...(line.preOpUnitCost > 0 ? { preOpTotalHt: nextPreOp } : {}),
          ...(line.saleUnitPrice > 0 ? { saleTotalHt: nextSale } : {}),
        });
        if (ok) {
          if (nav) focusAdjacentCell(line, field, nav);
          else setInlineEdit(null);
        }
      }
    } finally {
      commitLockRef.current = false;
    }
  }

  async function handleDeleteLine(line: BudgetLineDto) {
    setDeletingId(line.id);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/budget?lineId=${encodeURIComponent(line.id)}`,
        { method: "DELETE" }
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        onError(res.status, json);
        return;
      }
      setConfirmDeleteId(null);
      showToast(`Poste « ${line.objet} » supprimé.`);
      await onLineSaved();
    } finally {
      setDeletingId(null);
    }
  }

  const qaPreOpNum = parseSpreadsheetNumber(qaPreOp);
  const qaMarginNum = qaMarged ? defaultMarginFactor : 0;
  const qaComputedSale = computeSaleFromCostAndMargin(qaPreOpNum, qaMarginNum);
  const qaEffectiveSale =
    qaSaleOverride !== null
      ? parseSpreadsheetNumber(qaSaleOverride)
      : qaComputedSale;

  async function handleQuickAddSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const cleanObjet = qaObjet.trim();
    if (!cleanObjet) {
      showToast("Indiquez un nom de poste de dépense.", "error");
      return;
    }
    setQaSaving(true);
    try {
      const postOpNum = parseSpreadsheetNumber(qaPostOp);
      const res = await fetch(`/api/projects/${projectId}/budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: qaCategory.trim() || "PRODUCTION",
          objet: cleanObjet,
          expenseType: qaResource,
          saleQty: 1,
          saleDays: 1,
          saleUnitPrice: qaEffectiveSale,
          saleTotalHt: qaEffectiveSale,
          preOpUnitCost: qaPreOpNum,
          preOpTotalHt: qaPreOpNum,
          postOpQty: postOpNum > 0 ? 1 : 0,
          postOpDays: postOpNum > 0 ? 1 : 0,
          postOpUnitCost: postOpNum,
          postOpTotalHt: postOpNum,
          marginPct: qaMarginNum,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        onError(res.status, err);
        return;
      }
      setQaObjet("");
      setQaPreOp("");
      setQaSaleOverride(null);
      setQaPostOp("0");
      showToast(`Poste « ${cleanObjet} » ajouté.`);
      await onLineSaved();
    } finally {
      setQaSaving(false);
    }
  }

  // Simple view: 6 crisp columns (ZERO horizontal scroll!)
  // Detailed view: 10 columns (adds Qté, Jours, Marge, Coût/u pré)
  const colCount = detailedView ? 10 : 6;

  return (
    <section
      id="budget-spreadsheet"
      className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5 dark:border-slate-800 dark:bg-[#111827]"
    >
      {/* Spreadsheet Toolbar */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCollapsedCategories(new Set())}
            disabled={grouped.length === 0 || collapsedCategories.size === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
          >
            <ChevronsUpDown className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            Tout dérouler
          </button>

          <button
            type="button"
            onClick={() =>
              setCollapsedCategories(new Set(grouped.map((g) => g.category)))
            }
            disabled={
              grouped.length === 0 || collapsedCategories.size >= grouped.length
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
          >
            <ChevronsDownUp className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            Tout enrouler
          </button>

          {selectedCategory && (
            <button
              type="button"
              onClick={() => onSelectCategory?.(null)}
              className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300"
            >
              <span>{selectedCategory}</span>
              <X className="h-3 w-3" />
            </button>
          )}

          {/* Default Agency Margin Factor (43%) */}
          <div
            title="Facteur de marge par défaut appliqué sur les postes margés (Prix de vente = Coût pré-op / (1 - marge))"
            className="inline-flex items-center gap-1 rounded-xl border border-indigo-200/80 bg-indigo-50/50 px-2.5 py-1 text-xs text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200"
          >
            <Percent className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="font-medium">Marge :</span>
            <input
              type="number"
              min="0"
              max="90"
              step="1"
              aria-label="Facteur de marge par défaut (%)"
              value={defaultMarginFactor}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) {
                  setDefaultMarginFactor(Math.max(0, Math.min(90, Math.round(n))));
                }
              }}
              className="w-10 rounded-md border border-indigo-200 bg-white px-1 py-0.5 text-right font-mono text-xs font-bold text-indigo-700 focus:border-indigo-500 focus:outline-none dark:border-indigo-500/40 dark:bg-slate-900 dark:text-indigo-300"
            />
            <span className="font-mono font-bold">%</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={filteredLines.length === 0}
            onClick={() => {
              const headers = [
                "Catégorie",
                "Poste de dépense",
                "Ressource",
                "Marge (%)",
                "Prix de vente HT (€)",
                "Coût réel pré-op (€)",
                "Coût réel post-op (€)",
                "Écart (€)",
              ];
              const rows = filteredLines.map((l) => [
                l.category,
                l.objet,
                toResourceTypeOption(l.expenseType),
                resolveLineMarginPct(l).toFixed(1),
                l.saleTotalHt.toFixed(2),
                l.preOpTotalHt.toFixed(2),
                l.postOpTotalHt.toFixed(2),
                (l.postOpTotalHt - l.preOpTotalHt).toFixed(2),
              ]);
              const csv =
                "\uFEFF" +
                [headers, ...rows]
                  .map((r) =>
                    r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(";")
                  )
                  .join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `budget_projet_${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              showToast("Budget exporté en CSV.");
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
          >
            <Download className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            CSV
          </button>

          <button
            type="button"
            onClick={() => setDetailedView((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              detailedView
                ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-200"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {detailedView ? "Vue simplifiée" : "Marge & Détails"}
          </button>

          <button
            type="button"
            onClick={() => {
              setQaCategory(selectedCategory ?? allCategories[0] ?? "PRODUCTION");
              setQuickAddOpen((v) => !v);
            }}
            className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Nouvelle catégorie / ligne
          </button>
        </div>
      </div>

      <p className="mb-2.5 text-[11px] text-slate-400 dark:text-slate-500">
        Tableur interactif : cliquez sur une cellule pour éditer (formules acceptées ex. <code className="font-mono">=500*3</code>) · <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">Tab</kbd> droite · <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">Entrée</kbd> / <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">↑↓</kbd> lignes · bouton <strong className="font-semibold">+</strong> sur chaque ligne pour insérer en dessous.
      </p>

      {/* Zero-Horizontal-Scroll Adaptive Spreadsheet (Notion / Excel / Google Sheets) */}
      <div
        className={`max-h-[640px] rounded-xl border border-slate-200 dark:border-slate-800 ${
          detailedView ? "overflow-auto" : "overflow-y-auto overflow-x-hidden"
        }`}
      >
        <table
          className={`w-full border-collapse text-left text-xs ${
            detailedView ? "min-w-[920px]" : "table-fixed"
          }`}
        >
          <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-semibold text-slate-600 shadow-[0_1px_0_#e2e8f0] dark:bg-slate-900 dark:text-slate-300 dark:shadow-[0_1px_0_#1e293b]">
            <tr className="divide-x divide-slate-200/70 dark:divide-slate-800">
              <th className={detailedView ? "min-w-[230px] px-3 py-2.5" : "w-[36%] px-2.5 py-2.5"}>
                Poste de dépense
              </th>
              {detailedView && <th className="w-16 px-2 py-2.5 text-right">Qté</th>}
              {detailedView && <th className="w-16 px-2 py-2.5 text-right">Jours</th>}
              <th className={detailedView ? "w-32 px-2 py-2.5" : "w-[15%] px-2 py-2.5"}>
                Ressource
              </th>
              {detailedView && (
                <th className="w-32 px-2 py-2.5 text-center">Marge</th>
              )}
              <th
                className={
                  detailedView
                    ? "w-32 px-2.5 py-2.5 text-right"
                    : "w-[15%] px-2 py-2.5 text-right"
                }
              >
                Prix de vente HT
              </th>
              <th
                className={
                  detailedView
                    ? "w-32 px-2.5 py-2.5 text-right"
                    : "w-[14%] px-2 py-2.5 text-right"
                }
              >
                Coût réel pré-op
              </th>
              <th
                className={
                  detailedView
                    ? "w-32 px-2.5 py-2.5 text-right"
                    : "w-[13%] px-2 py-2.5 text-right"
                }
              >
                Coût réel post-op
              </th>
              {detailedView && (
                <th className="w-24 px-2 py-2.5 text-right">Coût/u pré</th>
              )}
              <th className={detailedView ? "w-20 px-1.5 py-2.5" : "w-[7%] px-1 py-2.5"} />
            </tr>
          </thead>

          <tbody>
            {grouped.length === 0 && !quickAddOpen ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                >
                  {lines.length === 0
                    ? "Aucun poste budgétaire pour le moment. Cliquez sur « Nouvelle catégorie / ligne »."
                    : "Aucun poste ne correspond à votre recherche."}
                </td>
              </tr>
            ) : (
              grouped.map((group) => {
                const isCollapsed = collapsedCategories.has(group.category);
                const catDiff = round2(group.postOpTotal - group.preOpTotal);
                const catOverrun = catDiff > 0;
                const catMarginPct =
                  group.soldTotal > 0
                    ? round2(
                        ((group.soldTotal - group.preOpTotal) / group.soldTotal) *
                          100
                      )
                    : 0;

                return (
                  <CategoryRows
                    key={group.category}
                    category={group.category}
                    rows={group.rows}
                    soldTotal={group.soldTotal}
                    preOpTotal={group.preOpTotal}
                    postOpTotal={group.postOpTotal}
                    catMarginPct={catMarginPct}
                    catDiff={catDiff}
                    catOverrun={catOverrun}
                    collapsed={isCollapsed}
                    detailedView={detailedView}
                    colCount={colCount}
                    defaultMarginFactor={defaultMarginFactor}
                    expandedLineIds={expandedLineIds}
                    invoicesByLineId={invoicesByLineId}
                    quoteById={quoteById}
                    inlineEdit={inlineEdit}
                    savingLineId={savingLineId}
                    insertingBelowId={insertingBelowId}
                    confirmDeleteId={confirmDeleteId}
                    deletingId={deletingId}
                    onToggleExpandLine={toggleExpandLine}
                    onPreviewInvoice={setPreviewInvoice}
                    onStartInline={(lineId, field, value) =>
                      setInlineEdit({ lineId, field, value })
                    }
                    onChangeInline={(value) =>
                      setInlineEdit((prev) => (prev ? { ...prev, value } : null))
                    }
                    onCommitInline={commitInlineCell}
                    onCancelInline={() => setInlineEdit(null)}
                    onResourceChange={handleResourceChange}
                    onToggleMargin={handleToggleLineMargin}
                    onInsertRowBelow={(line) =>
                      void handleInsertRow({
                        category: line.category,
                        anchorId: line.id,
                      })
                    }
                    onDuplicateRow={(line) =>
                      void handleInsertRow({
                        category: line.category,
                        anchorId: line.id,
                        cloneFrom: line,
                      })
                    }
                    onRequestDelete={(id) => setConfirmDeleteId(id)}
                    onConfirmDelete={handleDeleteLine}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    onToggle={() => toggleCategory(group.category)}
                    onInsertInCategory={() =>
                      void handleInsertRow({ category: group.category })
                    }
                  />
                );
              })
            )}

            {/* Quick-Add New Category / Custom Row */}
            {quickAddOpen && (
              <tr
                data-testid="budget-quick-add-row"
                className="divide-x divide-slate-200/70 border-b border-indigo-200 bg-indigo-50/40 dark:divide-slate-800 dark:border-indigo-500/30 dark:bg-indigo-500/10"
              >
                <td className="px-2 py-2">
                  <div className="flex flex-col gap-1">
                    <input
                      list="budget-categories-datalist"
                      type="text"
                      value={qaCategory}
                      onChange={(e) => setQaCategory(e.target.value)}
                      placeholder="Catégorie..."
                      className="w-full rounded-md border border-indigo-200 bg-white px-2 py-0.5 text-[10px] font-bold tracking-wide text-indigo-700 uppercase focus:border-indigo-500 focus:outline-none dark:border-indigo-500/30 dark:bg-slate-900 dark:text-indigo-300"
                    />
                    <datalist id="budget-categories-datalist">
                      {allCategories.map((cat) => (
                        <option key={cat} value={cat} />
                      ))}
                    </datalist>
                    <input
                      type="text"
                      autoFocus
                      value={qaObjet}
                      onChange={(e) => setQaObjet(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleQuickAddSubmit();
                        } else if (e.key === "Escape") {
                          setQuickAddOpen(false);
                        }
                      }}
                      placeholder="Nom du poste de dépense..."
                      className="w-full rounded-md border border-indigo-300 bg-white px-2 py-1 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-indigo-500/40 dark:bg-slate-900 dark:text-white"
                    />
                  </div>
                </td>
                {detailedView && (
                  <>
                    <td className="px-2 py-2 text-right font-mono text-slate-400">1</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-400">1</td>
                  </>
                )}
                <td className="px-1.5 py-2">
                  <select
                    aria-label="Ressource nouveau poste"
                    value={qaResource}
                    onChange={(e) =>
                      setQaResource(e.target.value as ResourceTypeOption)
                    }
                    className={`w-full rounded-lg border px-1.5 py-1 text-[11px] font-semibold focus:outline-none ${resourceSelectStyle(qaResource)}`}
                  >
                    {RESOURCE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </td>
                {detailedView && (
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setQaMarged((prev) => !prev);
                        setQaSaleOverride(null);
                      }}
                      className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${
                        qaMarged
                          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                          : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {qaMarged ? `${defaultMarginFactor}%` : "0%"}
                    </button>
                  </td>
                )}
                <td className="px-1.5 py-2 text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Prix de vente HT"
                    value={
                      qaSaleOverride !== null
                        ? qaSaleOverride
                        : qaPreOpNum > 0
                          ? String(qaComputedSale)
                          : ""
                    }
                    placeholder="Auto"
                    onChange={(e) => setQaSaleOverride(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleQuickAddSubmit();
                      }
                    }}
                    className="w-full rounded-md border border-indigo-200 bg-white px-1.5 py-1 text-right font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-indigo-500/30 dark:bg-slate-900 dark:text-white"
                  />
                </td>
                <td className="px-1.5 py-2 text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Coût réel pré-op"
                    value={qaPreOp}
                    placeholder="0,00"
                    onChange={(e) => {
                      setQaPreOp(e.target.value);
                      setQaSaleOverride(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleQuickAddSubmit();
                      }
                    }}
                    className="w-full rounded-md border border-indigo-200 bg-white px-1.5 py-1 text-right font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-indigo-500/30 dark:bg-slate-900 dark:text-white"
                  />
                </td>
                <td className="px-1.5 py-2 text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Coût réel post-op"
                    value={qaPostOp}
                    onChange={(e) => setQaPostOp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleQuickAddSubmit();
                      }
                    }}
                    className="w-full rounded-md border border-indigo-200 bg-white px-1.5 py-1 text-right font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-indigo-500/30 dark:bg-slate-900 dark:text-white"
                  />
                </td>
                {detailedView && <td />}
                <td className="px-1 py-2 text-center">
                  <div className="flex items-center justify-center gap-0.5">
                    <button
                      type="button"
                      disabled={qaSaving}
                      onClick={() => void handleQuickAddSubmit()}
                      className="rounded bg-indigo-600 px-1.5 py-1 text-[10px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {qaSaving ? "…" : "OK"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickAddOpen(false)}
                      aria-label="Annuler l'ajout"
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>

          {filteredLines.length > 0 && (
            <tfoot className="sticky bottom-0 z-10 border-t-2 border-slate-200 bg-slate-50 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
              <tr className="divide-x divide-slate-200/70 dark:divide-slate-800">
                <td
                  colSpan={detailedView ? 4 : 2}
                  className="px-2.5 py-2.5 font-sans text-xs font-bold text-slate-800 dark:text-white"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Total ({filteredLines.length} postes)</span>
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-mono text-[10px] font-bold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                      Marge {grandMarginPct.toFixed(1)}%
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                        grandDiff > 0
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      }`}
                    >
                      Écart {grandDiff > 0 ? "+" : ""}
                      {formatEur(grandDiff)}
                    </span>
                  </div>
                </td>
                {detailedView && (
                  <td className="px-2 py-2.5 text-center font-mono text-xs font-bold text-indigo-700 dark:text-indigo-300">
                    {grandMarginPct.toFixed(1)}%
                  </td>
                )}
                <td className="px-2 py-2.5 text-right text-slate-800 dark:text-slate-200">
                  {formatEur(grandTotals.sold)}
                </td>
                <td className="px-2 py-2.5 text-right text-slate-800 dark:text-slate-200">
                  {formatEur(grandTotals.preOp)}
                </td>
                <td className="px-2 py-2.5 text-right text-slate-900 dark:text-white">
                  {formatEur(grandTotals.postOp)}
                </td>
                {detailedView && <td />}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Accessible Invoice PDF Preview Modal right from any Budget Line */}
      <PdfPreviewModal
        open={Boolean(previewInvoice)}
        title={
          previewInvoice?.renamedFilename ??
          previewInvoice?.originalFilename ??
          "Facture"
        }
        subtitle={
          previewInvoice
            ? `${previewInvoice.vendorName || "Prestataire"} · N° ${previewInvoice.invoiceNumber || "—"} · ${formatEur(previewInvoice.amountHt)} HT`
            : null
        }
        previewUrl={
          previewInvoice
            ? `/api/projects/${projectId}/invoices/${previewInvoice.id}/preview`
            : ""
        }
        driveUrl={
          previewInvoice?.driveFileId
            ? `https://drive.google.com/file/d/${previewInvoice.driveFileId}/view`
            : null
        }
        onClose={() => setPreviewInvoice(null)}
      />
    </section>
  );
}

function CategoryRows({
  category,
  rows,
  soldTotal,
  preOpTotal,
  postOpTotal,
  catMarginPct,
  catDiff,
  catOverrun,
  collapsed,
  detailedView,
  colCount,
  defaultMarginFactor,
  expandedLineIds,
  invoicesByLineId,
  quoteById,
  inlineEdit,
  savingLineId,
  insertingBelowId,
  confirmDeleteId,
  deletingId,
  onToggleExpandLine,
  onPreviewInvoice,
  onStartInline,
  onChangeInline,
  onCommitInline,
  onCancelInline,
  onResourceChange,
  onToggleMargin,
  onInsertRowBelow,
  onDuplicateRow,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onToggle,
  onInsertInCategory,
}: {
  category: string;
  rows: BudgetLineDto[];
  soldTotal: number;
  preOpTotal: number;
  postOpTotal: number;
  catMarginPct: number;
  catDiff: number;
  catOverrun: boolean;
  collapsed: boolean;
  detailedView: boolean;
  colCount: number;
  defaultMarginFactor: number;
  expandedLineIds: Set<string>;
  invoicesByLineId: Map<string, InvoiceDto[]>;
  quoteById: Map<string, QuoteDto>;
  inlineEdit: {
    lineId: string;
    field: EditableField;
    value: string;
  } | null;
  savingLineId: string | null;
  insertingBelowId: string | null;
  confirmDeleteId: string | null;
  deletingId: string | null;
  onToggleExpandLine: (lineId: string) => void;
  onPreviewInvoice: (inv: InvoiceDto) => void;
  onStartInline: (lineId: string, field: EditableField, value: string) => void;
  onChangeInline: (value: string) => void;
  onCommitInline: (
    line: BudgetLineDto,
    field: EditableField,
    value: string,
    nav?: "nextCol" | "prevCol" | "nextRow" | "prevRow"
  ) => Promise<void>;
  onCancelInline: () => void;
  onResourceChange: (
    line: BudgetLineDto,
    next: ResourceTypeOption
  ) => Promise<void>;
  onToggleMargin: (line: BudgetLineDto) => Promise<void>;
  onInsertRowBelow: (line: BudgetLineDto) => void;
  onDuplicateRow: (line: BudgetLineDto) => void;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: (line: BudgetLineDto) => Promise<void>;
  onCancelDelete: () => void;
  onToggle: () => void;
  onInsertInCategory: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer divide-x divide-slate-200/70 border-b border-slate-200 bg-slate-100/80 transition-colors hover:bg-slate-100 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-800/70 dark:hover:bg-slate-800"
      >
        <td
          colSpan={detailedView ? 4 : 2}
          className="px-2.5 py-2 text-[11px] font-bold tracking-wide text-slate-700 uppercase dark:text-slate-200"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              )}
              <span className="truncate">{category}</span>
              <span className="font-normal text-slate-400">({rows.length})</span>
              {preOpTotal > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold normal-case ${
                    catOverrun
                      ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                      : catDiff === 0
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                        : "bg-slate-200/70 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  }`}
                >
                  {catOverrun
                    ? `+${formatEur(catDiff)}`
                    : catDiff === 0
                      ? "0 € · Soldé"
                      : formatEur(catDiff)}
                </span>
              )}
            </div>
            <button
              type="button"
              disabled={insertingBelowId === `cat:${category}`}
              onClick={(e) => {
                e.stopPropagation();
                onInsertInCategory();
              }}
              title={`Ajouter une ligne dans ${category}`}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 normal-case hover:bg-indigo-100/70 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
            >
              <Plus className="h-3 w-3" />
              Ligne
            </button>
          </div>
        </td>
        {detailedView && (
          <td className="px-2 py-2 text-center font-mono text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
            {catMarginPct.toFixed(0)}%
          </td>
        )}
        <td className="px-2 py-2 text-right font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">
          {formatEur(soldTotal)}
        </td>
        <td className="px-2 py-2 text-right font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">
          {formatEur(preOpTotal)}
        </td>
        <td className="px-2 py-2 text-right font-mono text-[11px] font-semibold text-slate-900 dark:text-white">
          {formatEur(postOpTotal)}
        </td>
        {detailedView && <td />}
        <td />
      </tr>

      {!collapsed &&
        rows.map((line) => {
          const diff = round2(line.postOpTotalHt - line.preOpTotalHt);
          const isOverrun = diff > 0;
          const ratio =
            line.preOpTotalHt > 0 ? line.postOpTotalHt / line.preOpTotalHt : 0;
          const isWarning90 = !isOverrun && diff < 0 && ratio >= 0.9;
          const isExactSold = line.preOpTotalHt > 0 && diff === 0;
          const lineInvoices = invoicesByLineId.get(line.id) ?? [];
          const isExpanded = expandedLineIds.has(line.id);
          const validatedLineInvoices = lineInvoices.filter(
            (i) => i.status === "VALIDATED"
          );
          const sumInvoicesHt = round2(
            validatedLineInvoices.reduce((s, i) => s + i.amountHt, 0)
          );

          return (
            <LineRowWithDetail
              key={line.id}
              line={line}
              diff={diff}
              isOverrun={isOverrun}
              isWarning90={isWarning90}
              isExactSold={isExactSold}
              lineInvoices={lineInvoices}
              validatedLineInvoices={validatedLineInvoices}
              sumInvoicesHt={sumInvoicesHt}
              isExpanded={isExpanded}
              colCount={colCount}
              detailedView={detailedView}
              defaultMarginFactor={defaultMarginFactor}
              quoteById={quoteById}
              inlineEdit={inlineEdit}
              isSavingRow={savingLineId === line.id}
              isInsertingBelow={insertingBelowId === line.id}
              confirmingDelete={confirmDeleteId === line.id}
              isDeleting={deletingId === line.id}
              onToggleExpand={() => onToggleExpandLine(line.id)}
              onPreviewInvoice={onPreviewInvoice}
              onStartInline={onStartInline}
              onChangeInline={onChangeInline}
              onCommitInline={onCommitInline}
              onCancelInline={onCancelInline}
              onResourceChange={onResourceChange}
              onToggleMargin={onToggleMargin}
              onInsertRowBelow={() => onInsertRowBelow(line)}
              onDuplicateRow={() => onDuplicateRow(line)}
              onRequestDelete={() => onRequestDelete(line.id)}
              onConfirmDelete={() => onConfirmDelete(line)}
              onCancelDelete={onCancelDelete}
            />
          );
        })}

      {/* Notion-style group footer "+ Nouvelle ligne" */}
      {!collapsed && (
        <tr className="border-b border-slate-200/70 bg-white dark:border-slate-800 dark:bg-[#111827]">
          <td colSpan={colCount} className="px-2.5 py-1">
            <button
              type="button"
              disabled={insertingBelowId === `cat:${category}`}
              onClick={onInsertInCategory}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:bg-indigo-50/70 hover:text-indigo-600 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
            >
              <Plus className="h-3 w-3" />
              Ajouter une ligne dans {category}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

function LineRowWithDetail({
  line,
  diff,
  isOverrun,
  isWarning90,
  isExactSold,
  lineInvoices,
  validatedLineInvoices,
  sumInvoicesHt,
  isExpanded,
  colCount,
  detailedView,
  defaultMarginFactor,
  quoteById,
  inlineEdit,
  isSavingRow,
  isInsertingBelow,
  confirmingDelete,
  isDeleting,
  onToggleExpand,
  onPreviewInvoice,
  onStartInline,
  onChangeInline,
  onCommitInline,
  onCancelInline,
  onResourceChange,
  onToggleMargin,
  onInsertRowBelow,
  onDuplicateRow,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  line: BudgetLineDto;
  diff: number;
  isOverrun: boolean;
  isWarning90: boolean;
  isExactSold: boolean;
  lineInvoices: InvoiceDto[];
  validatedLineInvoices: InvoiceDto[];
  sumInvoicesHt: number;
  isExpanded: boolean;
  colCount: number;
  detailedView: boolean;
  defaultMarginFactor: number;
  quoteById: Map<string, QuoteDto>;
  inlineEdit: {
    lineId: string;
    field: EditableField;
    value: string;
  } | null;
  isSavingRow: boolean;
  isInsertingBelow: boolean;
  confirmingDelete: boolean;
  isDeleting: boolean;
  onToggleExpand: () => void;
  onPreviewInvoice: (inv: InvoiceDto) => void;
  onStartInline: (lineId: string, field: EditableField, value: string) => void;
  onChangeInline: (value: string) => void;
  onCommitInline: (
    line: BudgetLineDto,
    field: EditableField,
    value: string,
    nav?: "nextCol" | "prevCol" | "nextRow" | "prevRow"
  ) => Promise<void>;
  onCancelInline: () => void;
  onResourceChange: (
    line: BudgetLineDto,
    next: ResourceTypeOption
  ) => Promise<void>;
  onToggleMargin: (line: BudgetLineDto) => Promise<void>;
  onInsertRowBelow: () => void;
  onDuplicateRow: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => Promise<void>;
  onCancelDelete: () => void;
}) {
  const isEditing = (field: EditableField) =>
    inlineEdit?.lineId === line.id && inlineEdit.field === field;

  const resourceVal = toResourceTypeOption(line.expenseType);
  const effectiveMarginPct = resolveLineMarginPct(line);
  const isMarged = effectiveMarginPct > 0.05;

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    field: EditableField
  ) {
    if (e.key === "Enter") {
      e.preventDefault();
      void onCommitInline(line, field, inlineEdit?.value ?? "", "nextRow");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      void onCommitInline(line, field, inlineEdit?.value ?? "", "nextRow");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      void onCommitInline(line, field, inlineEdit?.value ?? "", "prevRow");
    } else if (e.key === "Tab") {
      e.preventDefault();
      void onCommitInline(
        line,
        field,
        inlineEdit?.value ?? "",
        e.shiftKey ? "prevCol" : "nextCol"
      );
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancelInline();
    }
  }

  return (
    <>
      <tr
        className={`group divide-x divide-slate-100 border-b border-slate-100 transition-colors dark:divide-slate-800/70 dark:border-slate-800/70 ${
          isSavingRow ? "opacity-75" : ""
        } ${
          isOverrun
            ? "bg-rose-50/40 hover:bg-rose-50/75 dark:bg-rose-950/20 dark:hover:bg-rose-950/35"
            : isWarning90
              ? "bg-amber-50/35 hover:bg-amber-50/70 dark:bg-amber-950/15 dark:hover:bg-amber-950/30"
              : "bg-white hover:bg-slate-50/70 dark:bg-[#111827] dark:hover:bg-slate-800/40"
        }`}
      >
        {/* 1. POSTE DE DÉPENSE (Notion + row button, expand chevron, free-text edit, Écart badge replacing Soldé) */}
        <td className="px-2 py-2 text-[12.5px] font-medium text-slate-800 dark:text-slate-100">
          <div className="flex items-center gap-1">
            {/* Notion-style '+' button right on the row to add a line immediately */}
            <button
              type="button"
              disabled={isInsertingBelow}
              onClick={onInsertRowBelow}
              title="Ajouter une ligne en dessous"
              aria-label={`Ajouter une ligne sous ${line.objet}`}
              className="shrink-0 rounded p-0.5 text-slate-300 opacity-50 transition-all hover:bg-indigo-100 hover:text-indigo-700 group-hover:opacity-100 focus:opacity-100 disabled:opacity-30 dark:text-slate-600 dark:hover:bg-indigo-500/20 dark:hover:text-indigo-300"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={onToggleExpand}
              title="Afficher le détail et les factures rattachées"
              className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              {isEditing("objet") ? (
                <input
                  type="text"
                  autoFocus
                  value={inlineEdit?.value ?? ""}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => onChangeInline(e.target.value)}
                  onBlur={() =>
                    void onCommitInline(line, "objet", inlineEdit?.value ?? "")
                  }
                  onKeyDown={(e) => handleCellKeyDown(e, "objet")}
                  className="w-full rounded-md border border-indigo-500 bg-white px-2 py-0.5 text-xs font-medium text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
                />
              ) : (
                <button
                  type="button"
                  title="Cliquer pour renommer ce poste de dépense"
                  onClick={() => onStartInline(line.id, "objet", line.objet)}
                  className="w-full truncate rounded px-1 py-0.5 text-left transition-colors hover:bg-indigo-50 hover:text-indigo-800 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-200"
                >
                  {line.objet}
                </button>
              )}
            </div>

            {lineInvoices.length > 0 && (
              <button
                type="button"
                onClick={onToggleExpand}
                data-testid={`line-invoices-toggle-${line.id}`}
                title={`${lineInvoices.length} facture(s) reliée(s)`}
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
              >
                <Receipt className="h-2.5 w-2.5" />
                {lineInvoices.length}
              </button>
            )}

            {/* Écart inline badge (replaces dedicated Écart column & old Soldé badge!) */}
            {isOverrun ? (
              <span
                data-testid="budget-alert-badge"
                title={`Écart post-op vs pré-op : +${formatEur(diff)} (dépassement)`}
                className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
              >
                +{formatEur(diff)}
              </span>
            ) : isExactSold ? (
              <span
                title="Écart : 0 € (budget exactement consommé)"
                className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              >
                0 €
              </span>
            ) : line.preOpTotalHt > 0 && diff < 0 ? (
              <span
                title={`Écart post-op vs pré-op : ${formatEur(diff)} (reste disponible)`}
                className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                  isWarning90
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
                    : "bg-emerald-50/80 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                }`}
              >
                {formatEur(diff)}
              </span>
            ) : null}
          </div>

          {validatedLineInvoices.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1 pl-9 font-mono text-[10px] text-indigo-600 dark:text-indigo-400">
              <span>
                {validatedLineInvoices
                  .map((i) => formatEur(i.amountHt))
                  .join(" + ")}
                {" = "}
                {formatEur(sumInvoicesHt)}
              </span>
              {validatedLineInvoices.map((inv) => (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => onPreviewInvoice(inv)}
                  className="inline-flex items-center gap-0.5 rounded bg-indigo-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/20 dark:text-indigo-300"
                >
                  <Eye className="h-2.5 w-2.5" />
                  {inv.invoiceNumber || "Facture"}
                </button>
              ))}
            </div>
          )}
        </td>

        {/* Detailed-only Qté & Jours */}
        {detailedView && (
          <td className="px-1.5 py-2 text-right font-mono text-slate-600 dark:text-slate-300">
            {isEditing("saleQty") ? (
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={inlineEdit?.value ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => onChangeInline(e.target.value)}
                onBlur={() =>
                  void onCommitInline(line, "saleQty", inlineEdit?.value ?? "")
                }
                onKeyDown={(e) => handleCellKeyDown(e, "saleQty")}
                className="w-12 rounded-md border border-indigo-500 bg-white px-1 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
              />
            ) : (
              <button
                type="button"
                onClick={() =>
                  onStartInline(line.id, "saleQty", String(line.saleQty))
                }
                className="rounded px-1 py-0.5 hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
              >
                {line.saleQty}
              </button>
            )}
          </td>
        )}
        {detailedView && (
          <td className="px-1.5 py-2 text-right font-mono text-slate-600 dark:text-slate-300">
            {isEditing("saleDays") ? (
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={inlineEdit?.value ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => onChangeInline(e.target.value)}
                onBlur={() =>
                  void onCommitInline(line, "saleDays", inlineEdit?.value ?? "")
                }
                onKeyDown={(e) => handleCellKeyDown(e, "saleDays")}
                className="w-12 rounded-md border border-indigo-500 bg-white px-1 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
              />
            ) : (
              <button
                type="button"
                onClick={() =>
                  onStartInline(line.id, "saleDays", String(line.saleDays))
                }
                className="rounded px-1 py-0.5 hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
              >
                {line.saleDays}
              </button>
            )}
          </td>
        )}

        {/* 2. RESSOURCE (Direct inline dropdown: Interne / Externe / Amortissement) */}
        <td className="px-1.5 py-2">
          <select
            aria-label={`Type de ressource pour ${line.objet}`}
            value={resourceVal}
            disabled={isSavingRow}
            onChange={(e) =>
              void onResourceChange(line, e.target.value as ResourceTypeOption)
            }
            className={`w-full cursor-pointer rounded-lg border px-1.5 py-1 text-[11px] font-semibold transition-colors focus:border-indigo-500 focus:outline-none disabled:opacity-50 ${resourceSelectStyle(resourceVal)}`}
          >
            {RESOURCE_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </td>

        {/* Detailed-only dedicated MARGE column (hidden in simplified view for zero horizontal scroll!) */}
        {detailedView && (
          <td className="px-1.5 py-2 text-center">
            {isEditing("marginPct") ? (
              <div className="inline-flex items-center gap-0.5">
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={inlineEdit?.value ?? ""}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => onChangeInline(e.target.value)}
                  onBlur={() =>
                    void onCommitInline(
                      line,
                      "marginPct",
                      inlineEdit?.value ?? ""
                    )
                  }
                  onKeyDown={(e) => handleCellKeyDown(e, "marginPct")}
                  className="w-12 rounded-md border border-indigo-500 bg-white px-1 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
                />
                <span className="font-mono text-[11px] text-slate-500">%</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={isSavingRow}
                  onClick={() => void onToggleMargin(line)}
                  title={
                    isMarged
                      ? "Cliquer pour passer ce poste sans marge (0%)"
                      : `Cliquer pour appliquer la marge par défaut (${defaultMarginFactor}%)`
                  }
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold transition-colors disabled:opacity-50 ${
                    isMarged
                      ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {isMarged ? "Margé" : "0%"}
                </button>
                <button
                  type="button"
                  title="Cliquer pour saisir un % de marge personnalisé"
                  onClick={() =>
                    onStartInline(
                      line.id,
                      "marginPct",
                      String(round2(effectiveMarginPct))
                    )
                  }
                  className="rounded px-1 py-0.5 font-mono text-[11px] font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-300 dark:hover:bg-indigo-500/15"
                >
                  {effectiveMarginPct.toFixed(
                    Math.abs(
                      effectiveMarginPct - Math.round(effectiveMarginPct)
                    ) < 0.05
                      ? 0
                      : 1
                  )}
                  %
                </button>
              </div>
            )}
          </td>
        )}

        {/* 3. PRIX DE VENTE HT (with discreet 1-click margin toggle micro-badge in simplified view!) */}
        <td className="px-2 py-2 text-right font-mono text-slate-700 dark:text-slate-200">
          {isEditing("saleTotalHt") ? (
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={inlineEdit?.value ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => onChangeInline(e.target.value)}
              onBlur={() =>
                void onCommitInline(
                  line,
                  "saleTotalHt",
                  inlineEdit?.value ?? ""
                )
              }
              onKeyDown={(e) => handleCellKeyDown(e, "saleTotalHt")}
              className="w-full rounded-md border border-indigo-500 bg-white px-1.5 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
            />
          ) : (
            <div className="flex flex-col items-end">
              <button
                type="button"
                title="Cliquer pour modifier le prix de vente HT (formules acceptées ex. =500*2)"
                onClick={() =>
                  onStartInline(line.id, "saleTotalHt", String(line.saleTotalHt))
                }
                className="w-full truncate rounded px-1 py-0.5 text-right transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
              >
                {formatEur(line.saleTotalHt)}
              </button>
              {!detailedView && (
                <button
                  type="button"
                  disabled={isSavingRow}
                  onClick={() => void onToggleMargin(line)}
                  title={
                    isMarged
                      ? `Marge actuelle ${effectiveMarginPct.toFixed(0)}% — cliquer pour passer à 0% (sans marge)`
                      : `Sans marge (0%) — cliquer pour appliquer ${defaultMarginFactor}%`
                  }
                  className={`mt-0.5 rounded px-1 text-[9.5px] font-semibold transition-colors ${
                    isMarged
                      ? "text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-500/20"
                      : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800"
                  }`}
                >
                  {isMarged ? `${effectiveMarginPct.toFixed(0)}%` : "0% (sans marge)"}
                </button>
              )}
            </div>
          )}
        </td>

        {/* 4. COÛT RÉEL PRÉ-OP */}
        <td className="px-2 py-2 text-right font-mono text-slate-800 dark:text-slate-100">
          {isEditing("preOpTotalHt") ? (
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={inlineEdit?.value ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => onChangeInline(e.target.value)}
              onBlur={() =>
                void onCommitInline(
                  line,
                  "preOpTotalHt",
                  inlineEdit?.value ?? ""
                )
              }
              onKeyDown={(e) => handleCellKeyDown(e, "preOpTotalHt")}
              className="w-full rounded-md border border-indigo-500 bg-white px-1.5 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
            />
          ) : (
            <button
              type="button"
              title="Cliquer pour modifier le coût réel pré-op (recalcule le prix de vente selon la marge)"
              onClick={() =>
                onStartInline(
                  line.id,
                  "preOpTotalHt",
                  String(line.preOpTotalHt)
                )
              }
              className="w-full truncate rounded px-1 py-0.5 text-right transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
            >
              {formatEur(line.preOpTotalHt)}
            </button>
          )}
        </td>

        {/* 5. COÛT RÉEL POST-OP */}
        <td
          className={`px-2 py-2 text-right font-mono font-semibold ${
            isOverrun
              ? "text-rose-600 dark:text-rose-400"
              : "text-slate-900 dark:text-white"
          }`}
        >
          {isEditing("postOpTotalHt") ? (
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={inlineEdit?.value ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => onChangeInline(e.target.value)}
              onBlur={() =>
                void onCommitInline(
                  line,
                  "postOpTotalHt",
                  inlineEdit?.value ?? ""
                )
              }
              onKeyDown={(e) => handleCellKeyDown(e, "postOpTotalHt")}
              className="w-full rounded-md border border-indigo-500 bg-white px-1.5 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
            />
          ) : (
            <button
              type="button"
              title="Cliquer pour modifier le coût réel post-op"
              onClick={() =>
                onStartInline(
                  line.id,
                  "postOpTotalHt",
                  String(line.postOpTotalHt)
                )
              }
              className="w-full truncate rounded px-1 py-0.5 text-right transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
            >
              {formatEur(line.postOpTotalHt)}
            </button>
          )}
        </td>

        {/* Detailed-only Coût/u pré-op */}
        {detailedView && (
          <td className="px-2 py-2 text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {formatEur(line.preOpUnitCost)}
          </td>
        )}

        {/* 6. ROW ACTIONS (Duplicate + Delete with inline confirm) */}
        <td className="px-1 py-2 text-center">
          {confirmingDelete ? (
            <div className="inline-flex items-center gap-0.5">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void onConfirmDelete()}
                className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {isDeleting ? "…" : "Oui"}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={onCancelDelete}
                className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                Non
              </button>
            </div>
          ) : (
            <div className="inline-flex items-center justify-center gap-0.5">
              <button
                type="button"
                disabled={isInsertingBelow}
                onClick={onDuplicateRow}
                title="Dupliquer cette ligne"
                aria-label={`Dupliquer ${line.objet}`}
                className="rounded p-1 text-slate-300 opacity-50 transition-all hover:bg-indigo-50 hover:text-indigo-600 group-hover:opacity-100 focus:opacity-100 disabled:opacity-30 dark:text-slate-600 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
              >
                <Copy className="h-3 w-3" />
              </button>
              <button
                type="button"
                disabled={lineInvoices.length > 0}
                onClick={onRequestDelete}
                title={
                  lineInvoices.length > 0
                    ? "Impossible de supprimer : des factures sont reliées à ce poste"
                    : "Supprimer cette ligne"
                }
                aria-label={`Supprimer ${line.objet}`}
                className="rounded p-1 text-slate-300 opacity-50 transition-all hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-20 dark:text-slate-600 dark:hover:bg-rose-500/15 dark:hover:text-rose-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </td>
      </tr>

      {isExpanded && (
        <tr className="border-b border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50">
          <td colSpan={colCount} className="px-6 py-4">
            <div className="space-y-3">
              {/* Addition & Calculation Breakdown */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-[#111827]">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                    <Calculator className="h-3 w-3 text-indigo-500" />
                    Détail Prix de vente HT
                  </p>
                  <p className="mt-1 font-mono text-xs text-slate-700 dark:text-slate-200">
                    {line.saleQty} qté × {line.saleDays} j ×{" "}
                    {formatEur(line.saleUnitPrice)} ={" "}
                    <strong>{formatEur(line.saleTotalHt)}</strong>
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-[#111827]">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                    <Calculator className="h-3 w-3 text-amber-500" />
                    Détail Coût réel pré-op
                  </p>
                  <p className="mt-1 font-mono text-xs text-slate-700 dark:text-slate-200">
                    {line.saleQty} qté × {line.saleDays} j ×{" "}
                    {formatEur(line.preOpUnitCost)} ={" "}
                    <strong>{formatEur(line.preOpTotalHt)}</strong>
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-[#111827]">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                    <Receipt className="h-3 w-3 text-emerald-500" />
                    Addition Coût réel post-op
                  </p>
                  <p className="mt-1 font-mono text-xs tabular-nums text-slate-700 dark:text-slate-200">
                    {validatedLineInvoices.length > 0 ? (
                      <>
                        {Math.abs(line.postOpTotalHt - sumInvoicesHt) > 0.01 && (
                          <>
                            Importé{" "}
                            {formatEur(
                              round2(line.postOpTotalHt - sumInvoicesHt)
                            )}{" "}
                            +{" "}
                          </>
                        )}
                        {validatedLineInvoices
                          .map((i) => formatEur(i.amountHt))
                          .join(" + ")}{" "}
                        = <strong>{formatEur(line.postOpTotalHt)}</strong>
                      </>
                    ) : (
                      <>
                        {line.postOpQty} qté × {line.postOpDays} j ×{" "}
                        {formatEur(line.postOpUnitCost)} ={" "}
                        <strong>{formatEur(line.postOpTotalHt)}</strong>
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Invoices Attached to this Budget Line */}
              <div>
                <p className="mb-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  Factures rattachées à ce poste ({lineInvoices.length})
                </p>
                {lineInvoices.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    Aucune facture rattachée à cette ligne pour le moment.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {lineInvoices.map((inv) => {
                      const linkedQuote = inv.quoteId
                        ? quoteById.get(inv.quoteId)
                        : null;
                      return (
                        <div
                          key={inv.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2 text-xs dark:border-slate-800 dark:bg-[#111827]"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-bold text-slate-900 dark:text-white">
                              {inv.invoiceNumber || inv.originalFilename}
                            </span>
                            <span className="text-slate-500">
                              {inv.vendorName || "Prestataire"}
                            </span>
                            {inv.invoiceDate && (
                              <span className="font-mono text-[11px] text-slate-400">
                                {inv.invoiceDate}
                              </span>
                            )}
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                inv.status === "VALIDATED"
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                  : "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                              }`}
                            >
                              {inv.status === "VALIDATED"
                                ? "Validée"
                                : "En attente"}
                            </span>
                            {linkedQuote && (
                              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                                Devis {linkedQuote.quoteNumber}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900 dark:text-white">
                              {formatEur(inv.amountHt)} HT
                            </span>
                            <button
                              type="button"
                              onClick={() => onPreviewInvoice(inv)}
                              className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
                            >
                              <Eye className="h-3 w-3" />
                              Voir la facture
                            </button>
                            {inv.driveFileId && (
                              <a
                                href={`https://drive.google.com/file/d/${inv.driveFileId}/view`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                              >
                                Drive
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
