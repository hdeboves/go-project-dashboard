"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  FileSpreadsheet,
  FolderGit2,
  FolderKanban,
  GanttChartSquare,
  LayoutDashboard,
  Menu,
  Presentation,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface ShellProject {
  id: string;
  codeProjet: string;
  client: string;
  nomJeu: string;
  isSandbox: boolean;
}

interface ShellStatus {
  projects: ShellProject[];
  activeProjectId: string | null;
  activeProject: ShellProject | null;
  googleConnected: boolean;
  googleEmail: string | null;
  geminiConfigured: boolean;
  sandboxMode: boolean;
  cpConflictCount: number;
  extDriftCount: number;
}

const NAV_ITEMS = [
  { href: "/", label: "Centre de Commande", icon: LayoutDashboard, badge: null },
  { href: "/projects", label: "Projets & Pilote", icon: FolderKanban, badge: null },
  { href: "/drive", label: "Drive 001→006 & [EXT]", icon: FolderGit2, badge: null },
  { href: "/budget", label: "Budget & Factures", icon: FileSpreadsheet, badge: "Jalon 1 · M2" },
  { href: "/retroplanning", label: "Rétroplanning Gantt", icon: GanttChartSquare, badge: "Jalon 2 · M3" },
  { href: "/calendar", label: "Agenda & Cascades", icon: Calendar, badge: "Jalon 2 · M3" },
  { href: "/weeklys", label: "Weeklys Clients", icon: Presentation, badge: "Jalon 2 · M3" },
  { href: "/reporting", label: "Reporting Fin de Jeu", icon: BarChart3, badge: "Jalon 3 · M4" },
  { href: "/settings", label: "Paramètres & OAuth2", icon: Settings, badge: null },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [status, setStatus] = useState<ShellStatus | null>(null);
  const [switching, setSwitching] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/shell/status", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as ShellStatus;
        setStatus(data);
      }
    } catch {
      // ignore transient poll errors
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
        // ignore transient poll errors
      }
    };
    void run();
    const handler = () => {
      void loadStatus();
    };
    window.addEventListener("go:shell-refresh", handler);
    return () => {
      active = false;
      window.removeEventListener("go:shell-refresh", handler);
    };
  }, [loadStatus]);

  async function handleProjectChange(projectId: string) {
    if (!projectId) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/shell/active-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (res.ok) {
        await loadStatus();
        router.refresh();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      }
    } finally {
      setSwitching(false);
    }
  }

  const activeProject = status?.activeProject ?? null;

  return (
    <div className="flex min-h-screen bg-[#090b10] text-slate-100">
      {/* Mobile Sidebar Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-[#232b3d] bg-[#11151f] transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="relative flex items-center justify-between border-b border-[#232b3d] px-5 py-4">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#e11d48] via-[#ff2e58] to-cyan-500" />
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#e11d48] font-mono text-xs font-bold text-white shadow-sm shadow-rose-600/40">
                GO
              </span>
              <span className="text-sm font-bold tracking-wide text-white">
                GO PROJECT HUB
              </span>
            </div>
            <p className="mt-1 text-[11px] font-medium tracking-wider text-slate-400 uppercase">
              GamersOrigin Agency OS
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded p-1 text-slate-400 hover:bg-[#171d2b] hover:text-white lg:hidden"
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-[#e11d48]/15 text-rose-300 ring-1 ring-[#e11d48]/40"
                    : "text-slate-300 hover:bg-[#171d2b] hover:text-white"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    className={`h-4 w-4 ${active ? "text-[#ff2e58]" : "text-slate-400"}`}
                  />
                  <span>{item.label}</span>
                </span>
                {item.badge && (
                  <span className="rounded bg-[#171d2b] px-1.5 py-0.5 font-mono text-[10px] text-slate-400 ring-1 ring-[#232b3d]">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#232b3d] p-4 text-xs text-slate-400">
          <div className="flex items-center gap-2 text-amber-300">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span className="font-semibold">Verrou PROD Actif</span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-slate-500">
            16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD (Lecture/Copie seule)
          </p>
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky Top Bar */}
        <header className="sticky top-0 z-30 border-b border-[#232b3d] bg-[#11151f]/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-md border border-[#232b3d] bg-[#171d2b] p-2 text-slate-300 hover:text-white lg:hidden"
                aria-label="Ouvrir le menu"
              >
                <Menu className="h-4 w-4" />
              </button>

              {/* Active Project Switcher */}
              <div className="flex items-center gap-2">
                <label
                  htmlFor="active-project-select"
                  className="hidden text-xs font-semibold tracking-wider text-slate-400 uppercase sm:inline"
                >
                  Projet Actif
                </label>
                <select
                  id="active-project-select"
                  data-testid="active-project-switcher"
                  value={status?.activeProjectId ?? ""}
                  disabled={switching || !status?.projects.length}
                  onChange={(e) => void handleProjectChange(e.target.value)}
                  className="rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                >
                  {!status?.projects.length ? (
                    <option value="">Aucun projet (Bootstrap requis)</option>
                  ) : (
                    status.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.codeProjet} | {p.client} | {p.nomJeu}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Persistent Sandbox Badge */}
              <span
                title="PROD 16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD verrouillé en lecture/copie seule"
                data-testid="sandbox-mode-badge"
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-amber-300"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                {activeProject?.isSandbox
                  ? `[PILOTE - ${activeProject.codeProjet}] BAC À SABLE`
                  : "SANDBOX ACTIF"}
              </span>
            </div>

            {/* Google & Gemini Status Pills */}
            <div className="flex items-center gap-2">
              <Link
                href="/settings"
                data-testid="google-status-pill"
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  status?.googleConnected
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    status?.googleConnected ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
                {status?.googleConnected
                  ? `Google : ${status.googleEmail ?? "Connecté"}`
                  : "Google : Non connecté"}
              </Link>

              <Link
                href="/settings"
                data-testid="gemini-status-pill"
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  status?.geminiConfigured
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {status?.geminiConfigured
                  ? "Gemini : Prêt"
                  : "Gemini : Clé manquante"}
              </Link>
            </div>
          </div>
        </header>

        {/* Global CP-Conflict Red Alert Banner */}
        {status && status.cpConflictCount > 0 && activeProject && (
          <div
            role="alert"
            data-testid="global-cp-conflict-banner"
            className="flex flex-wrap items-center justify-between gap-3 border-b border-red-500/60 bg-red-950/85 px-6 py-3 text-sm text-red-100"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
              <span className="font-semibold">
                ALERTE ZÉRO MÉLANGE — {status.cpConflictCount} conflit(s) de
                Code Projet détecté(s) sur{" "}
                <span className="font-mono">CP {activeProject.codeProjet}</span>.
                Toute injection automatique est bloquée.
              </span>
            </div>
            <Link
              href="/projects"
              className="rounded-md border border-red-400/50 bg-red-900/60 px-3 py-1 text-xs font-semibold text-white hover:bg-red-800"
            >
              Inspecter l&apos;isolation
            </Link>
          </div>
        )}

        {/* Main Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
