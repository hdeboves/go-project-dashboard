"use client";

import {
  Bell,
  CheckCheck,
  ExternalLink,
  FileText,
  Mic,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { showToast } from "@/lib/toast";

interface NotificationItem {
  id: string;
  projectId: string | null;
  projectLabel: string | null;
  type: string;
  title: string;
  message: string;
  actionUrl: string | null;
  driveUrl: string | null;
  read: boolean;
  createdAt: string;
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (diffSec < 60) return "À l'instant";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Il y a ${diffHours} h`;
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [marking, setMarking] = useState(false);
  const seenIdsRef = useRef<Set<string> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const fetchNotifications = useCallback(async (announceNew = false) => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        unreadCount: number;
        notifications: NotificationItem[];
      };

      if (seenIdsRef.current === null) {
        seenIdsRef.current = new Set(json.notifications.map((n) => n.id));
      } else if (announceNew) {
        const freshUnread = json.notifications.filter(
          (n) => !n.read && !seenIdsRef.current!.has(n.id)
        );
        for (const n of freshUnread.slice(0, 2)) {
          showToast(n.title);
        }
        for (const n of json.notifications) {
          seenIdsRef.current.add(n.id);
        }
      }

      setUnreadCount(json.unreadCount);
      setItems(json.notifications);
    } catch {
      // ignore transient network errors
    }
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) await fetchNotifications(false);
    };
    void init();

    const onRefresh = () => {
      void fetchNotifications(true);
    };
    window.addEventListener("go:shell-refresh", onRefresh);
    const interval = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void fetchNotifications(true);
    }, 30_000);

    const onVisibility = () => {
      if (!document.hidden) void fetchNotifications(true);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      window.removeEventListener("go:shell-refresh", onRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [fetchNotifications]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  async function markOneRead(id: string) {
    const target = items.find((n) => n.id === id);
    if (!target || target.read) return;
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  async function markAllRead() {
    setMarking(true);
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } finally {
      setMarking(false);
    }
  }

  async function handleOpenNotification(n: NotificationItem) {
    void markOneRead(n.id);
    if (n.projectId) {
      await fetch("/api/shell/active-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: n.projectId }),
      }).catch(() => undefined);
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    }
    setOpen(false);
    if (n.actionUrl) {
      router.push(n.actionUrl);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid="notification-bell-btn"
        onClick={() => {
          setOpen((v) => !v);
          void fetchNotifications(false);
        }}
        aria-label="Notifications"
        title="Notifications (CR Krisp & alertes)"
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-white"
      >
        <Bell className="h-3.5 w-3.5" />
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-[#0b0f17]"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Centre de notifications"
          data-testid="notification-popover"
          className="fixed top-14 right-4 left-4 z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-auto sm:right-0 sm:mt-2 sm:w-96 dark:border-slate-800 dark:bg-[#111827]"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setUnreadOnly(false)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  !unreadOnly
                    ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                }`}
              >
                Toutes
              </button>
              <button
                type="button"
                onClick={() => setUnreadOnly(true)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  unreadOnly
                    ? "bg-rose-50 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                }`}
              >
                Non lues ({unreadCount})
              </button>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={marking}
                onClick={() => void markAllRead()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Tout lire
              </button>
            )}
          </div>

          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800/80">
            {items.filter((n) => !unreadOnly || !n.read).length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Sparkles className="mx-auto h-6 w-6 text-slate-300 dark:text-slate-600" />
                <p className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  {unreadOnly
                    ? "Tout est à jour !"
                    : "Aucune notification pour le moment"}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Vos prochains comptes rendus Krisp enregistrés dans le Drive
                  apparaîtront ici.
                </p>
              </div>
            ) : (
              items
                .filter((n) => !unreadOnly || !n.read)
                .map((n) => (
                <div
                  key={n.id}
                  onClick={() => {
                    if (n.actionUrl) void handleOpenNotification(n);
                    else void markOneRead(n.id);
                  }}
                  className={`cursor-pointer px-4 py-3 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                    n.read
                      ? "bg-white dark:bg-[#111827]"
                      : "bg-indigo-50/40 dark:bg-indigo-500/10"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                        n.type === "KRISP_CR"
                          ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300"
                          : "bg-rose-50 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300"
                      }`}
                    >
                      {n.type === "KRISP_CR" ? (
                        <Mic className="h-3.5 w-3.5" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {n.projectLabel && (
                            <span className="mb-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {n.projectLabel}
                            </span>
                          )}
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {n.title}
                          </p>
                        </div>
                        {!n.read && (
                          <button
                            type="button"
                            onClick={() => void markOneRead(n.id)}
                            title="Marquer comme lu"
                            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500 transition-transform hover:scale-125"
                          />
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                        {n.message}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[10px] text-slate-400">
                          {formatRelativeTime(n.createdAt)}
                        </span>
                        <div className="flex items-center gap-2">
                          {n.driveUrl && (
                            <a
                              href={n.driveUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => void markOneRead(n.id)}
                              className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                            >
                              Ouvrir Drive
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {n.actionUrl && (
                            <button
                              type="button"
                              onClick={() => void handleOpenNotification(n)}
                              className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                            >
                              Voir
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-center dark:border-slate-800 dark:bg-slate-800/40">
            <Link
              href="/meetings"
              onClick={() => setOpen(false)}
              className="text-[11px] font-semibold text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
            >
              Ouvrir tous les comptes rendus Krisp →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
