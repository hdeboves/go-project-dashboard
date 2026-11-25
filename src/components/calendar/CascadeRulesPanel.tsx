"use client";

import { Plus, Sliders, Trash2 } from "lucide-react";
import { useState } from "react";

export interface CalendarRuleView {
  id: string;
  milestoneType: string;
  offsetDays: number;
  titleTemplate: string;
  descriptionTemplate: string | null;
}

const MILESTONE_LABELS: Record<string, string> = {
  INFLUENCE: "Influence",
  LANCEMENT_MAP: "Lancement",
  WEEKLY: "Weekly",
  CUSTOM: "Autre",
};

export function CascadeRulesPanel({
  rules,
  onAddRule,
  onDeleteRule,
}: {
  rules: CalendarRuleView[];
  onAddRule: (rule: {
    milestoneType: "INFLUENCE" | "LANCEMENT_MAP" | "WEEKLY" | "CUSTOM";
    offsetDays: number;
    titleTemplate: string;
    descriptionTemplate?: string;
  }) => Promise<void>;
  onDeleteRule: (ruleId: string) => Promise<void>;
}) {
  const [milestoneType, setMilestoneType] = useState<
    "INFLUENCE" | "LANCEMENT_MAP" | "WEEKLY" | "CUSTOM"
  >("INFLUENCE");
  const [offsetDays, setOffsetDays] = useState<number>(-7);
  const [titleTemplate, setTitleTemplate] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titleTemplate.trim()) return;
    setAdding(true);
    try {
      await onAddRule({
        milestoneType,
        offsetDays,
        titleTemplate: titleTemplate.trim(),
      });
      setTitleTemplate("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 dark:border-slate-800/80">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Règles de rappels automatiques
          </h2>
        </div>
        <span className="text-xs text-slate-400">{rules.length} règle(s)</span>
      </div>

      {rules.length === 0 ? (
        <p className="py-6 text-xs text-slate-500 dark:text-slate-400">
          Les rappels par défaut (J-10, J-3, Jour J, J+7) seront créés
          automatiquement avec l&apos;agenda du projet.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {[...rules]
            .sort(
              (a, b) =>
                a.milestoneType.localeCompare(b.milestoneType) ||
                a.offsetDays - b.offsetDays
            )
            .map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs dark:border-slate-800/80 dark:bg-slate-800/60"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                  {MILESTONE_LABELS[rule.milestoneType] ?? rule.milestoneType}
                </span>
                <span className="font-mono text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                  {rule.offsetDays === 0
                    ? "Jour J"
                    : rule.offsetDays > 0
                      ? `J+${rule.offsetDays}`
                      : `J${rule.offsetDays}`}
                </span>
                <span className="truncate font-medium text-slate-800 dark:text-slate-100">
                  {rule.titleTemplate}
                </span>
              </div>
              {confirmDeleteId === rule.id ? (
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteId(null);
                      void onDeleteRule(rule.id);
                    }}
                    className="rounded-lg bg-rose-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-rose-700"
                  >
                    Confirmer
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="rounded-lg px-1.5 py-1 text-[10px] text-slate-500"
                  >
                    Annuler
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(rule.id)}
                  aria-label={`Supprimer ${rule.titleTemplate}`}
                  className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15 dark:hover:text-rose-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="mt-4 space-y-2.5 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Décalage rapide :
          </span>
          {[
            { label: "J-14", val: -14 },
            { label: "J-7", val: -7 },
            { label: "J-3", val: -3 },
            { label: "Jour J", val: 0 },
            { label: "J+7", val: 7 },
          ].map((preset) => (
            <button
              key={preset.val}
              type="button"
              onClick={() => setOffsetDays(preset.val)}
              className={`rounded-lg px-2 py-0.5 font-mono text-[11px] font-semibold transition-colors ${
                offsetDays === preset.val
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-[#111827] dark:text-slate-300 dark:ring-slate-700"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          <select
            value={milestoneType}
            onChange={(e) =>
              setMilestoneType(
                e.target.value as
                  | "INFLUENCE"
                  | "LANCEMENT_MAP"
                  | "WEEKLY"
                  | "CUSTOM"
              )
            }
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-100"
          >
            <option value="INFLUENCE">Influence</option>
            <option value="LANCEMENT_MAP">Lancement</option>
            <option value="WEEKLY">Weekly</option>
            <option value="CUSTOM">Autre</option>
          </select>

          <input
            type="number"
            value={offsetDays}
            onChange={(e) =>
              setOffsetDays(Number.parseInt(e.target.value || "0", 10))
            }
            placeholder="Jours (ex: -7)"
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-800 dark:bg-[#111827] dark:text-white"
          />

          <input
            type="text"
            value={titleTemplate}
            onChange={(e) => setTitleTemplate(e.target.value)}
            placeholder="Nom du rappel..."
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-[#111827] dark:text-white"
          />

          <button
            type="submit"
            disabled={adding || !titleTemplate.trim()}
            className="inline-flex items-center justify-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-indigo-600 dark:hover:bg-indigo-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter
          </button>
        </div>
      </form>
    </section>
  );
}
