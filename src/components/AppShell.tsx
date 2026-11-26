"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckSquare,
  Eye,
  FileSpreadsheet,
  FolderGit2,
  GanttChartSquare,
  Home,
  LayoutGrid,
  LogIn,
  Menu,
  Mic,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Presentation,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sun,
  UserCircle2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarDisplay } from "@/components/AvatarDisplay";
import { CommandPalette } from "@/components/CommandPalette";
import { NotificationBell } from "@/components/NotificationBell";
import { ProjectShareModal } from "@/components/ProjectShareModal";
import { ProjectSwitcherCombobox } from "@/components/ProjectSwitcherCombobox";
import { ShellContext, type ShellStatus } from "@/components/ShellContext";
import { ToastContainer } from "@/components/ToastContainer";
import { showToast } from "@/lib/toast";

const NAV_PRIMARY = [
  { href: "/", label: "Cockpit Projet", icon: Home },
  { href: "/retroplanning", label: "Tâches & Planning", icon: GanttChartSquare },
  { href: "/budget", label: "Budget & Factures", icon: FileSpreadsheet },
  { href: "/drive", label: "Fichiers Drive", icon: FolderGit2 },
  { href: "/meetings", label: "Comptes rendus", icon: Mic },
  { href: "/calendar", label: "Agenda", icon: Calendar },
] as const;

const NAV_CLIENT = [
  { href: "/weeklys", label: "Weeklys Clients", icon: Presentation },
  { href: "/reporting", label: "Reporting Bilan", icon: BarChart3 },
] as const;

