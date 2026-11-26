"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-6 text-slate-900">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-base font-bold text-slate-900">
            Interruption temporaire de GO L&apos;Intrus
          </h1>
          <p className="mt-2 text-xs text-slate-600">
            Le serveur n&apos;a pas répondu correctement. Cliquez ci-dessous
            pour recharger la page.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            Recharger l&apos;application
          </button>
        </div>
      </body>
    </html>
  );
}
