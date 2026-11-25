import { Suspense } from "react";
import { RetroplanningWorkspace } from "@/components/retroplanning/RetroplanningWorkspace";

export const dynamic = "force-dynamic";

export default function RetroplanningPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200/80 bg-white p-8 text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
          Chargement du planning...
        </div>
      }
    >
      <RetroplanningWorkspace />
    </Suspense>
  );
}
