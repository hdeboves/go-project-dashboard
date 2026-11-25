import { Suspense } from "react";
import { WeeklysWorkspace } from "@/components/weeklys/WeeklysWorkspace";

export const dynamic = "force-dynamic";

export default function WeeklysPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200/80 bg-white p-8 text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
          Chargement des Weeklys...
        </div>
      }
    >
      <WeeklysWorkspace />
    </Suspense>
  );
}
