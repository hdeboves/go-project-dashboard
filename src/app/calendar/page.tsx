import { Suspense } from "react";
import { CalendarWorkspace } from "@/components/calendar/CalendarWorkspace";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200/80 bg-white p-8 text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
          Chargement de l&apos;agenda...
        </div>
      }
    >
      <CalendarWorkspace />
    </Suspense>
  );
}
