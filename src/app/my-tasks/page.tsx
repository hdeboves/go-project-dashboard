"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Filter,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShell } from "@/components/ShellContext";
import { showToast } from "@/lib/toast";

interface MyTaskItem {
  id: string;
  projectId: string;
  project: {
    id: string;
    codeProjet: string;
    client: string;
    nomJeu: string;
    category: string;
  };
  phase: string;
  etape: string | null;
  tache: string;
  owner: string | null;
  ownerUserId: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  isMilestone: boolean;
  isLate: boolean;
}

interface ProjectOption {
  id: string;
  codeProjet: string;
  client: string;
  nomJeu: string;
}

function formatDateBadge(iso: string | null): string {
  if (!iso) return "Sans échéance";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(d);
}

export default function MyTasksPage() {
  const router = useRouter();
  const { selectProject } = useShell();
  const [tasks, setTasks] = useState<MyTaskItem[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [todayIso, setTodayIso] = useState("");
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [projectFilter, setProjectFilter] = useState("ALL");

  const loadTasks = useCallback(async (targetScope: "mine" | "team") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/my-tasks?scope=${targetScope}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        todayIso: string;
        projects: ProjectOption[];
        tasks: MyTaskItem[];
      };
      setTodayIso(json.todayIso);
      setProjects(json.projects ?? []);
      setTasks(json.tasks ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) await loadTasks(scope);
    };
    void init();
    return () => {
      active = false;
    };
  }, [scope, loadTasks]);

  const filteredTasks = useMemo(() => {
    if (projectFilter === "ALL") return tasks;
    return tasks.filter((t) => t.projectId === projectFilter);
  }, [tasks, projectFilter]);

  const buckets = useMemo(() => {
    const todayMs = todayIso ? Date.parse(`${todayIso}T00:00:00Z`) : 0;
    const weekEndMs = todayMs + 7 * 86_400_000;

    const late: MyTaskItem[] = [];
    const today: MyTaskItem[] = [];
    const thisWeek: MyTaskItem[] = [];
    const waitingClient: MyTaskItem[] = [];
    const later: MyTaskItem[] = [];

    for (const t of filteredTasks) {
      if (t.status === "TERMINE") continue;
      if (t.status === "EN_ATTENTE_CLIENT") {
        waitingClient.push(t);
        continue;
      }
      if (!t.endDate) {
        later.push(t);
        continue;
      }
      const endMs = Date.parse(`${t.endDate}T00:00:00Z`);
      if (endMs < todayMs) {
        late.push(t);
      } else if (t.endDate === todayIso) {
        today.push(t);
      } else if (endMs <= weekEndMs) {
        thisWeek.push(t);
      } else {
        later.push(t);
      }
    }

    return [
      {
        key: "late",
        title: "En retard",
        accent: "text-rose-700 dark:text-rose-300",
        pill: "bg-rose-50 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
        items: late,
      },
      {
        key: "today",
        title: "Aujourd'hui",
        accent: "text-indigo-700 dark:text-indigo-300",
        pill: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
        items: today,
      },
      {
        key: "week",
        title: "Cette semaine (7 jours)",
        accent: "text-slate-800 dark:text-slate-100",
        pill: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
        items: thisWeek,
      },
      {
        key: "client",
        title: "En attente client",
        accent: "text-amber-800 dark:text-amber-300",
        pill: "bg-amber-50 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
        items: waitingClient,
      },
      {
        key: "later",
        title: "Plus tard & à planifier",
        accent: "text-slate-600 dark:text-slate-400",
        pill: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
        items: later,
      },
    ];
  }, [filteredTasks, todayIso]);

  async function handleComplete(task: MyTaskItem) {
    const prevTasks = tasks;
    const prevStatus = task.status;
    setTasks((prev) => prev.filter((t) => t.id !== task.id));

    try {
      const res = await fetch("/api/my-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, status: "TERMINE" }),
      });
      if (!res.ok) {
        setTasks(prevTasks);
        showToast("Impossible de terminer cette tâche.", "error");
        return;
      }
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      showToast(`Tâche terminée : ${task.tache}`, "success", {
        durationMs: 5000,
        action: {
          label: "Annuler",
          onClick: () => {
            setTasks(prevTasks);
            void fetch("/api/my-tasks", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ taskId: task.id, status: prevStatus }),
            }).then(() =>
              window.dispatchEvent(new CustomEvent("go:shell-refresh"))
            );
          },
        },
      });
    } catch {
      setTasks(prevTasks);
      showToast("Erreur réseau.", "error");
    }
  }

  async function handleSnooze(task: MyTaskItem, days: number) {
    const res = await fetch("/api/my-tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, snoozeDays: days }),
    });
    if (!res.ok) {
      showToast("Impossible de décaler cette tâche.", "error");
      return;
    }
    const json = (await res.json()) as { task?: { endDate: string | null } };
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, endDate: json.task?.endDate ?? t.endDate, isLate: false }
          : t
      )
    );
    showToast(
      days === 1 ? "Tâche décalée au prochain jour ouvré." : "Tâche décalée de +1 semaine."
    );
    window.dispatchEvent(new CustomEvent("go:shell-refresh"));
  }

  async function openInProject(projectId: string) {
    await selectProject(projectId);
    router.push("/retroplanning");
  }

  const totalOpen = filteredTasks.filter((t) => t.status !== "TERMINE").length;
  const totalLate = buckets[0]?.items.length ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            Productivité multi-projets
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Mes Tâches
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Toutes vos échéances actives sur l&apos;ensemble de vos projets,
            classées par urgence.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 dark:border-slate-800 dark:bg-[#111827]">
            <button
              type="button"
              onClick={() => setScope("mine")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                scope === "mine"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Mes tâches
            </button>
            <button
              type="button"
              onClick={() => setScope("team")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                scope === "team"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Tous mes projets
            </button>
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-[#111827]">
            <Filter className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            <select
              aria-label="Filtrer par projet"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none dark:text-slate-200"
            >
              <option value="ALL">Tous les projets ({projects.length})</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.client} — {p.nomJeu}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Quick Summary Strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
          <p className="text-[11px] font-semibold text-slate-500 uppercase dark:text-slate-400">
            Tâches ouvertes
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {totalOpen}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
          <p className="text-[11px] font-semibold text-slate-500 uppercase dark:text-slate-400">
            En retard
          </p>
          <p
            className={`mt-1 text-2xl font-bold tabular-nums ${
              totalLate > 0
                ? "text-rose-600 dark:text-rose-400"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {totalLate}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
          <p className="text-[11px] font-semibold text-slate-500 uppercase dark:text-slate-400">
            En attente client
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-300">
            {buckets[3]?.items.length ?? 0}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#111827]"
            />
          ))}
        </div>
      ) : totalOpen === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white px-6 py-12 text-center dark:border-slate-800 dark:bg-[#111827]">
          <Sparkles className="mx-auto h-7 w-7 text-indigo-500" />
          <h2 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
            Aucune tâche en attente — tout est à jour !
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {scope === "mine"
              ? "Passez sur « Tous mes projets » pour voir les tâches non assignées de votre équipe."
              : "Créez une tâche depuis un projet ou convertissez un compte rendu Krisp."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {buckets.map((bucket) => {
            if (bucket.items.length === 0) return null;
            return (
              <section
                key={bucket.key}
                className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {bucket.key === "late" ? (
                      <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    ) : bucket.key === "today" ? (
                      <CalendarClock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    ) : (
                      <Clock className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                    )}
                    <h2 className={`text-sm font-bold ${bucket.accent}`}>
                      {bucket.title}
                    </h2>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${bucket.pill}`}
                    >
                      {bucket.items.length}
                    </span>
                  </div>
                </div>

                <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {bucket.items.map((task) => (
                    <li
                      key={task.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleComplete(task)}
                          aria-label={`Terminer : ${task.tache}`}
                          title="Marquer comme terminée (Annuler disponible 5s)"
                          className="group -m-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-transparent transition-colors group-hover:border-emerald-500 group-hover:bg-emerald-50 group-hover:text-emerald-600 dark:border-slate-600 dark:bg-slate-900">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </span>
                        </button>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                            {task.tache}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                            <button
                              type="button"
                              onClick={() => void openInProject(task.projectId)}
                              className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-indigo-500/20 dark:hover:text-indigo-300"
                            >
                              {task.project.client} · {task.project.codeProjet}
                              <ArrowUpRight className="h-3 w-3" />
                            </button>
                            <span>{task.phase}</span>
                            {task.owner && <span>· {task.owner}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                            bucket.key === "late"
                              ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {formatDateBadge(task.endDate)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleSnooze(task, 1)}
                          title="Reporter au prochain jour ouvré"
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                        >
                          +1j
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSnooze(task, 7)}
                          title="Reporter d'une semaine"
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                        >
                          +1 sem
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
