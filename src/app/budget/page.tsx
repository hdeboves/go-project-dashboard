import { Suspense } from "react";
import { BudgetDashboardClient } from "@/components/budget/BudgetDashboardClient";

export default function BudgetPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl py-12 text-center text-sm text-slate-400">
          Chargement du module Budget & Factures...
        </div>
      }
    >
      <BudgetDashboardClient />
    </Suspense>
  );
}
