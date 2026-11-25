"use client";

import { CheckCircle2, Clock, ListChecks } from "lucide-react";

export interface WeeklyDigestTaskView {
  id: string;
  phase: string;
  etape: string | null;
  tache: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  A_FAIRE: "À faire",
  EN_COURS: "En cours",
  EN_ATTENTE_CLIENT: "Attente client",
  TERMINE: "Terminé",
};

export function WeeklyDigestPreview({
  weekStart,
  weekEnd,
  tasks,
}: {
  weekStart: string;
  weekEnd: string;
  tasks: WeeklyDigestTaskView[];
}) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 dark:border-slate-800/80">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Avancement de la semaine
          </h2>
        </div>
        <span className="text-xs text-slate-400">
          {tasks.length} tâche(s)
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
          Aucune tâche sur la période {weekStart} → {weekEnd}.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 text-xs dark:border-slate-800/80 dark:bg-slate-800/60"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                  {t.tache}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="truncate">{t.phase}</span>
                  <span className="whitespace-nowrap font-mono text-[10px]">
                    {t.startDate?.slice(0, 10) ?? "?"} →{" "}
                    {t.endDate?.slice(0, 10) ?? "?"}
                  </span>
                </p>
              </div>
              <span
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                  t.status === "TERMINE"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : t.status === "EN_ATTENTE_CLIENT"
                      ? "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                      : "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
                }`}
              >
                {t.status === "TERMINE" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <Clock className="h-3 w-3" />
                )}
                {STATUS_TEXT[t.status] ?? t.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
