"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastDetail } from "@/lib/toast";

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastDetail[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const scheduleDismiss = useCallback(
    (toast: ToastDetail) => {
      const existing = timersRef.current.get(toast.id);
      if (existing) clearTimeout(existing);
      const delay =
        toast.durationMs ?? (toast.action || toast.type === "error" ? 6000 : 4200);
      const timer = setTimeout(() => {
        dismiss(toast.id);
      }, delay);
      timersRef.current.set(toast.id, timer);
    },
    [dismiss]
  );

  const pauseDismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      if (!detail?.message) return;
      setToasts((prev) => [...prev.slice(-3), detail]);
      scheduleDismiss(detail);
    };
    window.addEventListener("go:toast", handler);
    return () => {
      window.removeEventListener("go:toast", handler);
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, [scheduleDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col gap-2 sm:left-auto sm:right-5 sm:bottom-5 sm:w-96">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.type === "error" ? "alert" : "status"}
          aria-live={t.type === "error" ? "assertive" : "polite"}
          onMouseEnter={() => pauseDismiss(t.id)}
          onMouseLeave={() => scheduleDismiss(t)}
          className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-medium shadow-lg backdrop-blur-md transition-all ${
            t.type === "error"
              ? "border-rose-200 bg-white/95 text-rose-800 dark:border-rose-500/40 dark:bg-slate-900/95 dark:text-rose-200"
              : t.type === "info"
                ? "border-indigo-200 bg-white/95 text-indigo-800 dark:border-indigo-500/40 dark:bg-slate-900/95 dark:text-indigo-200"
                : "border-emerald-200 bg-white/95 text-emerald-800 dark:border-emerald-500/40 dark:bg-slate-900/95 dark:text-emerald-200"
          }`}
        >
          {t.type === "error" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          ) : t.type === "info" ? (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          )}
          <span className="flex-1 leading-relaxed">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
              className="shrink-0 rounded-lg bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/20 dark:text-indigo-300 dark:hover:bg-indigo-500/30"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Fermer la notification"
            className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
