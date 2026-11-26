"use client";

import { Check, GanttChartSquare, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
}: {
  projectId: string;
  initialTasks: CockpitTaskItem[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<CockpitTaskItem[]>(initialTasks);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const todayIso = getParisTodayIso();

  async function handleCompleteTask(task: CockpitTaskItem) {
    const prevTasks = tasks;
    const prevStatus = task.status;
    setCompletingId(task.id);
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      const res = await fetch(`/api/projects/${projectId}/retroplanning`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, status: "TERMINE" }),
      });
      if (!res.ok) {
        setTasks(prevTasks);
        showToast("Impossible de clôturer cette tâche.", "error");
        return;
      }
      showToast(`Tâche terminée : « ${task.tache} »`, "success", {
        action: {
          label: "Annuler",
          onClick: () => {
            setTasks((curr) =>
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
      setTasks(prevTasks);
      showToast("Connexion interrompue. Impossible de clôturer cette tâche.", "error");
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
          phase: tasks[0]?.phase || "Production",
          tache: title,
          status: "A_FAIRE",
          endDate: todayIso,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        task?: {
          id: string;
          tache: string;
          phase: string;
          owner: string | null;
          endDate: string | null;
          status: string;
        };
        error?: string;
      };
      if (!res.ok || !json.task) {
        showToast(json.error ?? "Impossible d'ajouter la tâche.", "error");
        return;
      }
      setTasks((prev) => [json.task!, ...prev].slice(0, 6));
      setQuickTitle("");
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
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
          Prochaines tâches
        </h2>
        <Link
          href="/retroplanning"
          className="shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
        >
          Tout voir →
        </Link>
      </div>

      {tasks.length === 0 ? (
        <div className="py-5 text-center">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Aucune tâche en cours sur ce projet.
          </p>
          <Link
            href="/retroplanning"
            className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            <GanttChartSquare className="h-3.5 w-3.5" />
            Ouvrir le planning pour ajouter des tâches
          </Link>
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
        className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
      >
        <Plus className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          type="text"
          value={quickTitle}
          onChange={(e) => setQuickTitle(e.target.value)}
          placeholder="Ajouter une tâche rapide (Entrée)…"
          aria-label="Ajouter une tâche rapide"
          disabled={addingTask}
          className="min-w-0 flex-1 bg-transparent text-xs text-slate-900 placeholder:text-slate-500 focus:outline-none dark:text-white dark:placeholder:text-slate-400"
        />
        {quickTitle.trim() && (
          <button
            type="submit"
            disabled={addingTask}
            className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {addingTask ? "…" : "Ajouter"}
          </button>
        )}
      </form>
    </section>
  );
}
