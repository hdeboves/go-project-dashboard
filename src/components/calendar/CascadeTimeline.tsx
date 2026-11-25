"use client";

import { CalendarClock, CheckCircle2, XCircle } from "lucide-react";

export interface CalendarEventView {
  id: string;
  retroTaskId: string | null;
  googleEventId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  status: string;
}

export function CascadeTimeline({ events }: { events: CalendarEventView[] }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 dark:border-slate-800/80">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Prochains rappels programmés
          </h2>
        </div>
        <span className="text-xs text-slate-400">
          {events.length} événement(s)
        </span>
      </div>

      {events.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
          Aucun rappel programmé. Cochez « Jalon » sur une tâche dans Tâches &
          Planning puis cliquez sur « Mettre à jour les rappels ».
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {events.map((ev) => {
            const cancelled = ev.status === "CANCELLED";
            return (
              <div
                key={ev.id}
                data-testid={`calendar-event-${ev.id}`}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                  cancelled
                    ? "border-slate-100 bg-slate-50 text-slate-400 line-through dark:border-slate-800/80 dark:bg-slate-800/60"
                    : "border-slate-100 bg-slate-50/70 text-slate-800 dark:border-slate-800/80 dark:bg-slate-800/60 dark:text-slate-100"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="rounded-lg bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200/80 dark:bg-[#111827] dark:text-slate-200 dark:ring-slate-700">
                    {ev.startAt.slice(0, 10)}
                  </span>
                  <span className="truncate font-semibold">{ev.title}</span>
                </div>

                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                    cancelled
                      ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                  }`}
                >
                  {cancelled ? (
                    <XCircle className="h-3 w-3" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  {cancelled ? "Annulé" : "Programmé"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
