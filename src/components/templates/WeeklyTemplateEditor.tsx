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
import type { BlankWeeklyTemplate } from "@/lib/templates/project-templates";
import { useTemplatesApi } from "@/components/templates/useTemplatesApi";

interface WeeklyTemplateEditorProps {
  onApplyToComposer: (tpl: BlankWeeklyTemplate) => void;
}

export function WeeklyTemplateEditor({
  onApplyToComposer,
}: WeeklyTemplateEditorProps) {
  const { data, loading, saving, saveWeeklyTemplate, resetTemplate } =
    useTemplatesApi();
  const [clientSteps, setClientSteps] = useState<string[]>([]);
  const [goSteps, setGoSteps] = useState<string[]>([]);
  const [summaryPlaceholder, setSummaryPlaceholder] = useState("");
  const [dirty, setDirty] = useState(false);
  const [syncedData, setSyncedData] = useState<typeof data>(null);

  if (data?.weeklyTemplate && syncedData !== data) {
    setSyncedData(data);
    setClientSteps([...data.weeklyTemplate.nextStepsClient]);
    setGoSteps([...data.weeklyTemplate.nextStepsGo]);
    setSummaryPlaceholder(data.weeklyTemplate.summaryPlaceholder);
    setDirty(false);
  }

  async function handleSave() {
    const payload: BlankWeeklyTemplate = {
      nextStepsClient: clientSteps.map((s) => s.trim()).filter(Boolean),
      nextStepsGo: goSteps.map((s) => s.trim()).filter(Boolean),
      summaryPlaceholder:
        summaryPlaceholder.trim() || "Résumé hebdomadaire à compléter.",
    };
    const ok = await saveWeeklyTemplate(payload);
    if (ok) setDirty(false);
  }

  async function handleApply() {
    const payload: BlankWeeklyTemplate = {
      nextStepsClient: clientSteps.map((s) => s.trim()).filter(Boolean),
      nextStepsGo: goSteps.map((s) => s.trim()).filter(Boolean),
      summaryPlaceholder:
        summaryPlaceholder.trim() || "Résumé hebdomadaire à compléter.",
    };
    if (dirty) {
      await saveWeeklyTemplate(payload);
      setDirty(false);
    }
    onApplyToComposer(payload);
  }

  return (
    <section
      data-testid="weekly-template-editor"
      className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]"
    >
      <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/50 px-3.5 py-2 text-[11px] text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
        <strong>Modèle global agence</strong> — Trame partagée entre toutes les
        équipes GamersOrigin &amp; L&apos;Intrus pour les Weeklys clients.
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Modèle vierge Weekly Client
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Configurez la trame par défaut (prochaines étapes Client et
            Agence) chargée lorsqu&apos;on démarre un Weekly vierge.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void resetTemplate("WEEKLY_GLOBAL")}
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

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleApply()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Charger dans le Weekly
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 py-6">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/70"
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Client Steps */}
          <div className="space-y-2.5 rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                Prochaines étapes — Côté Client
              </h3>
              <button
                type="button"
                onClick={() => {
                  setClientSteps((prev) => [...prev, ""]);
                  setDirty(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Plus className="h-3 w-3" />
                Ajouter
              </button>
            </div>
            <div className="space-y-2">
              {clientSteps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={step}
                    placeholder="Action attendue côté client..."
                    onChange={(e) => {
                      const val = e.target.value;
                      setClientSteps((prev) =>
                        prev.map((s, i) => (i === idx ? val : s))
                      );
                      setDirty(true);
                    }}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setClientSteps((prev) => prev.filter((_, i) => i !== idx));
                      setDirty(true);
                    }}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {clientSteps.length === 0 && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Aucune étape par défaut (liste vide).
                </p>
              )}
            </div>
          </div>

          {/* GO Steps */}
          <div className="space-y-2.5 rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                Prochaines étapes — Côté Agence
              </h3>
              <button
                type="button"
                onClick={() => {
                  setGoSteps((prev) => [...prev, ""]);
                  setDirty(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Plus className="h-3 w-3" />
                Ajouter
              </button>
            </div>
            <div className="space-y-2">
              {goSteps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={step}
                    placeholder="Action prévue côté agence..."
                    onChange={(e) => {
                      const val = e.target.value;
                      setGoSteps((prev) =>
                        prev.map((s, i) => (i === idx ? val : s))
                      );
                      setDirty(true);
                    }}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setGoSteps((prev) => prev.filter((_, i) => i !== idx));
                      setDirty(true);
                    }}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {goSteps.length === 0 && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Aucune étape par défaut (liste vide).
                </p>
              )}
            </div>
          </div>

          {/* Default summary text */}
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Texte d&apos;introduction / synthèse par défaut
            </label>
            <input
              type="text"
              value={summaryPlaceholder}
              onChange={(e) => {
                setSummaryPlaceholder(e.target.value);
                setDirty(true);
              }}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-xs text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
        </div>
      )}
    </section>
  );
}
