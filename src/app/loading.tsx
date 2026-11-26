export default function AppLoading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-7 w-64 rounded-lg bg-slate-200 dark:bg-slate-800" />
        </div>
        <div className="h-9 w-36 rounded-lg bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-28 rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]"
          >
            <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="mt-3 h-7 w-32 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="mt-4 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="h-72 rounded-2xl border border-slate-200/80 bg-white lg:col-span-8 dark:border-slate-800 dark:bg-[#111827]" />
        <div className="h-72 rounded-2xl border border-slate-200/80 bg-white lg:col-span-4 dark:border-slate-800 dark:bg-[#111827]" />
      </div>
    </div>
  );
}
