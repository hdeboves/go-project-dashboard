import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto my-16 max-w-md rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-[#111827]">
      <p className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
        404
      </p>
      <h1 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
        Page introuvable
      </h1>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
        Ce lien n&apos;existe pas ou a été déplacé. Retournez au cockpit ou à la
        liste de vos projets.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2.5">
        <Link
          href="/"
          className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
        >
          Cockpit projet
        </Link>
        <Link
          href="/projects"
          className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          Tous les projets
        </Link>
      </div>
    </div>
  );
}
