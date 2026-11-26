"use client";

import {
  AlertCircle,
  Calculator,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  Percent,
  Plus,
  Receipt,
  Search,
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
  | "realisePar"
  | "saleQty"
  | "saleDays"
  | "marginPct"
  | "saleTotalHt"
  | "preOpTotalHt"
  | "postOpTotalHt";

const SIMPLE_TAB_ORDER: readonly EditableField[] = [
  "objet",
  "marginPct",
  "saleTotalHt",
  "preOpTotalHt",
  "postOpTotalHt",
];

const DETAILED_TAB_ORDER: readonly EditableField[] = [
  "objet",
  "realisePar",
  "saleQty",
  "saleDays",
  "marginPct",
  "saleTotalHt",
  "preOpTotalHt",
  "postOpTotalHt",
];

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
    case "realisePar":
      return line.realisePar ?? "";
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
  onToggleOverrunsOnly,
  onLineSaved,
  onError,
}: BudgetTableProps) {
  const [search, setSearch] = useState("");
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
  const commitLockRef = useRef(false);

  // Quick-add row directly at bottom of spreadsheet
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

  const overrunCount = useMemo(
    () => lines.filter((l) => l.postOpTotalHt > l.preOpTotalHt).length,
    [lines]
  );

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) set.add(l.category.trim() || "AUTRES");
    return Array.from(set);
  }, [lines]);

  const filteredLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((line) => {
      const cat = line.category.trim() || "AUTRES";
      if (selectedCategory && cat !== selectedCategory) return false;
      if (overrunsOnly && !(line.postOpTotalHt > line.preOpTotalHt)) {
        return false;
      }
      if (q) {
        const hay =
          `${cat} ${line.objet} ${line.realisePar ?? ""} ${line.expenseType} ${toResourceTypeOption(line.expenseType)} ${line.invoiceNumbersNote ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [lines, selectedCategory, overrunsOnly, search]);

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
      realisePar: string | null;
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
      const safeQty = Math.max(0.01, patch.saleQty ?? (line.saleQty > 0 ? line.saleQty : 1));
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
          realisePar:
            patch.realisePar !== undefined ? patch.realisePar : line.realisePar,
          expenseType: patch.expenseType ?? line.expenseType,
          saleQty: safeQty,
          saleDays: safeDays,
          saleUnitPrice:
            patch.saleUnitPrice ?? round2(nextSaleTotal / denom),
          saleTotalHt: nextSaleTotal,
          preOpUnitCost:
            patch.preOpUnitCost ?? round2(nextPreOpTotal / denom),
          preOpTotalHt: nextPreOpTotal,
          postOpQty: patch.postOpQty ?? (nextPostOpTotal > 0 ? 1 : line.postOpQty),
          postOpDays: patch.postOpDays ?? (nextPostOpTotal > 0 ? 1 : line.postOpDays),
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
    nav: "nextCol" | "prevCol" | "nextRow"
  ) {
    const order = detailedView ? DETAILED_TAB_ORDER : SIMPLE_TAB_ORDER;
    if (nav === "nextRow") {
      const rowIdx = visibleOrderedRows.findIndex((r) => r.id === line.id);
      if (rowIdx >= 0 && rowIdx + 1 < visibleOrderedRows.length) {
        const nextLine = visibleOrderedRows[rowIdx + 1];
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
    nav?: "nextCol" | "prevCol" | "nextRow"
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

      if (field === "realisePar") {
        const clean = rawValue.trim() || null;
        if (clean === (line.realisePar ?? null)) {
          if (nav) focusAdjacentCell(line, field, nav);
          else setInlineEdit(null);
          return;
        }
        const ok = await persistLineUpdate(line, { realisePar: clean });
        if (ok) {
          if (nav) focusAdjacentCell({ ...line, realisePar: clean }, field, nav);
          else setInlineEdit(null);
        }
        return;
      }

      const parsed = round2(Math.max(0, Number(rawValue.replace(",", ".")) || 0));

      if (field === "marginPct") {
        const clamped = Math.min(95, parsed);
        const currentMargin = resolveLineMarginPct(line);
        if (Math.abs(clamped - currentMargin) < 0.01 && line.marginPct === clamped) {
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
            ? round2(Math.max(0, Math.min(95, ((parsed - line.preOpTotalHt) / parsed) * 100)))
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
        // Auto-recompute Prix de vente HT using the line's margin rate (43% default or 0% unmarged or custom %)
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
        const nextQty = field === "saleQty" ? Math.max(0.01, parsed) : line.saleQty;
        const nextDays = field === "saleDays" ? Math.max(0.01, parsed) : line.saleDays;
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

  const qaPreOpNum = round2(Math.max(0, Number(qaPreOp.replace(",", ".")) || 0));
  const qaMarginNum = qaMarged ? defaultMarginFactor : 0;
  const qaComputedSale = computeSaleFromCostAndMargin(qaPreOpNum, qaMarginNum);
  const qaEffectiveSale =
    qaSaleOverride !== null
      ? round2(Math.max(0, Number(qaSaleOverride.replace(",", ".")) || 0))
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
      const postOpNum = round2(
        Math.max(0, Number(qaPostOp.replace(",", ".")) || 0)
      );
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

  function openQuickAddForCategory(cat: string) {
    setQaCategory(cat);
    setQuickAddOpen(true);
  }

  const colCount = detailedView ? 12 : 8;

  return (
    <section
      id="budget-spreadsheet"
      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]"
    >
      {/* Spreadsheet Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un poste..."
              className="w-48 rounded-xl border border-slate-200 bg-slate-50/70 py-1.5 pr-7 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select
            aria-label="Filtrer par catégorie"
            value={selectedCategory ?? ""}
            onChange={(e) => onSelectCategory?.(e.target.value || null)}
            className="max-w-44 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="">Toutes les catégories</option>
            {allCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => onToggleOverrunsOnly?.(!overrunsOnly)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
              overrunsOnly
                ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-300"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/70"
            }`}
          >
            <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
            Dépassements ({overrunCount})
          </button>

          {/* Default Agency Margin Factor (43%) */}
          <div
            title="Facteur de marge par défaut appliqué quand vous activez la marge sur un poste (Prix de vente = Coût pré-op / (1 - marge))"
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200/80 bg-indigo-50/50 px-2.5 py-1 text-xs text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200"
          >
            <Percent className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="font-medium">Facteur marge :</span>
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
              className="w-11 rounded-md border border-indigo-200 bg-white px-1.5 py-0.5 text-right font-mono text-xs font-bold text-indigo-700 focus:border-indigo-500 focus:outline-none dark:border-indigo-500/40 dark:bg-slate-900 dark:text-indigo-300"
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
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
          >
            <Download className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            CSV
          </button>

          <button
            type="button"
            onClick={() => setDetailedView((v) => !v)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/70"
          >
            {detailedView ? "Vue tableur standard" : "Plus de colonnes"}
          </button>

          <button
            type="button"
            onClick={() => {
              setQaCategory(selectedCategory ?? allCategories[0] ?? "PRODUCTION");
              setQuickAddOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter un poste
          </button>
        </div>
      </div>

      <p className="mb-2.5 text-[11px] text-slate-400 dark:text-slate-500">
        Astuce tableur : cliquez directement sur n&apos;importe quelle cellule (poste, ressource, marge, montants) pour éditer · <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">Tab</kbd> cellule suivante · <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">Entrée</kbd> ligne suivante · cliquez sur le badge <strong>Marge</strong> pour basculer <strong>{defaultMarginFactor}% ↔ 0%</strong>.
      </p>

      {/* Excel-Style Responsive Spreadsheet */}
      <div className="max-h-[620px] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-semibold text-slate-600 shadow-[0_1px_0_#e2e8f0] dark:bg-slate-900 dark:text-slate-300 dark:shadow-[0_1px_0_#1e293b]">
            <tr className="divide-x divide-slate-200/70 dark:divide-slate-800">
              <th className="min-w-[230px] px-3 py-2.5">Poste de dépense</th>
              {detailedView && <th className="min-w-[130px] px-2.5 py-2.5">Réalisé par</th>}
              {detailedView && <th className="w-16 px-2 py-2.5 text-right">Qté</th>}
              {detailedView && <th className="w-16 px-2 py-2.5 text-right">Jours</th>}
              <th className="w-36 px-2.5 py-2.5">Ressource</th>
              <th className="w-32 px-2.5 py-2.5 text-center">Marge</th>
              <th className="w-36 px-3 py-2.5 text-right">Prix de vente HT</th>
              <th className="w-36 px-3 py-2.5 text-right">Coût réel pré-op</th>
              <th className="w-36 px-3 py-2.5 text-right">Coût réel post-op</th>
              {!detailedView && <th className="w-28 px-3 py-2.5 text-right">Écart</th>}
              {detailedView && <th className="w-24 px-2 py-2.5 text-right">Coût/u pré</th>}
              <th className="w-16 px-2 py-2.5 text-center" />
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
                    ? "Aucun poste budgétaire pour le moment. Cliquez sur « Ajouter un poste »."
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
                        ((group.soldTotal - group.preOpTotal) / group.soldTotal) * 100
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
                    onRequestDelete={(id) => setConfirmDeleteId(id)}
                    onConfirmDelete={handleDeleteLine}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    onToggle={() => toggleCategory(group.category)}
                    onQuickAddInCategory={() =>
                      openQuickAddForCategory(group.category)
                    }
                  />
                );
              })
            )}

            {/* Quick Inline Add Row (Excel-style) */}
            {quickAddOpen && (
              <tr
                data-testid="budget-quick-add-row"
                className="divide-x divide-slate-200/70 border-b border-indigo-200 bg-indigo-50/40 dark:divide-slate-800 dark:border-indigo-500/30 dark:bg-indigo-500/10"
              >
                <td className="px-2 py-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <input
                        list="budget-categories-datalist"
                        type="text"
                        value={qaCategory}
                        onChange={(e) => setQaCategory(e.target.value)}
                        placeholder="Catégorie..."
                        className="w-28 rounded-md border border-indigo-200 bg-white px-2 py-1 text-[10px] font-bold tracking-wide text-indigo-700 uppercase focus:border-indigo-500 focus:outline-none dark:border-indigo-500/30 dark:bg-slate-900 dark:text-indigo-300"
                      />
                      <datalist id="budget-categories-datalist">
                        {allCategories.map((cat) => (
                          <option key={cat} value={cat} />
                        ))}
                      </datalist>
                    </div>
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
                    <td className="px-2 py-2 text-slate-400">—</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-400">1</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-400">1</td>
                  </>
                )}
                <td className="px-2 py-2">
                  <select
                    aria-label="Ressource nouveau poste"
                    value={qaResource}
                    onChange={(e) =>
                      setQaResource(e.target.value as ResourceTypeOption)
                    }
                    className={`w-full rounded-lg border px-2 py-1 text-[11px] font-semibold focus:outline-none ${resourceSelectStyle(qaResource)}`}
                  >
                    {RESOURCE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setQaMarged((prev) => !prev);
                      setQaSaleOverride(null);
                    }}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-bold transition-colors ${
                      qaMarged
                        ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300"
                        : "bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {qaMarged ? `${defaultMarginFactor}%` : "0%"}
                  </button>
                </td>
                <td className="px-2 py-2 text-right">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
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
                    className="w-24 rounded-md border border-indigo-200 bg-white px-2 py-1 text-right font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-indigo-500/30 dark:bg-slate-900 dark:text-white"
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
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
                    className="w-24 rounded-md border border-indigo-200 bg-white px-2 py-1 text-right font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-indigo-500/30 dark:bg-slate-900 dark:text-white"
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    aria-label="Coût réel post-op"
                    value={qaPostOp}
                    onChange={(e) => setQaPostOp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleQuickAddSubmit();
                      }
                    }}
                    className="w-24 rounded-md border border-indigo-200 bg-white px-2 py-1 text-right font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-indigo-500/30 dark:bg-slate-900 dark:text-white"
                  />
                </td>
                {!detailedView && (
                  <td className="px-2 py-2 text-right font-mono text-[11px] text-slate-400">
                    —
                  </td>
                )}
                {detailedView && <td />}
                <td className="px-2 py-2 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      type="button"
                      disabled={qaSaving}
                      onClick={() => void handleQuickAddSubmit()}
                      className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {qaSaving ? "..." : "OK"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickAddOpen(false)}
                      aria-label="Annuler l'ajout"
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
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
                  colSpan={detailedView ? 5 : 2}
                  className="px-3 py-3 font-sans text-xs font-bold text-slate-800 dark:text-white"
                >
                  Total ({filteredLines.length} postes)
                </td>
                <td className="px-2.5 py-3 text-center font-mono text-xs font-bold text-indigo-700 dark:text-indigo-300">
                  {grandMarginPct.toFixed(1)}%
                </td>
                <td className="px-3 py-3 text-right text-slate-800 dark:text-slate-200">
                  {formatEur(grandTotals.sold)}
                </td>
                <td className="px-3 py-3 text-right text-slate-800 dark:text-slate-200">
                  {formatEur(grandTotals.preOp)}
                </td>
                <td className="px-3 py-3 text-right text-slate-900 dark:text-white">
                  {formatEur(grandTotals.postOp)}
                </td>
                {!detailedView && (
                  <td
                    className={`px-3 py-3 text-right ${
                      grandTotals.postOp > grandTotals.preOp
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    {grandTotals.postOp > grandTotals.preOp ? "+" : ""}
                    {formatEur(grandTotals.postOp - grandTotals.preOp)}
                  </td>
                )}
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
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onToggle,
  onQuickAddInCategory,
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
    nav?: "nextCol" | "prevCol" | "nextRow"
  ) => Promise<void>;
  onCancelInline: () => void;
  onResourceChange: (
    line: BudgetLineDto,
    next: ResourceTypeOption
  ) => Promise<void>;
  onToggleMargin: (line: BudgetLineDto) => Promise<void>;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: (line: BudgetLineDto) => Promise<void>;
  onCancelDelete: () => void;
  onToggle: () => void;
  onQuickAddInCategory: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer divide-x divide-slate-200/70 border-b border-slate-200 bg-slate-100/80 transition-colors hover:bg-slate-100 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-800/70 dark:hover:bg-slate-800"
      >
        <td
          colSpan={detailedView ? 5 : 2}
          className="px-3 py-2 text-[11px] font-bold tracking-wide text-slate-700 uppercase dark:text-slate-200"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              )}
              <span>{category}</span>
              <span className="font-normal text-slate-400">({rows.length})</span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onQuickAddInCategory();
              }}
              title={`Ajouter un poste dans ${category}`}
              className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 normal-case hover:bg-indigo-100/70 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
            >
              <Plus className="h-3 w-3" />
              Ligne
            </button>
          </div>
        </td>
        <td className="px-2.5 py-2 text-center font-mono text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
          {catMarginPct.toFixed(0)}%
        </td>
        <td className="px-3 py-2 text-right font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">
          {formatEur(soldTotal)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">
          {formatEur(preOpTotal)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-[11px] font-semibold text-slate-900 dark:text-white">
          {formatEur(postOpTotal)}
        </td>
        {!detailedView && (
          <td
            className={`px-3 py-2 text-right font-mono text-[11px] font-semibold ${
              catOverrun
                ? "text-rose-600 dark:text-rose-400"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {catOverrun ? `+${formatEur(catDiff)}` : formatEur(catDiff)}
          </td>
        )}
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
              ratio={ratio}
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
              onRequestDelete={() => onRequestDelete(line.id)}
              onConfirmDelete={() => onConfirmDelete(line)}
              onCancelDelete={onCancelDelete}
            />
          );
        })}
    </>
  );
}

