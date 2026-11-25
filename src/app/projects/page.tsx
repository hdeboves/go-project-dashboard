"use client";

import {
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Calendar,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FolderKanban,
  GanttChartSquare,
  LayoutGrid,
  Mic,
  Plus,
  Rocket,
  Search,
  ShieldCheck,
  Table2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { showToast } from "@/lib/toast";

interface PortfolioProjectItem {
  id: string;
  codeProjet: string;
  client: string;
  nomJeu: string;
  isSandbox: boolean;
  driveInternalRootId: string | null;
  driveExternalRootId: string | null;
  budgetSheetId: string | null;
  retroplanningSheetId: string | null;
  talentsJson: string;
  driftCount: number;
  cpConflictCount: number;
  pendingInvoicesCount: number;
  health: "SAIN" | "VIGILANCE" | "CRITIQUE";
  healthReasons?: string[];
  budget: {
    totalSoldHt: number;
    totalPreOpHt: number;
    totalActualHt: number;
    consumedPct: number;
    marginHt: number;
    marginPct: number;
    forecastCostHt?: number;
    forecastMarginHt?: number;
    forecastMarginPct?: number;
    budgetAlertCount: number;
  };
  tasks: {
    total: number;
    done: number;
    late: number;
    progressPct: number;
    nextMilestone: {
      title: string;
      date: string;
      isMilestone: boolean;
    } | null;
  };
  lastMeeting: {
    id: string;
    title: string;
    meetingDate: string;
  } | null;
  _count: {
    driveNodes: number;
    invoices: number;
    retroTasks: number;
    meetingNotes: number;
  };
}

interface PortfolioSummary {
  totalProjects: number;
  healthyCount: number;
  watchCount: number;
  criticalCount: number;
  totalSoldHt: number;
  totalActualHt: number;
  globalMarginPct: number;
  globalForecastMarginPct?: number;
  avgProgressPct: number;
  totalPendingInvoices: number;
  totalLateTasks: number;
  totalMeetings: number;
}

function formatEur(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  const formatted = rounded
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
  return `${formatted}\u00A0€`;
}

function healthStyle(health: "SAIN" | "VIGILANCE" | "CRITIQUE") {
  if (health === "CRITIQUE") {
    return {
      label: "Critique",
      pill: "bg-rose-50 text-rose-700 ring-1 ring-rose-200/80 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
      dot: "bg-rose-500",
    };
  }
  if (health === "VIGILANCE") {
    return {
      label: "Vigilance",
      pill: "bg-amber-50 text-amber-800 ring-1 ring-amber-200/80 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
      dot: "bg-amber-500",
    };
  }
  return {
    label: "Sain",
    pill: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
    dot: "bg-emerald-500",
  };
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<PortfolioProjectItem[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [sortBy, setSortBy] = useState<
    "health" | "client" | "progress" | "margin" | "sold"
  >("health");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [healthFilter, setHealthFilter] = useState<
    "ALL" | "SAIN" | "VIGILANCE" | "CRITIQUE"
  >("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [codeProjet, setCodeProjet] = useState("");
  const [client, setClient] = useState("");
  const [nomJeu, setNomJeu] = useState("");
  const [provisionDrive, setProvisionDrive] = useState(true);

  const [talentToolOpen, setTalentToolOpen] = useState(false);
  const [talentProjectId, setTalentProjectId] = useState("");
  const [talentName, setTalentName] = useState("");
  const [addingTalent, setAddingTalent] = useState(false);

  const [securityToolOpen, setSecurityToolOpen] = useState(false);
  const [isoProjectId, setIsoProjectId] = useState("");
  const [isoInput, setIsoInput] = useState("Facture QF08_326018.pdf");
  const [isoResult, setIsoResult] = useState<{
    type: "ok" | "conflict";
    text: string;
  } | null>(null);

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, shellRes] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/shell/status", { cache: "no-store" }),
      ]);
      if (shellRes.ok) {
        const shellJson = (await shellRes.json()) as {
          activeProjectId?: string | null;
        };
        setActiveProjectId(shellJson.activeProjectId ?? null);
      }
      if (projRes.ok) {
        const json = (await projRes.json()) as {
          projects: PortfolioProjectItem[];
          portfolioSummary?: PortfolioSummary;
        };
        setProjects(json.projects);
        setSummary(json.portfolioSummary ?? null);
        if (json.projects.length > 0) {
          setTalentProjectId((prev) => prev || json.projects[0].id);
          setIsoProjectId((prev) => prev || json.projects[0].id);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) await loadProjects();
    };
    void init();
    return () => {
      active = false;
    };
  }, [loadProjects]);

  async function handleOpenProject(projectId: string, destination = "/") {
    setOpeningId(projectId);
    try {
      await fetch("/api/shell/active-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      setActiveProjectId(projectId);
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      router.push(destination);
    } finally {
      setOpeningId(null);
    }
  }

  async function handleBootstrapSandbox() {
    setBootstrapping(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/projects/bootstrap-sandbox", {
        method: "POST",
      });
      const json = (await res.json()) as {
        error?: string;
        internalNodesCount?: number;
        externalNodesCount?: number;
      };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text:
            json.error ??
            "Impossible d'initialiser le projet pilote. Vérifiez Google dans Paramètres.",
        });
      } else {
        const msg = `Projet pilote Caisse d'Épargne prêt (${json.internalNodesCount ?? 0} dossiers internes + ${json.externalNodesCount ?? 0} dossiers client).`;
        setFeedback({ type: "success", text: msg });
        showToast(msg);
        await loadProjects();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      }
    } finally {
      setBootstrapping(false);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codeProjet,
          client,
          nomJeu,
          isSandbox: true,
          provisionDrive,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible de créer le projet.",
        });
      } else {
        const msg = `Projet « ${client} — ${nomJeu} » créé.`;
        setFeedback({ type: "success", text: msg });
        showToast(msg);
        setCodeProjet("");
        setClient("");
        setNomJeu("");
        setCreateOpen(false);
        await loadProjects();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleAddTalent(e: React.FormEvent) {
    e.preventDefault();
    if (!talentProjectId || !talentName.trim()) return;
    setAddingTalent(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/projects/${talentProjectId}/talents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ talentName }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible d'ajouter ce talent.",
        });
      } else {
        const msg = `Dossiers créés pour « ${talentName} » dans Drive.`;
        setFeedback({ type: "success", text: msg });
        showToast(msg);
        setTalentName("");
        await loadProjects();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      }
    } finally {
      setAddingTalent(false);
    }
  }

  async function handleIsolationCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!isoProjectId) return;
    setIsoResult(null);
    const res = await fetch(`/api/projects/${isoProjectId}/isolation/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText: isoInput,
        sourceLabel: "ui-isolation-tester",
      }),
    });
    const json = (await res.json()) as {
      error?: string;
      result?: { detectedCps?: string[] };
    };
    if (res.status === 409) {
      setIsoResult({
        type: "conflict",
        text: json.error ?? "Ce document appartient à un autre projet.",
      });
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } else if (res.ok) {
      setIsoResult({
        type: "ok",
        text: `Aucun mélange détecté (codes trouvés : ${(json.result?.detectedCps ?? []).join(", ") || "aucun"}).`,
      });
    } else {
      setIsoResult({
        type: "conflict",
        text: json.error ?? "Erreur lors de la vérification.",
      });
    }
  }

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const healthRank = { CRITIQUE: 0, VIGILANCE: 1, SAIN: 2 };
    const matched = projects.filter((p) => {
      if (healthFilter !== "ALL" && p.health !== healthFilter) return false;
      if (
        q &&
        !p.client.toLowerCase().includes(q) &&
        !p.nomJeu.toLowerCase().includes(q) &&
        !p.codeProjet.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });

    const mult = sortDir === "asc" ? 1 : -1;
    return [...matched].sort((a, b) => {
      if (sortBy === "health") {
        return (healthRank[a.health] - healthRank[b.health]) * mult;
      }
      if (sortBy === "client") {
        return a.client.localeCompare(b.client, "fr") * mult;
      }
      if (sortBy === "progress") {
        return (a.tasks.progressPct - b.tasks.progressPct) * mult;
      }
      if (sortBy === "margin") {
        const ma = a.budget.forecastMarginPct ?? a.budget.marginPct;
        const mb = b.budget.forecastMarginPct ?? b.budget.marginPct;
        return (ma - mb) * mult;
      }
      return (a.budget.totalSoldHt - b.budget.totalSoldHt) * mult;
    });
  }, [projects, healthFilter, searchQuery, sortBy, sortDir]);

  function toggleSort(col: "health" | "client" | "progress" | "margin" | "sold") {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir(col === "health" || col === "client" ? "asc" : "desc");
    }
  }

  function handleExportCsv() {
    const headers = [
      "CP",
      "Client",
      "Jeu",
      "Santé",
      "Avancement %",
      "Tâches en retard",
      "Vendu HT (€)",
      "Prévu HT (€)",
      "Facturé HT (€)",
      "Consommé %",
      "Marge Atterrissage %",
      "Factures à valider",
      "CR Krisp",
    ];
    const rows = filteredProjects.map((p) => [
      p.codeProjet,
      p.client,
      p.nomJeu,
      p.health,
      p.tasks.progressPct,
      p.tasks.late,
      Math.round(p.budget.totalSoldHt),
      Math.round(p.budget.totalPreOpHt),
      Math.round(p.budget.totalActualHt),
      p.budget.consumedPct,
      p.budget.forecastMarginPct ?? p.budget.marginPct,
      p.pendingInvoicesCount,
      p._count.meetingNotes,
    ]);
    const csv =
      "\uFEFF" +
      [headers, ...rows]
        .map((r) =>
          r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")
        )
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portefeuille_gamersorigin_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Synthèse portefeuille exportée en CSV.");
  }

  const hasPilotProject = projects.some((p) => p.codeProjet === "326027");
  const totalAlerts =
    (summary?.totalPendingInvoices ?? 0) + (summary?.totalLateTasks ?? 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Calm Executive Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Vue d&apos;ensemble · Tous les projets
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Pilotez la santé, l&apos;avancement et la rentabilité de tout le
            portefeuille agence d&apos;un seul coup d&apos;œil.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={filteredProjects.length === 0}
            onClick={handleExportCsv}
            data-testid="export-portfolio-csv-btn"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            <Download className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            Export CSV
          </button>

          {!hasPilotProject && (
            <button
              type="button"
              disabled={bootstrapping}
              onClick={() => void handleBootstrapSandbox()}
              data-testid="bootstrap-sandbox-btn"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
            >
              <Rocket className="h-3.5 w-3.5 text-slate-500" />
              {bootstrapping ? "Initialisation..." : "Pilote Caisse d'Épargne"}
            </button>
          )}

          <button
            type="button"
            onClick={() => setCreateOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-700"
          >
            {createOpen ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {createOpen ? "Fermer" : "Nouveau projet"}
          </button>
        </div>
      </div>

      {/* 1 Unified Portfolio Health Strip */}
      <section
        data-testid="portfolio-summary-strip"
        className="grid divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#111827]"
      >
        <div className="px-5 py-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Projets suivis
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {summary?.totalProjects ?? projects.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {summary?.healthyCount ?? 0} sain(s)
            </span>
            {(summary?.watchCount ?? 0) > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  {summary?.watchCount} vigilance
                </span>
              </>
            )}
            {(summary?.criticalCount ?? 0) > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-rose-600 dark:text-rose-400">
                  {summary?.criticalCount} critique
                </span>
              </>
            )}
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Avancement moyen
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {summary?.avgProgressPct ?? 0}%
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${Math.min(100, summary?.avgProgressPct ?? 0)}%` }}
            />
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            CA Vendu · Marge atterrissage
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {formatEur(summary?.totalSoldHt ?? 0)}
            </span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              {summary?.globalForecastMarginPct ?? summary?.globalMarginPct ?? 0}%
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Engagé réel : {formatEur(summary?.totalActualHt ?? 0)}
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Points d&apos;attention & CR
          </p>
          <p
            className={`mt-1 font-mono text-2xl font-bold tracking-tight ${
              totalAlerts > 0
                ? "text-rose-600 dark:text-rose-400"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {totalAlerts}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {summary?.totalPendingInvoices ?? 0} facture(s) ·{" "}
            {summary?.totalLateTasks ?? 0} retard(s) ·{" "}
            {summary?.totalMeetings ?? 0} CR Krisp
          </p>
        </div>
      </section>

      {feedback && (
        <div
          role="status"
          data-testid="projects-feedback"
          className={`rounded-2xl border px-4 py-3 text-xs ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* New Project Drawer */}
      {createOpen && (
        <form
          onSubmit={handleCreateProject}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#111827]"
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Créer un nouveau projet
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Les 61 dossiers Google Drive internes et l&apos;espace client sont
            provisionnés automatiquement.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Code Projet (CP)
              </label>
              <input
                type="text"
                required
                placeholder="ex : 326099"
                value={codeProjet}
                onChange={(e) => setCodeProjet(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white dark:focus:bg-slate-900"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Client
              </label>
              <input
                type="text"
                required
                placeholder="ex : Caisse d'Épargne"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white dark:focus:bg-slate-900"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Opération / Jeu
              </label>
              <input
                type="text"
                required
                placeholder="ex : Activation Fortnite"
                value={nomJeu}
                onChange={(e) => setNomJeu(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white dark:focus:bg-slate-900"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4 dark:border-slate-800/80">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={provisionDrive}
                onChange={(e) => setProvisionDrive(e.target.checked)}
                className="h-4 w-4 accent-rose-600"
              />
              Créer automatiquement l&apos;arborescence Google Drive
            </label>

            <button
              type="submit"
              disabled={creating}
              data-testid="create-project-btn"
              className="rounded-xl bg-rose-600 px-5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {creating ? "Création..." : "Créer le projet"}
            </button>
          </div>
        </form>
      )}

      {/* Portfolio Filter + View Toggle */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-1">
            {(
              [
                { id: "ALL", label: `Tous (${projects.length})`, dot: null, activeClass: "text-slate-900 dark:text-white", barClass: "bg-slate-800 dark:bg-white" },
                { id: "SAIN", label: `Sains (${summary?.healthyCount ?? 0})`, dot: "bg-emerald-500", activeClass: "text-emerald-700 dark:text-emerald-300", barClass: "bg-emerald-500" },
                { id: "VIGILANCE", label: `Vigilance (${summary?.watchCount ?? 0})`, dot: "bg-amber-500", activeClass: "text-amber-700 dark:text-amber-300", barClass: "bg-amber-500" },
                { id: "CRITIQUE", label: `Critiques (${summary?.criticalCount ?? 0})`, dot: "bg-rose-500", activeClass: "text-rose-700 dark:text-rose-300", barClass: "bg-rose-500" },
              ] as const
            ).map((tab) => {
              const active = healthFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setHealthFilter(tab.id)}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? tab.activeClass
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  {tab.dot && (
                    <span className={`h-2 w-2 rounded-full ${tab.dot}`} />
                  )}
                  {tab.label}
                  {active && (
                    <span className={`absolute right-2 -bottom-3 left-2 h-0.5 rounded-full ${tab.barClass}`} />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-44 sm:w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Client, jeu ou CP..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white"
              />
            </div>

            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                title="Vue tableau (portefeuille)"
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium ${
                  viewMode === "table"
                    ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                }`}
              >
                <Table2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Tableau</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                title="Vue cartes"
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium ${
                  viewMode === "cards"
                    ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cartes</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
            Chargement du portefeuille projets...
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="p-12 text-center">
            <FolderKanban className="mx-auto h-9 w-9 text-slate-300" />
            <h3 className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
              Aucun projet correspondant
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Ajustez vos filtres ou créez un nouveau projet.
            </p>
          </div>
        ) : viewMode === "table" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-400">
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort("client")}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Projet
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort("health")}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Santé
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort("progress")}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Avancement
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort("margin")}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Budget & Marge
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-3 py-3">Suivi</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredProjects.map((p) => {
                  const isActive = p.id === activeProjectId;
                  const hs = healthStyle(p.health);
                  const displayMarginPct =
                    p.budget.forecastMarginPct ?? p.budget.marginPct;
                  return (
                    <tr
                      key={p.id}
                      data-testid={`project-card-${p.codeProjet}`}
                      className={`transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40 ${
                        isActive ? "bg-rose-50/25 dark:bg-rose-500/5" : ""
                      }`}
                    >
                      <td className="max-w-[210px] px-4 py-3">
                        <button
                          type="button"
                          onClick={() => void handleOpenProject(p.id, "/")}
                          className="group block w-full text-left"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {p.codeProjet}
                            </span>
                            {isActive && (
                              <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                                Actif
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-400">
                            {p.client} — {p.nomJeu}
                          </p>
                        </button>
                      </td>

                      <td className="px-3 py-3">
                        <span
                          title={
                            p.healthReasons && p.healthReasons.length > 0
                              ? p.healthReasons.join(" · ")
                              : "Aucune alerte détectée"
                          }
                          className={`inline-flex cursor-help items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${hs.pill}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${hs.dot}`} />
                          {hs.label}
                        </span>
                      </td>

                      <td className="max-w-[190px] px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${p.tasks.progressPct}%` }}
                            />
                          </div>
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                            {p.tasks.progressPct}%
                          </span>
                          <span className="text-[10px] text-slate-400">
                            ({p.tasks.done}/{p.tasks.total})
                          </span>
                        </div>
                        {p.tasks.nextMilestone ? (
                          <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            <Calendar className="h-3 w-3 shrink-0 text-slate-400" />
                            <span className="truncate">
                              {p.tasks.nextMilestone.title}
                            </span>
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-slate-400">
                            Aucun jalon
                          </p>
                        )}
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="font-mono font-semibold text-slate-900 dark:text-white">
                          {formatEur(p.budget.totalActualHt)}{" "}
                          <span className="font-normal text-slate-400">
                            / {formatEur(p.budget.totalSoldHt)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {p.budget.consumedPct}% · Marge{" "}
                          <span
                            className={`font-mono font-semibold ${
                              displayMarginPct >= 30
                                ? "text-emerald-600 dark:text-emerald-400"
                                : displayMarginPct >= 0
                                  ? "text-indigo-600 dark:text-indigo-400"
                                  : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {displayMarginPct}%
                          </span>
                        </p>
                      </td>

                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1 text-[11px]">
                          {p.pendingInvoicesCount > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleOpenProject(p.id, "/budget?tab=invoices")
                              }
                              className="whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300"
                            >
                              {p.pendingInvoicesCount} fact.
                            </button>
                          )}
                          {p.tasks.late > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleOpenProject(p.id, "/retroplanning")
                              }
                              className="whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300"
                            >
                              {p.tasks.late} retard{p.tasks.late > 1 ? "s" : ""}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              void handleOpenProject(p.id, "/meetings")
                            }
                            className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {p._count.meetingNotes} CR
                          </button>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Budget"
                            onClick={() => void handleOpenProject(p.id, "/budget")}
                            className="rounded-lg border border-slate-200 p-1 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Tâches"
                            onClick={() =>
                              void handleOpenProject(p.id, "/retroplanning")
                            }
                            className="rounded-lg border border-slate-200 p-1 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                          >
                            <GanttChartSquare className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="CR Krisp"
                            onClick={() =>
                              void handleOpenProject(p.id, "/meetings")
                            }
                            className="rounded-lg border border-slate-200 p-1 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                          >
                            <Mic className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={openingId === p.id}
                            onClick={() => void handleOpenProject(p.id, "/")}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                          >
                            {openingId === p.id ? "..." : "Ouvrir"}
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid gap-4 p-5 md:grid-cols-2">
            {filteredProjects.map((p) => {
              const isActive = p.id === activeProjectId;
              const hs = healthStyle(p.health);
              let talents: string[] = [];
              try {
                const parsed = JSON.parse(p.talentsJson || "[]");
                if (Array.isArray(parsed)) talents = parsed;
              } catch {
                talents = [];
              }

              return (
                <div
                  key={p.id}
                  data-testid={`project-card-${p.codeProjet}`}
                  className={`flex flex-col justify-between rounded-2xl border p-5 transition-all hover:shadow-sm ${
                    isActive
                      ? "border-rose-300 bg-rose-50/15 dark:border-rose-500/40 dark:bg-rose-500/5"
                      : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#111827]"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          CP {p.codeProjet}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${hs.pill}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${hs.dot}`} />
                          {hs.label}
                        </span>
                      </div>
                      {isActive && (
                        <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                          Projet actif
                        </span>
                      )}
                    </div>

                    <h3 className="mt-2.5 text-base font-bold text-slate-900 dark:text-white">
                      {p.client} — {p.nomJeu}
                    </h3>

                    {/* Compact Metrics Row */}
                    <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50/70 p-3 dark:bg-slate-800/40">
                      <div>
                        <p className="text-[10px] font-medium text-slate-500 uppercase">
                          Tâches ({p.tasks.done}/{p.tasks.total})
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${p.tasks.progressPct}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                            {p.tasks.progressPct}%
                          </span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium text-slate-500 uppercase">
                          Atterrissage · Marge{" "}
                          {p.budget.forecastMarginPct ?? p.budget.marginPct}%
                        </p>
                        <p className="mt-1 font-mono text-xs font-bold text-slate-900 dark:text-white">
                          {formatEur(p.budget.totalActualHt)} /{" "}
                          <span className="font-normal text-slate-400">
                            {formatEur(p.budget.totalSoldHt)}
                          </span>
                        </p>
                      </div>
                    </div>

                    {(p.pendingInvoicesCount > 0 || p.tasks.late > 0) && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
                        {p.pendingInvoicesCount > 0 && (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                            {p.pendingInvoicesCount} fact. à valider
                          </span>
                        )}
                        {p.tasks.late > 0 && (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                            {p.tasks.late} retard{p.tasks.late > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    )}

                    {talents.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-slate-400" />
                        {talents.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3.5 dark:border-slate-800/80">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        title="Budget"
                        onClick={() => void handleOpenProject(p.id, "/budget")}
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Tâches"
                        onClick={() =>
                          void handleOpenProject(p.id, "/retroplanning")
                        }
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                      >
                        <GanttChartSquare className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Comptes rendus Krisp"
                        onClick={() => void handleOpenProject(p.id, "/meetings")}
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                      >
                        <Mic className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={openingId === p.id}
                      onClick={() => void handleOpenProject(p.id, "/")}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                    >
                      Ouvrir le cockpit
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Secondary Admin Accordions (Add Talent + Anti-Mixing Check) */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#111827]">
          <button
            type="button"
            onClick={() => setTalentToolOpen((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/50"
          >
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Ajouter un talent / créateur (dossiers Drive auto)
              </span>
            </div>
            {talentToolOpen ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>

          {talentToolOpen && (
            <form
              onSubmit={handleAddTalent}
              className="space-y-3 border-t border-slate-100 p-5 dark:border-slate-800/80"
            >
              <select
                value={talentProjectId}
                onChange={(e) => setTalentProjectId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-100"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.client} — {p.nomJeu} (CP {p.codeProjet})
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="Nom du talent (ex : Kalut...)"
                  value={talentName}
                  onChange={(e) => setTalentName(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-800/60 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={addingTalent || !talentProjectId}
                  data-testid="add-talent-btn"
                  className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-indigo-600"
                >
                  {addingTalent ? "..." : "Créer"}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#111827]">
          <button
            type="button"
            onClick={() => setSecurityToolOpen((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/50"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Vérifier un document (anti-mélange CP)
              </span>
            </div>
            {securityToolOpen ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>

          {securityToolOpen && (
            <form
              onSubmit={handleIsolationCheck}
              className="space-y-3 border-t border-slate-100 p-5 dark:border-slate-800/80"
            >
              <select
                value={isoProjectId}
                onChange={(e) => setIsoProjectId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-100"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    CP {p.codeProjet} — {p.client}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={isoInput}
                  onChange={(e) => setIsoInput(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-800/60 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={!isoProjectId}
                  data-testid="check-isolation-btn"
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#111827] dark:text-slate-200"
                >
                  Tester
                </button>
              </div>
              {isoResult && (
                <div
                  data-testid="isolation-check-result"
                  className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${
                    isoResult.type === "conflict"
                      ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
                  }`}
                >
                  {isoResult.type === "conflict" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  ) : (
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  )}
                  <span>{isoResult.text}</span>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
