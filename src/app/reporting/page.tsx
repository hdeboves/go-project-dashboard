import { Suspense } from "react";
import { ReportingDashboard } from "@/components/reporting/ReportingDashboard";

export default function ReportingPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl rounded-xl border border-[#232b3d] bg-[#11151f] p-6 text-sm text-slate-400">
          Chargement du module Reporting...
        </div>
      }
    >
      <ReportingDashboard />
    </Suspense>
  );
}
