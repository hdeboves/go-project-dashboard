import { Suspense } from "react";
import { CalendarWorkspace } from "@/components/calendar/CalendarWorkspace";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl rounded-xl border border-[#232b3d] bg-[#11151f] p-8 text-sm text-slate-400">
          Chargement du module Google Agenda...
        </div>
      }
    >
      <CalendarWorkspace />
    </Suspense>
  );
}
