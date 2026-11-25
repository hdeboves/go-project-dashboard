import { Suspense } from "react";
import { WeeklysWorkspace } from "@/components/weeklys/WeeklysWorkspace";

export const dynamic = "force-dynamic";

export default function WeeklysPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl rounded-xl border border-[#232b3d] bg-[#11151f] p-8 text-sm text-slate-400">
          Chargement du module Weeklys Clients...
        </div>
      }
    >
      <WeeklysWorkspace />
    </Suspense>
  );
}
