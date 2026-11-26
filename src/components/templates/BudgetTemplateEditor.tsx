"use client";

import {
  Check,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  PROJECT_CATEGORIES,
  PROJECT_CATEGORY_META,
  type BlankBudgetTemplateLine,
  type ProjectCategory,
} from "@/lib/templates/project-templates";
import { useTemplatesApi } from "@/components/templates/useTemplatesApi";

interface BudgetTemplateEditorProps {
  initialCategory: ProjectCategory;
  projectHasLines: boolean;
  applying?: boolean;
  onApply: (
    category: ProjectCategory,
    options: { replaceExisting: boolean }
  ) => Promise<void>;
}

export function BudgetTemplateEditor({
  initialCategory,
  projectHasLines,
  applying = false,
  onApply,
}: BudgetTemplateEditorProps) {
  const { data, loading, saving, saveBudgetTemplate, resetTemplate } =
    useTemplatesApi();
  const [selectedCat, setSelectedCat] =
    useState<ProjectCategory>(initialCategory);
  const [lastInitialCat, setLastInitialCat] =
    useState<ProjectCategory>(initialCategory);
  if (lastInitialCat !== initialCategory) {
    setLastInitialCat(initialCategory);
    setSelectedCat(initialCategory);
  }

  const [draftLines, setDraftLines] = useState<BlankBudgetTemplateLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"replace" | "append" | null>(
    null
  );

  const [syncedSource, setSyncedSource] = useState<{
    data: typeof data;
    cat: ProjectCategory;
  }>({ data: null, cat: initialCategory });
  if (data && (syncedSource.data !== data || syncedSource.cat !== selectedCat)) {
    setSyncedSource({ data, cat: selectedCat });
    const entry = data.categories.find((c) => c.category === selectedCat);
    setDraftLines(entry ? entry.budgetLines.map((l) => ({ ...l })) : []);
    setDirty(false);
  }

  function updateLine(
    index: number,
    field: keyof BlankBudgetTemplateLine,
    value: string
  ) {
    setDraftLines((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
    setDirty(true);
  }

  function addLine() {
    const lastCat =
      draftLines[draftLines.length - 1]?.category ?? "PRODUCTION";
    setDraftLines((prev) => [
      ...prev,
      {
        category: lastCat,
        objet: "Nouveau poste de dépense",
        expenseType: "Externe",
        realisePar: null,
      },
    ]);
    setDirty(true);
  }

  function removeLine(index: number) {
    setDraftLines((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  async function handleSave(): Promise<boolean> {
    const cleaned = draftLines.filter(
      (l) => l.category.trim().length > 0 && l.objet.trim().length > 0
    );
    const ok = await saveBudgetTemplate(selectedCat, cleaned);
    if (ok) setDirty(false);
    return ok;
  }

  async function handleApplyNow(replaceExisting: boolean) {
    if (dirty) {
      const ok = await handleSave();
      if (!ok) return;
    }
    setConfirmMode(null);
    await onApply(selectedCat, { replaceExisting });
  }

  return (
    <section
      data-testid="budget-template-editor"
      className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]"
    >
      <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/50 px-3.5 py-2 text-[11px] text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
        <strong>Modèle global agence</strong> — Les modifications enregistrées
        ici s&apos;appliquent à tous les futurs projets de cette catégorie pour
        toute l&apos;équipe (GamersOrigin &amp; L&apos;Intrus).
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Modèles vierges Budget (0 €) par catégorie
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Personnalisez les postes habituels créés à 0 € pour chaque type de
            projet, puis appliquez le modèle directement au budget actif.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void resetTemplate(selectedCat)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser
          </button>

          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Enregistrement..." : "Sauvegarder le modèle"}
          </button>

          {!projectHasLines ? (
            <button
              type="button"
              disabled={applying || saving}
              onClick={() => void handleApplyNow(false)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {applying
                ? "Application..."
                : `Appliquer au projet (${PROJECT_CATEGORY_META[selectedCat].shortLabel})`}
            </button>
          ) : (
            <button
              type="button"
              disabled={applying || saving}
              onClick={() => setConfirmMode("replace")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Appliquer au projet actif
            </button>
          )}
        </div>
      </div>

      {/* Confirmation bar if project already has budget lines */}
      {confirmMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <span>
            Ce projet contient déjà des lignes budgétaires. Souhaitez-vous{" "}
            <strong>remplacer tout le budget</strong> par le modèle vierge{" "}
            <strong>{PROJECT_CATEGORY_META[selectedCat].label}</strong> ?
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmMode(null)}
              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-slate-900 dark:text-amber-200"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={applying}
              onClick={() => void handleApplyNow(true)}
              className="rounded-lg bg-rose-600 px-3 py-1 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Confirmer le remplacement
            </button>
          </div>
        </div>
      )}

      {/* Category Selector Pills */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap gap-1.5 rounded-xl bg-slate-100/80 p-1 dark:bg-slate-800/70">
          {PROJECT_CATEGORIES.map((cat) => {
            const meta = PROJECT_CATEGORY_META[cat];
            const active = selectedCat === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCat(cat)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                {meta.label}
                {cat === initialCategory && (
                  <span className="ml-1.5 text-[10px] font-medium text-rose-600 dark:text-rose-400">
                    · Projet actif
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={addLine}
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter un poste
        </button>
      </div>

      {/* Lines Table */}
      {loading ? (
        <div className="space-y-2 py-6">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="h-9 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/70"
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                <th className="px-3 py-2.5">Section / Catégorie</th>
                <th className="px-3 py-2.5">Poste de dépense</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5 text-right">Montant par défaut</th>
                <th className="w-10 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {draftLines.map((line, idx) => (
                <tr
                  key={`${selectedCat}-${idx}`}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                >
                  <td className="px-2.5 py-2">
                    <input
                      type="text"
                      value={line.category}
                      onChange={(e) =>
                        updateLine(idx, "category", e.target.value)
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </td>
                  <td className="px-2.5 py-2">
                    <input
                      type="text"
                      value={line.objet}
                      onChange={(e) => updateLine(idx, "objet", e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </td>
                  <td className="px-2.5 py-2">
                    <select
                      value={line.expenseType}
                      onChange={(e) =>
                        updateLine(idx, "expenseType", e.target.value)
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      <option value="Externe">Externe</option>
                      <option value="RH Internes">RH Internes</option>
                      <option value="Amortissement">Amortissement</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    0 € (1 × 1)
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      title="Retirer cette ligne du modèle"
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
