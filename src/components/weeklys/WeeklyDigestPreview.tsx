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
    <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
      <div className="flex items-center justify-between border-b border-[#232b3d] pb-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-cyan-400" />
          <h2 className="text-base font-bold text-white">
            Synthèse J-7 → J ({weekStart} → {weekEnd})
          </h2>
        </div>
        <span className="font-mono text-[11px] text-slate-400">
          {tasks.length} tâche(s) collectée(s)
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="mt-4 text-xs text-slate-400">
          Aucune tâche du rétroplanning ne chevauche la période {weekStart} → {weekEnd}.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{t.tache}</p>
                <p className="text-[11px] text-slate-400">
                  {t.phase} · {t.startDate?.slice(0, 10) ?? "?"} →{" "}
                  {t.endDate?.slice(0, 10) ?? "?"}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
                {t.status === "TERMINE" ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Clock className="h-3 w-3" />
                )}
                {t.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
