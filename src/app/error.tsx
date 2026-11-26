"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[APP_ERROR_BOUNDARY]", error);
  }, [error]);

  return (
    <div className="mx-auto my-12 max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-xs dark:border-rose-500/30 dark:bg-[#111827]">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h2 className="text-base font-bold text-slate-900 dark:text-white">
        Une erreur inattendue s&apos;est produite
      </h2>
      <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
        Impossible d&apos;afficher cette vue pour le moment. Vous pouvez
        réessayer ou revenir au cockpit projet.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Réessayer
        </button>
        <Link
          href="/"
          className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          Retour au cockpit
        </Link>
      </div>
    </div>
  );
}