const PAGE_TITLES: Record<string, string> = {
  "/": "Cockpit Projet",
  "/my-tasks": "Mes Tâches",
  "/projects": "Vue d'ensemble (Tous les projets)",
  "/retroplanning": "Tâches & Planning",
  "/budget": "Budget & Factures",
  "/drive": "Fichiers Drive",
  "/meetings": "Comptes rendus Krisp",
  "/calendar": "Agenda & Rappels",
  "/weeklys": "Weeklys Clients",
  "/reporting": "Reporting Bilan",
  "/settings": "Paramètres",
  "/profile": "Mon profil & Modèles",
  "/team": "Équipe & Administration",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [status, setStatus] = useState<ShellStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let active = true;
    const syncPrefs = async () => {
      await Promise.resolve();
      if (!active) return;
      const isDark = document.documentElement.classList.contains("dark");
      setTheme(isDark ? "dark" : "light");
      setIsMac(/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent));
      try {
        if (localStorage.getItem("go-sidebar-collapsed") === "1") {
          setSidebarCollapsed(true);
        }
      } catch {
        // ignore storage errors
      }
    };
    void syncPrefs();
    return () => {
      active = false;
    };
  }, []);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("go-sidebar-collapsed", next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }

  function toggleTheme(next: "light" | "dark") {
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("go-theme", next);
    } catch {
      // ignore storage errors
    }
  }

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/shell/status", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as ShellStatus;
        setStatus(data);
      }
    } catch {
      // ignore transient errors
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch("/api/shell/status", { cache: "no-store" });
        if (res.ok && active) {
          const data = (await res.json()) as ShellStatus;
          setStatus(data);
        }
      } catch {
        // ignore transient errors
      } finally {
        if (active) setStatusLoading(false);
      }
    };
    void run();

    const handler = () => {
      void loadStatus();
    };
    window.addEventListener("go:shell-refresh", handler);

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        bc = new BroadcastChannel("project-hub-sync");
        channelRef.current = bc;
        bc.onmessage = (event) => {
          if (event.data?.type === "refresh") {
            void loadStatus();
            router.refresh();
          }
        };
      } catch {
        bc = null;
      }
    }

    return () => {
      active = false;
      window.removeEventListener("go:shell-refresh", handler);
      if (bc) {
        bc.close();
        channelRef.current = null;
      }
    };
  }, [loadStatus, router]);

  const handleProjectChange = useCallback(
    async (projectId: string) => {
      if (!projectId) return;
      setSwitching(true);
      try {
        const res = await fetch("/api/shell/active-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        if (res.ok) {
          const picked = status?.projects.find((p) => p.id === projectId);
          if (picked) {
            showToast(`Projet actif : ${picked.client} — ${picked.nomJeu}`);
          }
          await loadStatus();
          router.refresh();
          window.dispatchEvent(new CustomEvent("go:shell-refresh"));
          channelRef.current?.postMessage({ type: "refresh", projectId });
        }
      } finally {
        setSwitching(false);
      }
    },
    [status?.projects, loadStatus, router]
  );

  const shellContextValue = useMemo(
    () => ({
      status,
      loading: statusLoading,
      refreshShell: loadStatus,
      selectProject: handleProjectChange,
    }),
    [status, statusLoading, loadStatus, handleProjectChange]
  );

  const activeProject = status?.activeProject ?? null;
  const settingsActive = pathname === "/settings";
  const projectsActive = pathname === "/projects";
  const myTasksActive = pathname === "/my-tasks";
  const allConnected = Boolean(
    status?.googleConnected && status?.geminiConfigured
  );
  const currentPageTitle = PAGE_TITLES[pathname] ?? "Espace Projet";
  const showAuthGate =
    !statusLoading &&
    Boolean(status?.authRequired) &&
    !status?.currentUser &&
    pathname !== "/settings";

  if (showAuthGate) {
    return (
      <ShellContext.Provider value={shellContextValue}>
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#f8fafc] px-4 py-12 text-slate-900 dark:bg-[#0b0f17] dark:text-slate-100">
          <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-lg dark:border-slate-800 dark:bg-[#111827]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-base font-extrabold text-white shadow-sm">
              PH
            </div>
            <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Project Hub
            </h1>
            <p className="mt-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
              GamersOrigin &amp; L&apos;Intrus
            </p>
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Connectez-vous avec votre compte Google Workspace pour accéder à
              vos projets, budgets, factures et brouillons Gmail personnels.
            </p>
            <a
              href="/api/auth/google/start"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
            >
              <LogIn className="h-4 w-4" />
              Se connecter avec Google Workspace
            </a>
            <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
              Accès réservé aux adresses <span className="font-mono">@gamersorigin.com</span> et{" "}
              <span className="font-mono">@lintrus.fr</span>.
            </p>
          </div>
          <ToastContainer />
        </div>
      </ShellContext.Provider>
    );
  }

  return (
    <ShellContext.Provider value={shellContextValue}>
    <div className="flex min-h-screen bg-[#f8fafc] text-slate-900 dark:bg-[#0b0f17] dark:text-slate-100">
      {/* Mobile Sidebar Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Anchored Workspace Sidebar (Sticky full-height on desktop, collapsible rail) */}
      <aside
        data-testid="anchored-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200/80 bg-white transition-all duration-200 dark:border-slate-800/90 dark:bg-[#111827] lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:translate-x-0 ${
          sidebarCollapsed ? "w-64 lg:w-[68px]" : "w-64"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Brand + Collapse/Close */}
        <div
          className={`flex items-center px-3.5 pt-4 pb-3 ${
            sidebarCollapsed ? "justify-between lg:justify-center" : "justify-between"
          }`}
        >
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            title="Project Hub — GamersOrigin & L'Intrus"
            className="flex items-center gap-2.5"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-[11px] font-extrabold text-white shadow-2xs">
              PH
            </div>
            <span
              className={`text-sm font-bold tracking-tight text-slate-900 dark:text-white ${
                sidebarCollapsed ? "lg:hidden" : ""
              }`}
            >
              Project Hub
            </span>
          </Link>

          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            title={
              sidebarCollapsed
                ? "Déplier le menu gauche"
                : "Réduire le menu gauche"
            }
            aria-label={
              sidebarCollapsed
                ? "Déplier le menu gauche"
                : "Réduire le menu gauche"
            }
            className={`hidden rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 lg:inline-flex ${
              sidebarCollapsed ? "lg:hidden" : ""
            }`}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 lg:hidden"
            aria-label="Fermer le menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Expand button when collapsed on desktop */}
        {sidebarCollapsed && (
          <div className="hidden justify-center px-2 pb-2 lg:flex">
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              title="Déplier le menu gauche"
              aria-label="Déplier le menu gauche"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Global Level: My Tasks & All Projects Overview (ABOVE Project Switcher) */}
        <div className="space-y-0.5 px-2.5 pb-2">
          <Link
            href="/my-tasks"
            onClick={() => setMobileOpen(false)}
            title="Mes tâches sur tous mes projets"
            data-testid="nav-my-tasks"
            className={`flex items-center rounded-xl px-2.5 py-2 text-[13px] transition-colors ${
              sidebarCollapsed ? "justify-between lg:justify-center lg:px-0" : "justify-between"
            } ${
              myTasksActive
                ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                : "font-medium text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <CheckSquare
                className={`h-4 w-4 shrink-0 ${
                  myTasksActive
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              />
              <span className={sidebarCollapsed ? "lg:hidden" : ""}>
                Mes tâches
              </span>
            </span>
            {(status?.myTasksCount ?? 0) > 0 && (
              <span
                className={`rounded-full bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 ${
                  sidebarCollapsed ? "lg:hidden" : ""
                }`}
              >
                {status?.myTasksCount}
              </span>
            )}
          </Link>

          <Link
            href="/projects"
            onClick={() => setMobileOpen(false)}
            title="Vue d'ensemble (tous les projets)"
            data-testid="nav-portfolio-overview"
            className={`flex items-center rounded-xl px-2.5 py-2 text-[13px] transition-colors ${
              sidebarCollapsed ? "justify-between lg:justify-center lg:px-0" : "justify-between"
            } ${
              projectsActive
                ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                : "font-medium text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <LayoutGrid
                className={`h-4 w-4 shrink-0 ${
                  projectsActive
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              />
              <span className={sidebarCollapsed ? "lg:hidden" : ""}>
                Vue d&apos;ensemble
              </span>
            </span>
            <span
              className={`rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400 ${
                sidebarCollapsed ? "lg:hidden" : ""
              }`}
            >
              {status?.projects.length ?? 0}
            </span>
          </Link>
        </div>

        {/* Workspace Project Switcher (separates Global vs Active Project!) */}
        <div className={`px-3 pb-3 ${sidebarCollapsed ? "lg:hidden" : ""}`}>
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-800/50">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                Projet actif
              </span>
            </div>
            <ProjectSwitcherCombobox
              projects={status?.projects ?? []}
              activeProjectId={status?.activeProjectId ?? null}
              disabled={switching}
              onSelect={handleProjectChange}
            />
          </div>
        </div>

        {/* Clean 2-Group Navigation */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-1">
          <div className="space-y-0.5">
            {NAV_PRIMARY.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
              const showDriftDot =
                item.href === "/drive" && (status?.extDriftCount ?? 0) > 0;
              const showInvoiceBadge =
                item.href === "/budget" &&
                (status?.pendingInvoicesCount ?? 0) > 0;
              const showLateBadge =
                item.href === "/retroplanning" &&
                (status?.lateTasksCount ?? 0) > 0;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  onClick={() => setMobileOpen(false)}
                  className={`group relative flex items-center rounded-xl px-2.5 py-2 text-[13px] transition-colors ${
                    sidebarCollapsed ? "justify-between lg:justify-center lg:px-0" : "justify-between"
                  } ${
                    active
                      ? "bg-slate-100/90 font-semibold text-slate-900 dark:bg-slate-800/90 dark:text-white"
                      : "font-medium text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        active
                          ? "text-indigo-600 dark:text-indigo-400"
                          : "text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200"
                      }`}
                    />
                    <span className={sidebarCollapsed ? "lg:hidden" : ""}>
                      {item.label}
                    </span>
                  </span>
                  {showDriftDot && (
                    <span
                      title={`${status?.extDriftCount} dossier(s) modifié(s) à republier dans l'espace client`}
                      className={`rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 ${
                        sidebarCollapsed ? "lg:hidden" : ""
                      }`}
                    >
                      {status?.extDriftCount}
                    </span>
                  )}
                  {showInvoiceBadge && (
                    <span
                      title={`${status?.pendingInvoicesCount} facture(s) en attente de validation`}
                      className={`rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 ${
                        sidebarCollapsed ? "lg:hidden" : ""
                      }`}
                    >
                      {status?.pendingInvoicesCount}
                    </span>
                  )}
                  {showLateBadge && (
                    <span
                      title={`${status?.lateTasksCount} tâche(s) en retard`}
                      className={`rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300 ${
                        sidebarCollapsed ? "lg:hidden" : ""
                      }`}
                    >
                      {status?.lateTasksCount}
                    </span>
                  )}
                  {sidebarCollapsed &&
                    (showDriftDot || showInvoiceBadge || showLateBadge) && (
                      <span
                        className={`hidden h-1.5 w-1.5 rounded-full lg:absolute lg:top-1.5 lg:right-2 lg:block ${
                          showLateBadge
                            ? "bg-rose-500"
                            : showInvoiceBadge
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                        }`}
                      />
                    )}
                </Link>
              );
            })}
          </div>

          <div>
            <p
              className={`mb-1 px-2.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase dark:text-slate-500 ${
                sidebarCollapsed ? "lg:hidden" : ""
              }`}
            >
              Livrables Client
            </p>
            <div className="space-y-0.5">
              {NAV_CLIENT.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    onClick={() => setMobileOpen(false)}
                    className={`group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors ${
                      sidebarCollapsed ? "lg:justify-center lg:px-0" : ""
                    } ${
                      active
                        ? "bg-rose-50 font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                        : "font-medium text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        active
                          ? "text-indigo-600 dark:text-indigo-400"
                          : "text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200"
                      }`}
                    />
                    <span className={sidebarCollapsed ? "lg:hidden" : ""}>
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Quiet Footer */}
        <div className="space-y-1 border-t border-slate-100 p-2.5 dark:border-slate-800">
          <Link
            href="/team"
            title="Annuaire équipe, rôles admin & backups hebdomadaires"
            onClick={() => setMobileOpen(false)}
            className={`flex items-center rounded-xl px-2.5 py-2 text-[13px] transition-colors ${
              sidebarCollapsed
                ? "justify-between lg:justify-center lg:px-0"
                : "justify-between"
            } ${
              pathname === "/team"
                ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                : "font-medium text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Users
                className={`h-4 w-4 shrink-0 ${
                  pathname === "/team"
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              />
              <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : ""}`}>
                Équipe &amp; Admin
              </span>
            </span>
          </Link>

          <Link
            href="/profile"
            title="Mon profil, avatar & modèles vierges"
            onClick={() => setMobileOpen(false)}
            className={`flex items-center rounded-xl px-2.5 py-2 text-[13px] transition-colors ${
              sidebarCollapsed
                ? "justify-between lg:justify-center lg:px-0"
                : "justify-between"
            } ${
              pathname === "/profile"
                ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                : "font-medium text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              {status?.currentUser ? (
                <AvatarDisplay
                  avatarId={status.currentUser.avatarId}
                  avatarBg={status.currentUser.avatarBg}
                  size="xs"
                />
              ) : (
                <UserCircle2 className="h-4 w-4 shrink-0 text-slate-400" />
              )}
              <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : ""}`}>
                {status?.currentUser ? status.currentUser.name : "Profil & Avatar"}
              </span>
            </span>
          </Link>

          <Link
            href="/settings"
            title="Paramètres"
            onClick={() => setMobileOpen(false)}
            className={`relative flex items-center rounded-xl px-2.5 py-2 text-[13px] transition-colors ${
              sidebarCollapsed ? "justify-between lg:justify-center lg:px-0" : "justify-between"
            } ${
              settingsActive
                ? "bg-slate-100 font-semibold text-slate-900 dark:bg-slate-800 dark:text-white"
                : "font-medium text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Settings className="h-4 w-4 shrink-0 text-slate-400" />
              <span className={sidebarCollapsed ? "lg:hidden" : ""}>
                Paramètres
              </span>
            </span>
            <span
              data-testid="google-status-pill"
              title={
                allConnected
                  ? `Connecté (${status?.googleEmail ?? "Google + IA"})`
                  : "Configuration à terminer"
              }
              className={`h-2 w-2 rounded-full ${
                allConnected ? "bg-emerald-500" : "bg-rose-500"
              } ${sidebarCollapsed ? "lg:absolute lg:top-1.5 lg:right-2" : ""}`}
            />
          </Link>

          <div
            data-testid="sandbox-mode-badge"
            title="Vos dossiers de production existants sont strictement protégés."
            className={`mt-1 flex items-center gap-2 px-2.5 pt-1 text-[11px] text-slate-400 dark:text-slate-500 ${
              sidebarCollapsed ? "lg:justify-center lg:px-0" : ""
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
            <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : ""}`}>
              {activeProject?.isSandbox ? "Mode pilote · PROD protégé" : "PROD protégé"}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Whisper-Quiet Slim Topbar (Linear style) */}
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 px-4 py-2.5 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#0b0f17]/85 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            {/* Left: Mobile button + Quiet Breadcrumb */}
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 lg:hidden"
                aria-label="Ouvrir le menu"
              >
                <Menu className="h-4 w-4" />
              </button>

              {activeProject &&
                pathname !== "/projects" &&
                pathname !== "/my-tasks" &&
                pathname !== "/settings" &&
                pathname !== "/team" &&
                pathname !== "/profile" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setMobileOpen(true)}
                      className="inline-flex max-w-[130px] items-center gap-1 truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200 sm:hidden"
                      title={`Projet actif : ${activeProject.client} · ${activeProject.nomJeu}`}
                    >
                      <span className="truncate">{activeProject.client}</span>
                    </button>
                    <Link
                      href="/"
                      className="hidden max-w-[260px] truncate font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white sm:inline"
                    >
                      {activeProject.client} · {activeProject.nomJeu}
                    </Link>
                    <span className="hidden text-slate-300 dark:text-slate-700 sm:inline">
                      /
                    </span>
                  </>
                )}
              <span className="truncate font-semibold text-slate-800 dark:text-slate-100">
                {currentPageTitle}
              </span>
            </div>

            {/* Right: Minimal Search + Share + Theme Toggle + Avatar Profile */}
            <div className="flex items-center gap-2">
              {activeProject &&
                status?.activeProjectAccess?.accessRole === "VIEWER" && (
                  <span
                    title="Vous disposez d'un accès en lecture seule sur ce projet"
                    className="hidden items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 sm:inline-flex"
                  >
                    <Eye className="h-3 w-3" />
                    Vue seule
                  </span>
                )}

              {activeProject &&
                pathname !== "/projects" &&
                pathname !== "/settings" &&
                pathname !== "/team" &&
                pathname !== "/profile" &&
                status?.activeProjectAccess?.canManageMembers !== false && (
                  <button
                    type="button"
                    onClick={() => setShareOpen(true)}
                    title="Partager ce projet (vue ou gestion)"
                    data-testid="topbar-share-project-btn"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Partager</span>
                  </button>
                )}

              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                data-testid="quick-search-btn"
                title="Recherche rapide (Ctrl+K)"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/70 px-2.5 py-1 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Rechercher…</span>
                <kbd className="hidden rounded bg-white px-1 py-0.5 font-mono text-[10px] text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700 md:inline">
                  {isMac ? "⌘K" : "Ctrl K"}
                </kbd>
              </button>

              <NotificationBell />

              <button
                type="button"
                data-testid="theme-switcher"
                onClick={() => toggleTheme(theme === "dark" ? "light" : "dark")}
                aria-label={
                  theme === "dark"
                    ? "Passer en mode clair"
                    : "Passer en mode sombre"
                }
                title={
                  theme === "dark"
                    ? "Passer en mode clair"
                    : "Passer en mode sombre"
                }
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white dark:focus:bg-slate-800"
              >
                {theme === "dark" ? (
                  <Sun className="h-3.5 w-3.5" />
                ) : (
                  <Moon className="h-3.5 w-3.5" />
                )}
              </button>

              {!allConnected && (
                <Link
                  href="/settings"
                  data-testid="gemini-status-pill"
                  className="rounded-lg bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300"
                >
                  Configurer
                </Link>
              )}

              <Link
                href="/profile"
                data-testid="topbar-profile-link"
                title={
                  status?.currentUser
                    ? `${status.currentUser.name} (${status.currentUser.email})`
                    : "Se connecter & personnaliser mon avatar"
                }
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white py-0.5 pr-2.5 pl-0.5 text-xs font-medium text-slate-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                {status?.currentUser ? (
                  <>
                    <AvatarDisplay
                      avatarId={status.currentUser.avatarId}
                      avatarBg={status.currentUser.avatarBg}
                      size="xs"
                    />
                    <span className="hidden max-w-[100px] truncate md:inline">
                      {status.currentUser.name}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800">
                      <UserCircle2 className="h-4 w-4" />
                    </span>
                    <span className="hidden md:inline">Connexion</span>
                  </>
                )}
              </Link>
            </div>
          </div>
        </header>

        {/* Global CP Conflict Alert (only if real conflict) */}
        {status && status.cpConflictCount > 0 && activeProject && (
          <div
            role="alert"
            data-testid="global-cp-conflict-banner"
            className="border-b border-rose-200 bg-rose-50 px-6 py-2 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-950/60 dark:text-rose-200"
          >
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                <span>
                  <strong>{status.cpConflictCount} facture(s) bloquée(s)</strong>{" "}
                  (autre numéro de projet que CP {activeProject.codeProjet}).
                </span>
              </div>
              <Link
                href="/budget?tab=invoices"
                className="font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-900 dark:text-rose-300"
              >
                Vérifier
              </Link>
            </div>
          </div>
        )}

        {/* Generous, Breathing Page Container */}
        <main className="flex-1 px-4 py-7 sm:px-6 lg:px-10">{children}</main>

        {/* Discreet Version & Build Timestamp Footer */}
        <footer
          data-testid="app-version-footer"
          className="border-t border-slate-200/50 px-4 py-2.5 sm:px-6 lg:px-10 dark:border-slate-800/60"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
            <span>
              Project Hub · {process.env.NEXT_PUBLIC_APP_ENV ?? "Local"} · v
              {process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0"} (
              <span className="font-mono">
                {process.env.NEXT_PUBLIC_APP_COMMIT ?? "dev"}
              </span>
              )
            </span>
            <span>
              Build du{" "}
              {process.env.NEXT_PUBLIC_BUILD_DATETIME ?? "—"} (heure de Paris)
            </span>
          </div>
        </footer>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        projects={status?.projects ?? []}
        activeProjectId={status?.activeProjectId ?? null}
        onSelectProject={handleProjectChange}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      {activeProject && (
        <ProjectShareModal
          projectId={activeProject.id}
          projectLabel={`${activeProject.client} — ${activeProject.nomJeu} (Code projet ${activeProject.codeProjet})`}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          onChanged={() => window.dispatchEvent(new CustomEvent("go:shell-refresh"))}
        />
      )}
      <ToastContainer />
    </div>
    </ShellContext.Provider>
  );
}
