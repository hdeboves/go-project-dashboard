"use client";

import {
  AlertCircle,
  Calculator,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  Plus,
  Receipt,
  Save,
  Search,
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
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLine, setEditingLine] = useState<BudgetLineDto | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [detailedView, setDetailedView] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    () => new Set()
  );
  const [expandedLineIds, setExpandedLineIds] = useState<Set<string>>(
    () => new Set()
  );
  const [previewInvoice, setPreviewInvoice] = useState<InvoiceDto | null>(null);

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

  function toggleExpandLine(lineId: string) {
    setExpandedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }
  const [inlineEdit, setInlineEdit] = useState<{
    lineId: string;
    field: "saleTotalHt" | "preOpTotalHt";
    value: string;
  } | null>(null);
  const [savingInline, setSavingInline] = useState(false);
  const inlineSavingRef = useRef(false);

  async function saveInlineCell(
    line: BudgetLineDto,
    field: "saleTotalHt" | "preOpTotalHt",
    rawValue: string
  ) {
    if (inlineSavingRef.current) return;
    const parsed = Math.round((Number(rawValue) || 0) * 100) / 100;
    if (parsed === line[field]) {
      setInlineEdit(null);
      return;
    }
    const safeQty = line.saleQty > 0 ? line.saleQty : 1;
    const safeDays = line.saleDays > 0 ? line.saleDays : 1;
    const denom = Math.max(0.01, safeQty * safeDays);
    const nextSaleUnitPrice =
      field === "saleTotalHt"
        ? Math.round((parsed / denom) * 100) / 100
        : line.saleUnitPrice;
    const nextPreOpUnitCost =
      field === "preOpTotalHt"
        ? Math.round((parsed / denom) * 100) / 100
        : line.preOpUnitCost;

    inlineSavingRef.current = true;
    setSavingInline(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: line.id,
          category: line.category,
          objet: line.objet,
          realisePar: line.realisePar,
          expenseType: line.expenseType,
          saleQty: safeQty,
          saleDays: safeDays,
          saleUnitPrice: nextSaleUnitPrice,
          saleTotalHt: field === "saleTotalHt" ? parsed : line.saleTotalHt,
          preOpUnitCost: nextPreOpUnitCost,
          preOpTotalHt: field === "preOpTotalHt" ? parsed : line.preOpTotalHt,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string; code?: string };
        onError(res.status, err);
        return;
      }
      setInlineEdit(null);
      showToast(`Montant mis à jour pour « ${line.objet} ».`);
      await onLineSaved();
    } finally {
      inlineSavingRef.current = false;
      setSavingInline(false);
    }
  }

  // Form fields
  const [category, setCategory] = useState("PRODUCTION");
  const [objet, setObjet] = useState("");
  const [realisePar, setRealisePar] = useState("");
  const [expenseType, setExpenseType] = useState("Externe");
  const [saleQty, setSaleQty] = useState("1");
  const [saleDays, setSaleDays] = useState("1");
  const [saleUnitPrice, setSaleUnitPrice] = useState("0");
  const [saleTotalHt, setSaleTotalHt] = useState("0");
  const [preOpUnitCost, setPreOpUnitCost] = useState("0");

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
        const hay = `${cat} ${line.objet} ${line.realisePar ?? ""} ${line.expenseType} ${line.invoiceNumbersNote ?? ""}`.toLowerCase();
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

  function toggleCategory(cat: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function openNewForm() {
    setEditingId(null);
    setEditingLine(null);
    setCategory(selectedCategory ?? "PRODUCTION");
    setObjet("");
    setRealisePar("");
    setExpenseType("Externe");
    setSaleQty("1");
    setSaleDays("1");
    setSaleUnitPrice("0");
    setSaleTotalHt("0");
    setPreOpUnitCost("0");
    setShowForm(true);
  }

  function openEditForm(line: BudgetLineDto) {
    setEditingId(line.id);
    setEditingLine(line);
    setCategory(line.category);
    setObjet(line.objet);
    setRealisePar(line.realisePar ?? "");
    setExpenseType(line.expenseType);
    setSaleQty(String(line.saleQty));
    setSaleDays(String(line.saleDays));
    setSaleUnitPrice(String(line.saleUnitPrice));
    setSaleTotalHt(String(line.saleTotalHt));
    setPreOpUnitCost(String(line.preOpUnitCost));
    setShowForm(true);
  }

  function maybeSyncSaleTotal(
    nextQty: string,
    nextDays: string,
    nextUnit: string
  ) {
    const sq = Number(nextQty) || 0;
    const sd = Number(nextDays) || 0;
    const su = Number(nextUnit) || 0;
    if (
      editingLine &&
      editingLine.saleUnitPrice === 0 &&
      editingLine.saleTotalHt > 0 &&
      su === 0
    ) {
      return;
    }
    setSaleTotalHt(String(Math.round(sq * sd * su * 100) / 100));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const sq = Number(saleQty) || 0;
      const sd = Number(saleDays) || 0;
      const su = Number(saleUnitPrice) || 0;
      const st = Math.round((Number(saleTotalHt) || 0) * 100) / 100;
      const pu = Number(preOpUnitCost) || 0;
      const computedPreOpTotal =
        editingLine &&
        editingLine.preOpUnitCost === 0 &&
        editingLine.preOpTotalHt > 0 &&
        pu === 0 &&
        sq === editingLine.saleQty &&
        sd === editingLine.saleDays
          ? editingLine.preOpTotalHt
          : Math.round(pu * sq * sd * 100) / 100;

      const res = await fetch(`/api/projects/${projectId}/budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingId ? { id: editingId } : {}),
          category: category.trim(),
          objet: objet.trim(),
          realisePar: realisePar.trim() || null,
          expenseType,
          saleQty: sq,
          saleDays: sd,
          saleUnitPrice: su,
          saleTotalHt: st,
          preOpUnitCost: pu,
          preOpTotalHt: computedPreOpTotal,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string; code?: string };
        onError(res.status, err);
        return;
      }

      setShowForm(false);
      showToast(editingId ? "Poste budgétaire mis à jour." : "Nouveau poste ajouté.");
      await onLineSaved();
    } finally {
      setSaving(false);
    }
  }

  const colCount = detailedView ? 12 : 7;

  return (
    <section
      id="budget-spreadsheet"
      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]"
    >
      {/* Clean Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un poste..."
              className="w-52 rounded-xl border border-slate-200 bg-slate-50/70 py-1.5 pr-7 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900"
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
            className="max-w-48 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={filteredLines.length === 0}
            onClick={() => {
              const headers = [
                "Catégorie",
                "Poste",
                "Type",
                "Vendu HT (€)",
                "Prévu HT (€)",
                "Facturé HT (€)",
                "Écart HT (€)",
                "Marge Atterrissage (%)",
              ];
              const rows = filteredLines.map((l) => {
                const fc = Math.max(l.preOpTotalHt, l.postOpTotalHt);
                const mPct =
                  l.saleTotalHt > 0
                    ? Math.round(((l.saleTotalHt - fc) / l.saleTotalHt) * 100)
                    : 0;
                return [
                  l.category,
                  l.objet,
                  l.expenseType,
                  l.saleTotalHt.toFixed(2),
                  l.preOpTotalHt.toFixed(2),
                  l.postOpTotalHt.toFixed(2),
                  (l.postOpTotalHt - l.preOpTotalHt).toFixed(2),
                  mPct,
                ];
              });
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
            {detailedView ? "Vue simplifiée" : "Plus de colonnes"}
          </button>

          <button
            type="button"
            onClick={openNewForm}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter un poste
          </button>
        </div>
      </div>

      {/* Add / Edit Form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="mb-5 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/60"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {editingId ? "Modifier le poste" : "Nouveau poste budgétaire"}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label
                htmlFor="budget-line-category"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Catégorie
              </label>
              <input
                id="budget-line-category"
                type="text"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-rose-400 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-objet"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Nom du poste
              </label>
              <input
                id="budget-line-objet"
                type="text"
                required
                value={objet}
                onChange={(e) => setObjet(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-rose-400 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-realise-par"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Réalisé par
              </label>
              <input
                id="budget-line-realise-par"
                type="text"
                value={realisePar}
                onChange={(e) => setRealisePar(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-rose-400 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-type"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Type
              </label>
              <select
                id="budget-line-type"
                value={expenseType}
                onChange={(e) => setExpenseType(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-rose-400 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              >
                <option value="Externe">Externe</option>
                <option value="RH Internes">RH Internes</option>
                <option value="Amortissement">Amortissement</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="budget-line-qty"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Quantité
              </label>
              <input
                id="budget-line-qty"
                type="number"
                min="0"
                step="0.01"
                value={saleQty}
                onChange={(e) => {
                  const val = e.target.value;
                  setSaleQty(val);
                  maybeSyncSaleTotal(val, saleDays, saleUnitPrice);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-rose-400 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-days"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Jours
              </label>
              <input
                id="budget-line-days"
                type="number"
                min="0"
                step="0.01"
                value={saleDays}
                onChange={(e) => {
                  const val = e.target.value;
                  setSaleDays(val);
                  maybeSyncSaleTotal(saleQty, val, saleUnitPrice);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-rose-400 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-sale-unit"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Prix vente unitaire (€)
              </label>
              <input
                id="budget-line-sale-unit"
                type="number"
                min="0"
                step="0.01"
                value={saleUnitPrice}
                onChange={(e) => {
                  const val = e.target.value;
                  setSaleUnitPrice(val);
                  maybeSyncSaleTotal(saleQty, saleDays, val);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-rose-400 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-sale-total"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Vendu total HT (€)
              </label>
              <input
                id="budget-line-sale-total"
                type="number"
                min="0"
                step="0.01"
                value={saleTotalHt}
                onChange={(e) => setSaleTotalHt(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-rose-400 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-preop-unit"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Coût prévu / unité (€)
              </label>
              <input
                id="budget-line-preop-unit"
                type="number"
                min="0"
                step="0.01"
                value={preOpUnitCost}
                onChange={(e) => setPreOpUnitCost(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-rose-400 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-300 dark:hover:bg-slate-800/70"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </form>
      )}

      {/* Crisp Adaptive Table */}
      <div className="max-h-[560px] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-semibold text-slate-500 shadow-[0_1px_0_#e2e8f0] dark:bg-slate-900 dark:text-slate-400 dark:shadow-[0_1px_0_#1e293b]">
            <tr>
              <th className="px-3.5 py-2.5">Poste</th>
              {detailedView && <th className="px-2 py-2.5">Réalisé par</th>}
              {detailedView && <th className="px-2 py-2.5 text-right">Qté</th>}
              {detailedView && <th className="px-2 py-2.5 text-right">Jours</th>}
              {!detailedView && <th className="px-2 py-2.5">Type</th>}
              <th className="px-3 py-2.5 text-right">Vendu HT</th>
              {detailedView && <th className="px-2 py-2.5">Type</th>}
              {detailedView && <th className="px-2 py-2.5 text-right">Coût/u</th>}
              <th className="px-3 py-2.5 text-right">Prévu</th>
              {detailedView && <th className="px-2 py-2.5 text-right">Qté</th>}
              {detailedView && <th className="px-2 py-2.5 text-right">Coût/u</th>}
              <th className="px-3 py-2.5 text-right">Facturé</th>
              {!detailedView && <th className="px-3 py-2.5 text-right">Écart</th>}
              <th className="px-2.5 py-2.5 text-center" />
            </tr>
          </thead>

          <tbody>
            {grouped.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                >
                  {lines.length === 0
                    ? "Aucun poste budgétaire pour le moment."
                    : "Aucun poste ne correspond à votre recherche."}
                </td>
              </tr>
            ) : (
              grouped.map((group) => {
                const isCollapsed = collapsedCategories.has(group.category);
                const catDiff =
                  Math.round((group.postOpTotal - group.preOpTotal) * 100) /
                  100;
                const catOverrun = catDiff > 0;

                return (
                  <CategoryRows
                    key={group.category}
                    category={group.category}
                    rows={group.rows}
                    soldTotal={group.soldTotal}
                    preOpTotal={group.preOpTotal}
                    postOpTotal={group.postOpTotal}
                    catDiff={catDiff}
                    catOverrun={catOverrun}
                    collapsed={isCollapsed}
                    detailedView={detailedView}
                    colCount={colCount}
                    expandedLineIds={expandedLineIds}
                    invoicesByLineId={invoicesByLineId}
                    quoteById={quoteById}
                    onToggleExpandLine={toggleExpandLine}
                    onPreviewInvoice={setPreviewInvoice}
                    inlineEdit={inlineEdit}
                    savingInline={savingInline}
                    onStartInline={(lineId, field, value) =>
                      setInlineEdit({ lineId, field, value })
                    }
                    onChangeInline={(value) =>
                      setInlineEdit((prev) => (prev ? { ...prev, value } : null))
                    }
                    onCommitInline={saveInlineCell}
                    onCancelInline={() => setInlineEdit(null)}
                    onToggle={() => toggleCategory(group.category)}
                    onEdit={openEditForm}
                  />
                );
              })
            )}
          </tbody>

          {filteredLines.length > 0 && (
            <tfoot className="sticky bottom-0 z-10 border-t-2 border-slate-200 bg-slate-50 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
              <tr>
                <td
                  colSpan={detailedView ? 4 : 2}
                  className="px-3.5 py-3 font-sans text-xs font-bold text-slate-800 dark:text-white"
                >
                  Total ({filteredLines.length} postes)
                </td>
                <td className="px-3 py-3 text-right text-slate-800 dark:text-slate-200">
                  {formatEur(grandTotals.sold)}
                </td>
                {detailedView && <td colSpan={2} />}
                <td className="px-3 py-3 text-right text-slate-800 dark:text-slate-200">
                  {formatEur(grandTotals.preOp)}
                </td>
                {detailedView && <td colSpan={2} />}
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
  catDiff,
  catOverrun,
  collapsed,
  detailedView,
  colCount,
  expandedLineIds,
  invoicesByLineId,
  quoteById,
  onToggleExpandLine,
  onPreviewInvoice,
  inlineEdit,
  savingInline,
  onStartInline,
  onChangeInline,
  onCommitInline,
  onCancelInline,
  onToggle,
  onEdit,
}: {
  category: string;
  rows: BudgetLineDto[];
  soldTotal: number;
  preOpTotal: number;
  postOpTotal: number;
  catDiff: number;
  catOverrun: boolean;
  collapsed: boolean;
  detailedView: boolean;
  colCount: number;
  expandedLineIds: Set<string>;
  invoicesByLineId: Map<string, InvoiceDto[]>;
  quoteById: Map<string, QuoteDto>;
  onToggleExpandLine: (lineId: string) => void;
  onPreviewInvoice: (inv: InvoiceDto) => void;
  inlineEdit: {
    lineId: string;
    field: "saleTotalHt" | "preOpTotalHt";
    value: string;
  } | null;
  savingInline: boolean;
  onStartInline: (
    lineId: string,
    field: "saleTotalHt" | "preOpTotalHt",
    value: string
  ) => void;
  onChangeInline: (value: string) => void;
  onCommitInline: (
    line: BudgetLineDto,
    field: "saleTotalHt" | "preOpTotalHt",
    value: string
  ) => Promise<void>;
  onCancelInline: () => void;
  onToggle: () => void;
  onEdit: (line: BudgetLineDto) => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-slate-200 bg-slate-50/90 transition-colors hover:bg-slate-100/80 dark:border-slate-800 dark:bg-slate-800/70 dark:hover:bg-slate-800"
      >
        <td
          colSpan={detailedView ? 4 : 2}
          className="px-3.5 py-2.5 text-[11px] font-bold tracking-wide text-slate-700 uppercase dark:text-slate-200"
        >
          <div className="flex items-center gap-1.5">
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            )}
            <span>{category}</span>
            <span className="font-normal text-slate-400">({rows.length})</span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          {formatEur(soldTotal)}
        </td>
        {detailedView && <td colSpan={2} />}
        <td className="px-3 py-2.5 text-right font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          {formatEur(preOpTotal)}
        </td>
        {detailedView && <td colSpan={2} />}
        <td className="px-3 py-2.5 text-right font-mono text-[11px] font-semibold text-slate-800 dark:text-white">
          {formatEur(postOpTotal)}
        </td>
        {!detailedView && (
          <td
            className={`px-3 py-2.5 text-right font-mono text-[11px] font-semibold ${
              catOverrun ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {catOverrun ? `+${formatEur(catDiff)}` : formatEur(catDiff)}
          </td>
        )}
        <td />
      </tr>

      {!collapsed &&
        rows.map((line) => {
          const diff =
            Math.round((line.postOpTotalHt - line.preOpTotalHt) * 100) / 100;
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
          const sumInvoicesHt =
            Math.round(
              validatedLineInvoices.reduce((s, i) => s + i.amountHt, 0) * 100
            ) / 100;

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
              quoteById={quoteById}
              inlineEdit={inlineEdit}
              savingInline={savingInline}
              onToggleExpand={() => onToggleExpandLine(line.id)}
              onPreviewInvoice={onPreviewInvoice}
              onStartInline={onStartInline}
              onChangeInline={onChangeInline}
              onCommitInline={onCommitInline}
              onCancelInline={onCancelInline}
              onEdit={onEdit}
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
  quoteById,
  inlineEdit,
  savingInline,
  onToggleExpand,
  onPreviewInvoice,
  onStartInline,
  onChangeInline,
  onCommitInline,
  onCancelInline,
  onEdit,
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
  quoteById: Map<string, QuoteDto>;
  inlineEdit: {
    lineId: string;
    field: "saleTotalHt" | "preOpTotalHt";
    value: string;
  } | null;
  savingInline: boolean;
  onToggleExpand: () => void;
  onPreviewInvoice: (inv: InvoiceDto) => void;
  onStartInline: (
    lineId: string,
    field: "saleTotalHt" | "preOpTotalHt",
    value: string
  ) => void;
  onChangeInline: (value: string) => void;
  onCommitInline: (
    line: BudgetLineDto,
    field: "saleTotalHt" | "preOpTotalHt",
    value: string
  ) => Promise<void>;
  onCancelInline: () => void;
  onEdit: (line: BudgetLineDto) => void;
}) {
  return (
    <>
      <tr
        className={`border-b border-slate-100 transition-colors dark:border-slate-800/70 ${
          isOverrun
            ? "bg-rose-50/40 hover:bg-rose-50/80 dark:bg-rose-950/20 dark:hover:bg-rose-950/35"
            : isWarning90
              ? "bg-amber-50/35 hover:bg-amber-50/70 dark:bg-amber-950/15 dark:hover:bg-amber-950/30"
              : "bg-white hover:bg-slate-50/70 dark:bg-[#111827] dark:hover:bg-slate-800/40"
        }`}
      >
        <td className="px-3.5 py-3 text-[13px] font-medium text-slate-800 dark:text-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleExpand}
              title="Afficher le détail de l'addition et les factures"
              className="rounded p-0.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
            <span>{line.objet}</span>
            {lineInvoices.length > 0 && (
              <button
                type="button"
                onClick={onToggleExpand}
                data-testid={`line-invoices-toggle-${line.id}`}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
              >
                <Receipt className="h-2.5 w-2.5" />
                {lineInvoices.length} facture{lineInvoices.length > 1 ? "s" : ""}
              </button>
            )}
            {isOverrun && (
              <span
                data-testid="budget-alert-badge"
                className="rounded-full bg-rose-100 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
              >
                +{formatEur(diff)}
              </span>
            )}
            {isWarning90 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                {Math.round(ratio * 100)}%
              </span>
            )}
            {isExactSold && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                Soldé 100%
              </span>
            )}
          </div>
          {validatedLineInvoices.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-6 font-mono text-[10px] text-indigo-600 dark:text-indigo-400">
              <span>
                {validatedLineInvoices
                  .map((i) => formatEur(i.amountHt))
                  .join(" + ")}{" "}
                = {formatEur(sumInvoicesHt)}
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
          ) : line.invoiceNumbersNote ? (
            <div className="mt-0.5 pl-6 font-mono text-[10px] text-indigo-600 dark:text-indigo-400">
              {line.invoiceNumbersNote}
            </div>
          ) : null}
        </td>

        {detailedView && (
          <td className="px-2 py-2.5 text-slate-500 dark:text-slate-400">
            {line.realisePar ?? "—"}
          </td>
        )}
        {detailedView && (
          <td className="px-2 py-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
            {line.saleQty}
          </td>
        )}
        {detailedView && (
          <td className="px-2 py-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
            {line.saleDays}
          </td>
        )}

        {!detailedView && (
          <td className="px-2 py-2.5">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {line.expenseType}
            </span>
          </td>
        )}

        <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
          {inlineEdit?.lineId === line.id &&
          inlineEdit.field === "saleTotalHt" ? (
            <input
              type="number"
              step="0.01"
              min="0"
              autoFocus
              disabled={savingInline}
              value={inlineEdit.value}
              onChange={(e) => onChangeInline(e.target.value)}
              onBlur={() =>
                void onCommitInline(line, "saleTotalHt", inlineEdit.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void onCommitInline(line, "saleTotalHt", inlineEdit.value);
                } else if (e.key === "Escape") {
                  onCancelInline();
                }
              }}
              className="w-24 rounded-lg border border-indigo-500 bg-white px-2 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
            />
          ) : (
            <button
              type="button"
              title="Cliquer pour modifier directement"
              onClick={() =>
                onStartInline(line.id, "saleTotalHt", String(line.saleTotalHt))
              }
              className="rounded px-1.5 py-0.5 transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
            >
              {formatEur(line.saleTotalHt)}
            </button>
          )}
        </td>

        {detailedView && (
          <td className="px-2 py-2.5">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {line.expenseType}
            </span>
          </td>
        )}
        {detailedView && (
          <td className="px-2 py-2.5 text-right font-mono text-slate-500 dark:text-slate-400">
            {formatEur(line.preOpUnitCost)}
          </td>
        )}

        <td className="px-3 py-2.5 text-right font-mono text-slate-700 dark:text-slate-200">
          {inlineEdit?.lineId === line.id &&
          inlineEdit.field === "preOpTotalHt" ? (
            <input
              type="number"
              step="0.01"
              min="0"
              autoFocus
              disabled={savingInline}
              value={inlineEdit.value}
              onChange={(e) => onChangeInline(e.target.value)}
              onBlur={() =>
                void onCommitInline(line, "preOpTotalHt", inlineEdit.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void onCommitInline(line, "preOpTotalHt", inlineEdit.value);
                } else if (e.key === "Escape") {
                  onCancelInline();
                }
              }}
              className="w-24 rounded-lg border border-indigo-500 bg-white px-2 py-0.5 text-right font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
            />
          ) : (
            <button
              type="button"
              title="Cliquer pour modifier directement"
              onClick={() =>
                onStartInline(
                  line.id,
                  "preOpTotalHt",
                  String(line.preOpTotalHt)
                )
              }
              className="rounded px-1.5 py-0.5 transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
            >
              {formatEur(line.preOpTotalHt)}
            </button>
          )}
        </td>

        {detailedView && (
          <td className="px-2 py-2.5 text-right font-mono text-slate-500 dark:text-slate-400">
            {line.postOpQty}
          </td>
        )}
        {detailedView && (
          <td className="px-2 py-2.5 text-right font-mono text-slate-500 dark:text-slate-400">
            {formatEur(line.postOpUnitCost)}
          </td>
        )}

        <td
          className={`px-3 py-2.5 text-right font-mono font-semibold ${
            isOverrun
              ? "text-rose-600 dark:text-rose-400"
              : "text-slate-900 dark:text-white"
          }`}
        >
          <button
            type="button"
            onClick={onToggleExpand}
            title="Voir le détail de l'addition"
            className="rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {formatEur(line.postOpTotalHt)}
          </button>
        </td>

        {!detailedView && (
          <td
            className={`px-3 py-2.5 text-right font-mono font-semibold ${
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

        <td className="px-2.5 py-2.5 text-center">
          <button
            type="button"
            onClick={() => onEdit(line)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/70"
          >
            Modifier
          </button>
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
                    Détail Vendu HT
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
                    Détail Prévu Pré-Op
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
                    Addition Facturé Post-Op
                  </p>
                  <p className="mt-1 font-mono text-xs tabular-nums text-slate-700 dark:text-slate-200">
                    {validatedLineInvoices.length > 0 ? (
                      <>
                        {Math.abs(line.postOpTotalHt - sumInvoicesHt) > 0.01 && (
                          <>
                            Importé{" "}
                            {formatEur(
                              Math.round(
                                (line.postOpTotalHt - sumInvoicesHt) * 100
                              ) / 100
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