function LineRowWithDetail({
  line,
  diff,
  isOverrun,
  ratio,
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
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  line: BudgetLineDto;
  diff: number;
  isOverrun: boolean;
  ratio: number;
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
    nav?: "nextCol" | "prevCol" | "nextRow"
  ) => Promise<void>;
  onCancelInline: () => void;
  onResourceChange: (
    line: BudgetLineDto,
    next: ResourceTypeOption
  ) => Promise<void>;
  onToggleMargin: (line: BudgetLineDto) => Promise<void>;
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
        className={`divide-x divide-slate-100 border-b border-slate-100 transition-colors dark:divide-slate-800/70 dark:border-slate-800/70 ${
          isSavingRow ? "opacity-75" : ""
        } ${
          isOverrun
            ? "bg-rose-50/40 hover:bg-rose-50/75 dark:bg-rose-950/20 dark:hover:bg-rose-950/35"
            : isWarning90
              ? "bg-amber-50/35 hover:bg-amber-50/70 dark:bg-amber-950/15 dark:hover:bg-amber-950/30"
              : "bg-white hover:bg-slate-50/70 dark:bg-[#111827] dark:hover:bg-slate-800/40"
        }`}
      >
        {/* 1. POSTE DE DÉPENSE (Free-text editable cell) */}
        <td className="px-2.5 py-2 text-[13px] font-medium text-slate-800 dark:text-slate-100">
          <div className="flex items-center gap-1.5">
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
                  className="w-full truncate rounded px-1.5 py-0.5 text-left transition-colors hover:bg-indigo-50 hover:text-indigo-800 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-200"
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
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
              >
                <Receipt className="h-2.5 w-2.5" />
                {lineInvoices.length}
              </button>
            )}
            {isOverrun && (
              <span
                data-testid="budget-alert-badge"
                className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
              >
                +{formatEur(diff)}
              </span>
            )}
            {isWarning90 && (
              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                {Math.round(ratio * 100)}%
              </span>
            )}
            {isExactSold && (
              <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                Soldé
              </span>
            )}
          </div>

          {validatedLineInvoices.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1 pl-6 font-mono text-[10px] text-indigo-600 dark:text-indigo-400">
              <span>
                {validatedLineInvoices.map((i) => formatEur(i.amountHt)).join(" + ")}
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

        {/* Detailed-only columns */}
        {detailedView && (
          <td className="px-2 py-2 text-slate-600 dark:text-slate-300">
            {isEditing("realisePar") ? (
              <input
                type="text"
                autoFocus
                value={inlineEdit?.value ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => onChangeInline(e.target.value)}
                onBlur={() =>
                  void onCommitInline(
                    line,
                    "realisePar",
                    inlineEdit?.value ?? ""
                  )
                }
                onKeyDown={(e) => handleCellKeyDown(e, "realisePar")}
                className="w-full rounded-md border border-indigo-500 bg-white px-2 py-0.5 text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
              />
            ) : (
              <button
                type="button"
                onClick={() =>
                  onStartInline(line.id, "realisePar", line.realisePar ?? "")
                }
                className="w-full truncate rounded px-1.5 py-0.5 text-left hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
              >
                {line.realisePar || "—"}
              </button>
            )}
          </td>
        )}
        {detailedView && (
          <td className="px-2 py-2 text-right font-mono text-slate-600 dark:text-slate-300">
            {isEditing("saleQty") ? (
              <input
                type="number"
                step="0.5"
                min="0"
                autoFocus
                value={inlineEdit?.value ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => onChangeInline(e.target.value)}
                onBlur={() =>
                  void onCommitInline(line, "saleQty", inlineEdit?.value ?? "")
                }
                onKeyDown={(e) => handleCellKeyDown(e, "saleQty")}
                className="w-14 rounded-md border border-indigo-500 bg-white px-1.5 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
              />
            ) : (
              <button
                type="button"
                onClick={() =>
                  onStartInline(line.id, "saleQty", String(line.saleQty))
                }
                className="rounded px-1.5 py-0.5 hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
              >
                {line.saleQty}
              </button>
            )}
          </td>
        )}
        {detailedView && (
          <td className="px-2 py-2 text-right font-mono text-slate-600 dark:text-slate-300">
            {isEditing("saleDays") ? (
              <input
                type="number"
                step="0.5"
                min="0"
                autoFocus
                value={inlineEdit?.value ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => onChangeInline(e.target.value)}
                onBlur={() =>
                  void onCommitInline(line, "saleDays", inlineEdit?.value ?? "")
                }
                onKeyDown={(e) => handleCellKeyDown(e, "saleDays")}
                className="w-14 rounded-md border border-indigo-500 bg-white px-1.5 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
              />
            ) : (
              <button
                type="button"
                onClick={() =>
                  onStartInline(line.id, "saleDays", String(line.saleDays))
                }
                className="rounded px-1.5 py-0.5 hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
              >
                {line.saleDays}
              </button>
            )}
          </td>
        )}

        {/* 2. RESSOURCE (Direct inline dropdown: Interne / Externe / Amortissement) */}
        <td className="px-2 py-2">
          <select
            aria-label={`Type de ressource pour ${line.objet}`}
            value={resourceVal}
            disabled={isSavingRow}
            onChange={(e) =>
              void onResourceChange(line, e.target.value as ResourceTypeOption)
            }
            className={`w-full cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors focus:border-indigo-500 focus:outline-none disabled:opacity-50 ${resourceSelectStyle(resourceVal)}`}
          >
            {RESOURCE_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </td>

        {/* 3. MARGE (1-click toggle 43% <-> 0% + inline custom % editor) */}
        <td className="px-2 py-2 text-center">
          {isEditing("marginPct") ? (
            <div className="inline-flex items-center gap-0.5">
              <input
                type="number"
                step="1"
                min="0"
                max="95"
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
                className="w-14 rounded-md border border-indigo-500 bg-white px-1.5 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
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
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors disabled:opacity-50 ${
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
                  Math.abs(effectiveMarginPct - Math.round(effectiveMarginPct)) <
                    0.05
                    ? 0
                    : 1
                )}
                %
              </button>
            </div>
          )}
        </td>

        {/* 4. PRIX DE VENTE HT */}
        <td className="px-2.5 py-2 text-right font-mono text-slate-700 dark:text-slate-200">
          {isEditing("saleTotalHt") ? (
            <input
              type="number"
              step="0.01"
              min="0"
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
              className="w-24 rounded-md border border-indigo-500 bg-white px-2 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
            />
          ) : (
            <button
              type="button"
              title="Cliquer pour modifier le prix de vente HT"
              onClick={() =>
                onStartInline(line.id, "saleTotalHt", String(line.saleTotalHt))
              }
              className="w-full rounded px-1.5 py-0.5 text-right transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
            >
              {formatEur(line.saleTotalHt)}
            </button>
          )}
        </td>

        {/* 5. COÛT RÉEL PRÉ-OP */}
        <td className="px-2.5 py-2 text-right font-mono text-slate-800 dark:text-slate-100">
          {isEditing("preOpTotalHt") ? (
            <input
              type="number"
              step="0.01"
              min="0"
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
              className="w-24 rounded-md border border-indigo-500 bg-white px-2 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
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
              className="w-full rounded px-1.5 py-0.5 text-right transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
            >
              {formatEur(line.preOpTotalHt)}
            </button>
          )}
        </td>

        {/* 6. COÛT RÉEL POST-OP */}
        <td
          className={`px-2.5 py-2 text-right font-mono font-semibold ${
            isOverrun
              ? "text-rose-600 dark:text-rose-400"
              : "text-slate-900 dark:text-white"
          }`}
        >
          {isEditing("postOpTotalHt") ? (
            <input
              type="number"
              step="0.01"
              min="0"
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
              className="w-24 rounded-md border border-indigo-500 bg-white px-2 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
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
              className="w-full rounded px-1.5 py-0.5 text-right transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
            >
              {formatEur(line.postOpTotalHt)}
            </button>
          )}
        </td>

        {/* 7. ÉCART (Standard view) OR Coût/u pré-op (Detailed view) */}
        {!detailedView && (
          <td
            className={`px-3 py-2 text-right font-mono font-semibold ${
              isOverrun
                ? "text-rose-600 dark:text-rose-400"
                : diff < 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-slate-400"
            }`}
          >
            {isOverrun ? `+${formatEur(diff)}` : formatEur(diff)}
          </td>
        )}
        {detailedView && (
          <td className="px-2 py-2 text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {formatEur(line.preOpUnitCost)}
          </td>
        )}

        {/* 8. DELETE ACTION (Inline confirm) */}
        <td className="px-2 py-2 text-center">
          {confirmingDelete ? (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void onConfirmDelete()}
                className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {isDeleting ? "..." : "Oui"}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={onCancelDelete}
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                Non
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={lineInvoices.length > 0}
              onClick={onRequestDelete}
              title={
                lineInvoices.length > 0
                  ? "Impossible de supprimer : des factures sont reliées à ce poste"
                  : "Supprimer ce poste"
              }
              aria-label={`Supprimer ${line.objet}`}
              className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-rose-500/15 dark:hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
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
