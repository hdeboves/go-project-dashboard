"use client";

import {
  Check,
  Flag,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { BlankRetroTemplateTask } from "@/lib/templates/project-templates";
import { useTemplatesApi } from "@/components/templates/useTemplatesApi";

interface RetroTemplateEditorProps {
  projectHasTasks: boolean;
  applying?: boolean;
  onApply: (options: { replaceExisting: boolean }) => Promise<void>;
}

export function RetroTemplateEditor({
  projectHasTasks,
  applying = false,
  onApply,
}: RetroTemplateEditorProps) {
  const { data, loading, saving, saveRetroTemplate, resetTemplate } =
    useTemplatesApi();
  const [draftTasks, setDraftTasks] = useState<BlankRetroTemplateTask[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [syncedData, setSyncedData] = useState<typeof data>(null);

  if (data && syncedData !== data) {
    setSyncedData(data);
    setDraftTasks(data.retroTasks.map((t) => ({ ...t })));
    setDirty(false);
  }

  function updateTask(
    index: number,
    patch: Partial<BlankRetroTemplateTask>
  ) {
    setDraftTasks((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
    setDirty(true);
  }

  function addTask() {
    const lastPhase =
      draftTasks[draftTasks.length - 1]?.phase ?? "3. Production";
    setDraftTasks((prev) => [
      ...prev,
      {
        phase: lastPhase,
        etape: "Production",
        tache: "Nouvelle tâche type",
        isMilestone: false,
        milestoneType: null,
      },
    ]);
    setDirty(true);
  }

  function removeTask(index: number) {
    setDraftTasks((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  async function handleSave(): Promise<boolean> {
    const cleaned = draftTasks.filter(
      (t) => t.phase.trim().length > 0 && t.tache.trim().length > 0
    );
    const ok = await saveRetroTemplate(cleaned);
    if (ok) setDirty(false);
    return ok;
  }

  async function handleApplyNow(replaceExisting: boolean) {
    if (dirty) {
      const ok = await handleSave();
      if (!ok) return;
    }
    setConfirmOpen(false);
    await onApply({ replaceExisting });
  }

  return (
    <section
      data-testid="retro-template-editor"
      className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]"
    >
      <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/50 px-3.5 py-2 text-[11px] text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
        <strong>Modèle global agence</strong> — Les tâches et jalons enregistrés
        ici servent de trame partagée pour toute l&apos;équipe (GamersOrigin
        &amp; L&apos;Intrus).
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Modèle vierge Rétroplanning (sans dates)
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Définissez les tâches et jalons récurrents créés sans dates pour
            chaque nouveau projet, puis appliquez le modèle ici en 1 clic.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void resetTemplate("RETRO_GLOBAL")}
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

          {!projectHasTasks ? (
            <button
              type="button"
              disabled={applying || saving}
              onClick={() => void handleApplyNow(false)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {applying ? "Application..." : "Appliquer au projet actif"}
            </button>
          ) : (
            <button
              type="button"
              disabled={applying || saving}
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Appliquer au projet actif
            </button>
          )}
        </div>
      </div>

      {confirmOpen && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <span>
            Ce projet possède déjà des tâches. Confirmez-vous le{" "}
            <strong>remplacement complet</strong> par les {draftTasks.length}{" "}
            tâches vierges (sans dates) ?
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
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

      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {draftTasks.length} tâche(s) configurée(s) · dates laissées vides à la
          création
        </span>
        <button
          type="button"
          onClick={addTask}
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter une tâche type
        </button>
      </div>

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
                <th className="px-3 py-2.5">Phase</th>
                <th className="px-3 py-2.5">Étape</th>
                <th className="px-3 py-2.5">Tâche</th>
                <th className="px-3 py-2.5">Jalon</th>
                <th className="w-10 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {draftTasks.map((task, idx) => (
                <tr
                  key={idx}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                >
                  <td className="px-2.5 py-2">
                    <input
                      type="text"
                      value={task.phase}
                      onChange={(e) =>
                        updateTask(idx, { phase: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </td>
                  <td className="px-2.5 py-2">
                    <input
                      type="text"
                      value={task.etape}
                      onChange={(e) =>
                        updateTask(idx, { etape: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                  </td>
                  <td className="px-2.5 py-2">
                    <input
                      type="text"
                      value={task.tache}
                      onChange={(e) =>
                        updateTask(idx, { tache: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(task.isMilestone)}
                        onChange={(e) =>
                          updateTask(idx, {
                            isMilestone: e.target.checked,
                            milestoneType: e.target.checked
                              ? (task.milestoneType ?? "CUSTOM")
                              : null,
                          })
                        }
                        className="h-3.5 w-3.5 accent-rose-600"
                      />
                      <Flag className="h-3 w-3 text-amber-500" />
                    </label>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeTask(idx)}
                      title="Retirer cette tâche du modèle"
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
