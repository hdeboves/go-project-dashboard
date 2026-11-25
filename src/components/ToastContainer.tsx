"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ToastDetail } from "@/lib/toast";

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastDetail[]>([]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      if (!detail?.text) return;
      setToasts((prev) => [...prev.slice(-3), detail]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== detail.id));
      }, 4200);
    };
    window.addEventListener("go:toast", handler);
    return () => window.removeEventListener("go:toast", handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((toast) => {
        const icon =
          toast.type === "error" ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          ) : toast.type === "info" ? (
            <Info className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          );

        const borderClass =
          toast.type === "error"
            ? "border-rose-200 dark:border-rose-500/40"
            : toast.type === "info"
              ? "border-indigo-200 dark:border-indigo-500/40"
              : "border-emerald-200 dark:border-emerald-500/40";

        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-2xl border bg-white px-4 py-3 text-xs font-medium text-slate-800 shadow-lg dark:bg-[#111827] dark:text-slate-100 ${borderClass}`}
          >
            <span className="mt-0.5">{icon}</span>
            <span className="flex-1 leading-relaxed">{toast.text}</span>
            <button
              type="button"
              aria-label="Fermer la notification"
              onClick={() =>
                setToasts((prev) => prev.filter((t) => t.id !== toast.id))
              }
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
