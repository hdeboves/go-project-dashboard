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
    <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
      <div className="flex items-center justify-between border-b border-[#232b3d] pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-cyan-400" />
          <h2 className="text-base font-bold text-white">
            Règles de Cascades (INFLUENCE / LANCEMENT_MAP / WEEKLY)
          </h2>
        </div>
        <span className="font-mono text-[11px] text-slate-400">
          {rules.length} règle(s)
        </span>
      </div>

      {rules.length === 0 ? (
        <p className="mt-4 text-xs text-slate-400">
          Les règles par défaut (Influence J-10/J-3/J/J+7, Map J-14/J-5/J-2/J, Weekly J-1/J) seront initialisées automatiquement avec le calendrier dédié.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                    {rule.milestoneType}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-amber-300">
                    {rule.offsetDays === 0
                      ? "J"
                      : rule.offsetDays > 0
                        ? `J+${rule.offsetDays}`
                        : `J${rule.offsetDays}`}
                  </span>
                  <span className="truncate font-medium text-white">
                    {rule.titleTemplate}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onDeleteRule(rule.id)}
                aria-label={`Supprimer règle ${rule.titleTemplate}`}
                className="rounded p-1 text-slate-400 hover:bg-red-950/40 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="mt-4 grid gap-2 rounded-lg border border-[#232b3d] bg-[#0d111a] p-3 sm:grid-cols-4"
      >
        <select
          value={milestoneType}
          onChange={(e) =>
            setMilestoneType(
              e.target.value as "INFLUENCE" | "LANCEMENT_MAP" | "WEEKLY" | "CUSTOM"
            )
          }
          className="rounded border border-[#232b3d] bg-[#171d2b] px-2 py-1.5 text-xs text-white"
        >
          <option value="INFLUENCE">INFLUENCE</option>
          <option value="LANCEMENT_MAP">LANCEMENT_MAP</option>
          <option value="WEEKLY">WEEKLY</option>
          <option value="CUSTOM">CUSTOM</option>
        </select>

        <input
          type="number"
          value={offsetDays}
          onChange={(e) => setOffsetDays(Number.parseInt(e.target.value || "0", 10))}
          placeholder="Offset (ex: -5)"
          className="rounded border border-[#232b3d] bg-[#171d2b] px-2 py-1.5 font-mono text-xs text-white"
        />

        <input
          type="text"
          value={titleTemplate}
          onChange={(e) => setTitleTemplate(e.target.value)}
          placeholder="Titre ({tache})"
          className="rounded border border-[#232b3d] bg-[#171d2b] px-2 py-1.5 text-xs text-white"
        />

        <button
          type="submit"
          disabled={adding || !titleTemplate.trim()}
          className="inline-flex items-center justify-center gap-1 rounded bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter règle
        </button>
      </form>
    </section>
  );
}
