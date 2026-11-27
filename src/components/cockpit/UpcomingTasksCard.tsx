"use client";

import { Check, Plus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  COCKPIT_OPEN_TASK_MODAL_EVENT,
  COCKPIT_TASK_CREATED_EVENT,
} from "@/components/cockpit/CockpitTaskModal";
import { getParisTodayIso } from "@/lib/shared/dates";
import { showToast } from "@/lib/toast";

export interface CockpitTaskItem {
  id: string;
  tache: string;
  phase: string;
  owner: string | null;
  endDate: string | null;
  status: string;
}

const TASK_STATUS_LABEL: Record<string, string> = {
  A_FAIRE: "À faire",
  EN_COURS: "En cours",
  EN_ATTENTE_CLIENT: "Attente client",
  TERMINE: "Terminé",
};

function formatShortDate(iso: string | null): string {
  if (!iso) return "Sans date";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

export function UpcomingTasksCard({
  projectId,
  initialTasks,
  phases = [],
}: {
  projectId: string;
  initialTasks: CockpitTaskItem[];
  phases?: string[];
}) {
  const router = useRouter();
  const [recentCreated, setRecentCreated] = useState<CockpitTaskItem[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDate, setQuickDate] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const todayIso = getParisTodayIso();

  useEffect(() => {
    const onTaskCreated = (event: Event) => {
      const detail = (
        event as CustomEvent<{ projectId?: string; task?: CockpitTaskItem }>
      ).detail;
      if (!detail?.task || detail.projectId !== projectId) return;
      const created = detail.task;
      setRecentCreated((prev) => [
        created,
        ...prev.filter((t) => t.id !== created.id),
      ]);
      setCompletedIds((prev) => {
        if (!prev.has(created.id)) return prev;
        const next = new Set(prev);
        next.delete(created.id);
        return next;
      });
    };
    window.addEventListener(COCKPIT_TASK_CREATED_EVENT, onTaskCreated);
    return () =>
      window.removeEventListener(COCKPIT_TASK_CREATED_EVENT, onTaskCreated);
  }, [projectId]);

  const tasks = useMemo(() => {
    const seen = new Set<string>();
    const merged: CockpitTaskItem[] = [];
    for (const item of [...recentCreated, ...initialTasks]) {
      if (completedIds.has(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
      if (merged.length >= 6) break;
    }
    return merged;
  }, [recentCreated, initialTasks, completedIds]);

  const defaultPhase =
    phases[0]?.trim() || tasks[0]?.phase?.trim() || "Production";

  function openTaskModal(prefill?: { title?: string; endDate?: string }) {
    window.dispatchEvent(
      new CustomEvent(COCKPIT_OPEN_TASK_MODAL_EVENT, {
        detail: {
          projectId,
          title: prefill?.title,
          endDate: prefill?.endDate,
        },
      })
    );
  }

  async function handleCompleteTask(task: CockpitTaskItem) {
    const prevStatus = task.status;
    setCompletingId(task.id);
    setCompletedIds((prev) => {
      const next = new Set(prev);
      next.add(task.id);
      return next;
    });
    try {
      const res = await fetch(`/api/projects/${projectId}/retroplanning`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, status: "TERMINE" }),
      });
      if (!res.ok) {
        setCompletedIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
        showToast("Impossible de clôturer cette tâche.", "error");
        return;
      }
      showToast(`Tâche terminée : « ${task.tache} »`, "success", {
        action: {
          label: "Annuler",
          onClick: () => {
            setCompletedIds((prev) => {
              const next = new Set(prev);
              next.delete(task.id);
              return next;
            });
            setRecentCreated((curr) =>
              curr.some((t) => t.id === task.id) ? curr : [task, ...curr]
            );
            void fetch(`/api/projects/${projectId}/retroplanning`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: task.id, status: prevStatus }),
            }).then(() => {
              window.dispatchEvent(new CustomEvent("go:shell-refresh"));
              router.refresh();
            });
          },
        },
      });
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      router.refresh();
    } catch {
      setCompletedIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      showToast(
        "Connexion interrompue. Impossible de clôturer cette tâche.",
        "error"
      );
    } finally {
      setCompletingId(null);
    }
  }

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title || addingTask) return;
    setAddingTask(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/retroplanning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: defaultPhase,
          etape: "Général",
          tache: title,
          status: "A_FAIRE",
          endDate: quickDate || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        task?: CockpitTaskItem;
        error?: string;
      };
      if (!res.ok || !json.task) {
        showToast(json.error ?? "Impossible d'ajouter la tâche.", "error");
        return;
      }
      const created = json.task;
      setRecentCreated((prev) => [
        created,
        ...prev.filter((t) => t.id !== created.id),
      ]);
      setQuickTitle("");
      setQuickDate("");
      showToast(`Tâche ajoutée : « ${title} »`);
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      router.refresh();
    } catch {
      showToast("Erreur réseau lors de la création de la tâche.", "error");
    } finally {
      setAddingTask(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
          Prochaines tâches
        </h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => openTaskModal()}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
          >
            <Plus className="h-3.5 w-3.5" />
            Nouvelle tâche
          </button>
          <Link
            href="/retroplanning"
            className="shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            Tout voir →
          </Link>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="py-5 text-center">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Aucune tâche en cours sur ce projet.
          </p>
          <button
            type="button"
            onClick={() => openTaskModal()}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Créer une tâche
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {tasks.map((task) => {
            const isLate =
              task.endDate !== null && task.endDate.slice(0, 10) < todayIso;
            return (
              <div
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <button
                    type="button"
                    disabled={completingId === task.id}
                    onClick={() => void handleCompleteTask(task)}
                    title="Marquer comme terminée"
                    aria-label={`Terminer ${task.tache}`}
                    className="-m-1.5 mt-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-transparent transition-colors hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 dark:border-slate-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500/15">
                      <Check className="h-3 w-3" />
                    </span>
                  </button>
                  <Link
                    href={`/retroplanning?taskId=${task.id}`}
                    className="min-w-0 flex-1"
                  >
                    <p className="truncate text-[13px] font-semibold text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400">
                      {task.tache}
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {task.phase}
                      {task.owner ? ` · ${task.owner}` : ""}
                    </p>
                  </Link>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`whitespace-nowrap font-mono text-xs font-medium tabular-nums ${
                      isLate
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {formatShortDate(task.endDate)}
                  </span>
                  {isLate && (
                    <span className="whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                      En retard
                    </span>
                  )}
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      task.status === "EN_ATTENTE_CLIENT"
                        ? "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                        : task.status === "EN_COURS"
                          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {TASK_STATUS_LABEL[task.status] ?? task.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Asana-style inline quick task creation */}
      <form
        onSubmit={(e) => void handleQuickAdd(e)}
        className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/90 bg-slate-50/70 px-2.5 py-2 transition-colors focus-within:border-indigo-400 focus-within:bg-white dark:border-slate-700/80 dark:bg-slate-800/40 dark:focus-within:border-indigo-500/60 dark:focus-within:bg-slate-900"
      >
        <Plus className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
        <input
          type="text"
          value={quickTitle}
          onChange={(e) => setQuickTitle(e.target.value)}
          placeholder="Ajouter une tâche rapide (Entrée)…"
          aria-label="Ajouter une tâche rapide"
          disabled={addingTask}
          className="min-w-[160px] flex-1 bg-transparent text-xs text-slate-900 placeholder:text-slate-500 focus:outline-none dark:text-white dark:placeholder:text-slate-400"
        />
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={quickDate}
            onChange={(e) => setQuickDate(e.target.value)}
            aria-label="Échéance rapide (optionnel)"
            title="Échéance (optionnel)"
            disabled={addingTask}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-700 focus:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
          <button
            type="button"
            onClick={() =>
              openTaskModal({
                title: quickTitle.trim(),
                endDate: quickDate || undefined,
              })
            }
            title="Plus d'options (responsable, phase, statut…)"
            aria-label="Ouvrir les options complètes de la tâche"
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-indigo-500/50 dark:hover:text-indigo-300"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            type="submit"
            disabled={addingTask || !quickTitle.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-45"
          >
            {addingTask ? "…" : "Ajouter"}
          </button>
        </div>
      </form>
    </section>
  );
}
