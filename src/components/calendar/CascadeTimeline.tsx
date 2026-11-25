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
    <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
      <div className="flex items-center justify-between border-b border-[#232b3d] pb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-rose-400" />
          <h2 className="text-base font-bold text-white">
            Échéances synchronisées (Agenda Secondaire)
          </h2>
        </div>
        <span className="font-mono text-[11px] text-slate-400">
          {events.length} événement(s)
        </span>
      </div>

      {events.length === 0 ? (
        <p className="mt-4 text-xs text-slate-400">
          Aucun événement synchronisé. Marquez une tâche comme jalon dans{" "}
          <code className="font-mono">/retroplanning</code> puis cliquez sur{" "}
          <strong>Synchroniser les cascades</strong>.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {events.map((ev) => {
            const cancelled = ev.status === "CANCELLED";
            return (
              <div
                key={ev.id}
                data-testid={`calendar-event-${ev.id}`}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
                  cancelled
                    ? "border-slate-700 bg-[#0d111a]/60 text-slate-500"
                    : "border-[#232b3d] bg-[#171d2b] text-slate-100"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-cyan-300">
                      {ev.startAt.slice(0, 10)}
                    </span>
                    <span className="truncate font-semibold">{ev.title}</span>
                  </div>
                  {ev.googleEventId && (
                    <span className="mt-0.5 block font-mono text-[10px] text-slate-400">
                      googleEventId: {ev.googleEventId}
                    </span>
                  )}
                </div>

                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                    cancelled
                      ? "border-slate-600 bg-slate-800/70 text-slate-400"
                      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  }`}
                >
                  {cancelled ? (
                    <XCircle className="h-3 w-3" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  {ev.status}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
