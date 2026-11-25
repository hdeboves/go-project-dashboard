"use client";

import { Plus, Save, Table2 } from "lucide-react";
import { useState } from "react";
import {
  type BudgetAlertDto,
  type BudgetLineDto,
  formatEur,
} from "@/components/budget/types";

interface BudgetTableProps {
  projectId: string;
  lines: BudgetLineDto[];
  alerts: BudgetAlertDto[];
  onLineSaved: () => Promise<void>;
  onError: (status: number, payload: { error?: string; code?: string }) => void;
}

export function BudgetTable({
  projectId,
  lines,
  alerts,
  onLineSaved,
  onError,
}: BudgetTableProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [category, setCategory] = useState("PRODUCTION");
  const [objet, setObjet] = useState("");
  const [realisePar, setRealisePar] = useState("");
  const [expenseType, setExpenseType] = useState("Externe");
  const [saleQty, setSaleQty] = useState("1");
  const [saleDays, setSaleDays] = useState("1");
  const [saleUnitPrice, setSaleUnitPrice] = useState("0");
  const [preOpUnitCost, setPreOpUnitCost] = useState("0");

  const alertByLineId = new Map<string, BudgetAlertDto>(
    alerts.map((a) => [a.budgetLineId, a])
  );

  function openNewForm() {
    setEditingId(null);
    setCategory("PRODUCTION");
    setObjet("");
    setRealisePar("");
    setExpenseType("Externe");
    setSaleQty("1");
    setSaleDays("1");
    setSaleUnitPrice("0");
    setPreOpUnitCost("0");
    setShowForm(true);
  }

  function openEditForm(line: BudgetLineDto) {
    setEditingId(line.id);
    setCategory(line.category);
    setObjet(line.objet);
    setRealisePar(line.realisePar ?? "");
    setExpenseType(line.expenseType);
    setSaleQty(String(line.saleQty));
    setSaleDays(String(line.saleDays));
    setSaleUnitPrice(String(line.saleUnitPrice));
    setPreOpUnitCost(String(line.preOpUnitCost));
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const sq = Number(saleQty) || 0;
      const sd = Number(saleDays) || 0;
      const su = Number(saleUnitPrice) || 0;
      const pu = Number(preOpUnitCost) || 0;

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
          saleTotalHt: Math.round(sq * sd * su * 100) / 100,
          preOpUnitCost: pu,
          preOpTotalHt: Math.round(pu * sq * sd * 100) / 100,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string; code?: string };
        onError(res.status, err);
        return;
      }

      setShowForm(false);
      await onLineSaved();
    } finally {
      setSaving(false);
    }
  }

  // Group lines by category preserving appearance order
  const grouped: Array<{ category: string; rows: BudgetLineDto[] }> = [];
  const catIndex = new Map<string, number>();
  for (const line of lines) {
    const cat = line.category.trim() || "AUTRES";
    const idx = catIndex.get(cat);
    if (idx === undefined) {
      catIndex.set(cat, grouped.length);
      grouped.push({ category: cat, rows: [line] });
    } else {
      grouped[idx].rows.push(line);
    }
  }

  return (
    <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Table2 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-base font-semibold text-white">
            Postes de dépenses — Vue 3 Blocs
          </h2>
          <span className="rounded-full border border-[#232b3d] bg-[#171d2b] px-2.5 py-0.5 font-mono text-xs text-slate-300">
            {lines.length} ligne(s)
          </span>
        </div>
        <button
          type="button"
          onClick={openNewForm}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20"
        >
          <Plus className="h-4 w-4" />
          Ajouter une ligne
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="mb-5 rounded-lg border border-[#232b3d] bg-[#171d2b] p-4"
        >
          <h3 className="mb-3 text-sm font-semibold text-white">
            {editingId ? "Modifier la ligne budgétaire" : "Nouvelle ligne budgétaire"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label
                htmlFor="budget-line-category"
                className="mb-1 block text-xs text-slate-300"
              >
                Catégorie
              </label>
              <input
                id="budget-line-category"
                type="text"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-3 py-1.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-objet"
                className="mb-1 block text-xs text-slate-300"
              >
                Objet
              </label>
              <input
                id="budget-line-objet"
                type="text"
                required
                value={objet}
                onChange={(e) => setObjet(e.target.value)}
                className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-3 py-1.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-realise-par"
                className="mb-1 block text-xs text-slate-300"
              >
                Réalisé par
              </label>
              <input
                id="budget-line-realise-par"
                type="text"
                value={realisePar}
                onChange={(e) => setRealisePar(e.target.value)}
                className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-3 py-1.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-type"
                className="mb-1 block text-xs text-slate-300"
              >
                Type de dépenses
              </label>
              <select
                id="budget-line-type"
                value={expenseType}
                onChange={(e) => setExpenseType(e.target.value)}
                className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-3 py-1.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
              >
                <option value="Externe">Externe</option>
                <option value="RH Internes">RH Internes</option>
                <option value="Amortissement">Amortissement</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="budget-line-qty"
                className="mb-1 block text-xs text-slate-300"
              >
                Quantité
              </label>
              <input
                id="budget-line-qty"
                type="number"
                min="0"
                step="0.01"
                value={saleQty}
                onChange={(e) => setSaleQty(e.target.value)}
                className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-3 py-1.5 font-mono text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-days"
                className="mb-1 block text-xs text-slate-300"
              >
                Jours
              </label>
              <input
                id="budget-line-days"
                type="number"
                min="0"
                step="0.01"
                value={saleDays}
                onChange={(e) => setSaleDays(e.target.value)}
                className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-3 py-1.5 font-mono text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-sale-unit"
                className="mb-1 block text-xs text-slate-300"
              >
                Prix vente unitaire (€)
              </label>
              <input
                id="budget-line-sale-unit"
                type="number"
                min="0"
                step="0.01"
                value={saleUnitPrice}
                onChange={(e) => setSaleUnitPrice(e.target.value)}
                className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-3 py-1.5 font-mono text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="budget-line-preop-unit"
                className="mb-1 block text-xs text-slate-300"
              >
                Coût réel pré-op/u (€)
              </label>
              <input
                id="budget-line-preop-unit"
                type="number"
                min="0"
                step="0.01"
                value={preOpUnitCost}
                onChange={(e) => setPreOpUnitCost(e.target.value)}
                className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-3 py-1.5 font-mono text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-[#232b3d] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#090b10]"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#e11d48] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#ff2e58] disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[#232b3d] bg-[#090b10]">
              <th
                colSpan={5}
                className="border-r border-[#232b3d] px-3 py-2 text-center text-xs font-bold tracking-wider text-cyan-300 uppercase"
              >
                Prix de vente
              </th>
              <th
                colSpan={3}
                className="border-r border-[#232b3d] px-3 py-2 text-center text-xs font-bold tracking-wider text-amber-300 uppercase"
              >
                Coûts réels pré-opération
              </th>
              <th
                colSpan={4}
                className="px-3 py-2 text-center text-xs font-bold tracking-wider text-rose-300 uppercase"
              >
                Coûts réels post-opération
              </th>
            </tr>
            <tr className="border-b border-[#232b3d] bg-[#171d2b] text-[11px] font-semibold text-slate-300">
              <th className="px-3 py-2">Objet</th>
              <th className="px-2 py-2">Réalisé par</th>
              <th className="px-2 py-2 text-right">Qté</th>
              <th className="px-2 py-2 text-right">Jours</th>
              <th className="border-r border-[#232b3d] px-3 py-2 text-right">
                Prix (€)
              </th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2 text-right">Coût/u (€)</th>
              <th className="border-r border-[#232b3d] px-3 py-2 text-right">
                Pré-op (€)
              </th>
              <th className="px-2 py-2 text-right">Qté</th>
              <th className="px-2 py-2 text-right">Coût/u (€)</th>
              <th className="px-3 py-2 text-right">Post-op (€)</th>
              <th className="px-2 py-2 text-center">Seuil / Actions</th>
            </tr>
          </thead>
          <tbody>
            {grouped.length === 0 ? (
              <tr>
                <td
                  colSpan={12}
                  className="px-4 py-8 text-center text-sm text-slate-400"
                >
                  Aucune ligne budgétaire. Importez un fichier{" "}
                  <span className="font-mono">.xlsx</span>, copiez le Budget
                  PROD dans <span className="font-mono">001.1</span> ou ajoutez
                  une ligne manuellement.
                </td>
              </tr>
            ) : (
              grouped.map((group) => (
                <FragmentGroup
                  key={group.category}
                  category={group.category}
                  rows={group.rows}
                  alertByLineId={alertByLineId}
                  onEdit={openEditForm}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FragmentGroup({
  category,
  rows,
  alertByLineId,
  onEdit,
}: {
  category: string;
  rows: BudgetLineDto[];
  alertByLineId: Map<string, BudgetAlertDto>;
  onEdit: (line: BudgetLineDto) => void;
}) {
  return (
    <>
      <tr className="border-b border-[#232b3d] bg-[#171d2b]/80">
        <td
          colSpan={12}
          className="px-3 py-2 text-xs font-bold tracking-wide text-slate-100 uppercase"
        >
          {category}
        </td>
      </tr>
      {rows.map((line) => {
        const alert = alertByLineId.get(line.id);
        return (
          <tr
            key={line.id}
            className="border-b border-[#232b3d]/60 transition-colors hover:bg-[#171d2b]/40"
          >
            <td className="px-3 py-2 font-medium text-white">
              <div>{line.objet}</div>
              {line.invoiceNumbersNote && (
                <div className="mt-0.5 font-mono text-[10px] text-cyan-300/90">
                  {line.invoiceNumbersNote}
                </div>
              )}
            </td>
            <td className="px-2 py-2 text-slate-300">
              {line.realisePar ?? "—"}
            </td>
            <td className="px-2 py-2 text-right font-mono text-slate-300">
              {line.saleQty}
            </td>
            <td className="px-2 py-2 text-right font-mono text-slate-300">
              {line.saleDays}
            </td>
            <td className="border-r border-[#232b3d] px-3 py-2 text-right font-mono font-semibold text-cyan-300">
              {formatEur(line.saleTotalHt)}
            </td>
            <td className="px-2 py-2">
              <span className="rounded bg-[#090b10] px-1.5 py-0.5 text-[10px] text-slate-300">
                {line.expenseType}
              </span>
            </td>
            <td className="px-2 py-2 text-right font-mono text-slate-300">
              {formatEur(line.preOpUnitCost)}
            </td>
            <td className="border-r border-[#232b3d] px-3 py-2 text-right font-mono font-semibold text-amber-300">
              {formatEur(line.preOpTotalHt)}
            </td>
            <td className="px-2 py-2 text-right font-mono text-slate-300">
              {line.postOpQty}
            </td>
            <td className="px-2 py-2 text-right font-mono text-slate-300">
              {formatEur(line.postOpUnitCost)}
            </td>
            <td className="px-3 py-2 text-right font-mono font-semibold text-rose-300">
              {formatEur(line.postOpTotalHt)}
            </td>
            <td className="px-2 py-2 text-center">
              <div className="flex items-center justify-center gap-1.5">
                {alert && (
                  <span
                    data-testid="budget-alert-badge"
                    title={alert.message}
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold ${
                      alert.level === "CRITICAL"
                        ? "border-red-500/60 bg-red-500/20 text-red-300"
                        : "border-amber-500/60 bg-amber-500/20 text-amber-300"
                    }`}
                  >
                    {alert.thresholdPct}%
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onEdit(line)}
                  className="rounded border border-[#232b3d] bg-[#090b10] px-2 py-0.5 text-[11px] text-slate-300 hover:border-cyan-500/50 hover:text-white"
                >
                  Éditer
                </button>
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
