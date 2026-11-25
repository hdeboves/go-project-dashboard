"use client";

import {
  AlertTriangle,
  CalendarClock,
  Download,
  ExternalLink,
  FileSpreadsheet,
  GanttChartSquare,
  History,
  Kanban,
  ListTodo,
  Lock,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  GanttBoard,
  type RetroTaskView,
} from "@/components/retroplanning/GanttBoard";
import {
  SnapshotComparator,
  type RetroSnapshotView,
  type SnapshotComparisonView,
} from "@/components/retroplanning/SnapshotComparator";
import {
  VeilleProposalPanel,
  type RetroProposalView,
} from "@/components/retroplanning/VeilleProposalPanel";
import { showToast } from "@/lib/toast";

interface ShellStatusResponse {
  activeProjectId: string | null;
  projects: Array<{
    id: string;
    codeProjet: string;
    client: string;
    nomJeu: string;
    isSandbox: boolean;
    retroplanningSheetId?: string | null;
  }>;
  googleConnected: boolean;
  geminiConfigured: boolean;
}

type AsanaTab = "list" | "kanban" | "timeline" | "ai" | "history";

export function RetroplanningWorkspace() {
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId");
  const queryTab = searchParams.get("tab");
  const initialTab: AsanaTab =
    queryTab === "kanban" ||
    queryTab === "timeline" ||
    queryTab === "ai" ||
    queryTab === "history"
      ? queryTab
      : "list";

  const [activeTab, setActiveTab] = useState<AsanaTab>(initialTab);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectLabel, setProjectLabel] = useState("");
  const [retroSheetId, setRetroSheetId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<RetroTaskView[]>([]);
  const [proposals, setProposals] = useState<RetroProposalView[]>([]);
  const [snapshots, setSnapshots] = useState<RetroSnapshotView[]>([]);
  const [comparison, setComparison] = useState<SnapshotComparisonView | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [dateToolsOpen, setDateToolsOpen] = useState(false);
  const [anchorDate, setAnchorDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [shiftDays, setShiftDays] = useState("7");
  const [shiftingDates, setShiftingDates] = useState(false);
  const [runningVeille, setRunningVeille] = useState(false);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [setupRequiredMsg, setSetupRequiredMsg] = useState<string | null>(null);
  const [cpConflictMsg, setCpConflictMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadAll = useCallback(
    async (syncFromSheet = false) => {
      setLoading(true);
      try {
        const shellRes = await fetch("/api/shell/status", { cache: "no-store" });
        const shell = shellRes.ok
          ? ((await shellRes.json()) as ShellStatusResponse)
          : null;

        const targetId = queryProjectId || shell?.activeProjectId || null;
        if (!targetId) {
          setProjectId(null);
          setRetroSheetId(null);
          setTasks([]);
          setProposals([]);
          setSnapshots([]);
          return;
        }

        setProjectId(targetId);
        const proj = shell?.projects.find((p) => p.id === targetId);
        setProjectLabel(
          proj
            ? `${proj.client} — ${proj.nomJeu} (CP ${proj.codeProjet})`
            : `Projet actif`
        );
        if (proj?.retroplanningSheetId) {
          setRetroSheetId(proj.retroplanningSheetId);
        }

        if (shell && !shell.googleConnected) {
          setSetupRequiredMsg(
            "Connectez Google Workspace dans Paramètres pour synchroniser le planning avec Google Sheets."
          );
        } else {
          setSetupRequiredMsg(null);
        }

        const res = await fetch(
          `/api/projects/${targetId}/retroplanning${syncFromSheet ? "?syncFromSheet=1" : ""}`,
          { cache: "no-store" }
        );
        const json = (await res.json()) as {
          tasks?: RetroTaskView[];
          proposals?: RetroProposalView[];
          snapshots?: RetroSnapshotView[];
          project?: { retroplanningSheetId?: string | null };
          error?: string;
          code?: string;
        };

        if (res.status === 412) {
          setSetupRequiredMsg(
            json.error ?? "Connectez Google Workspace dans Paramètres."
          );
          return;
        }
        if (!res.ok) {
          setFeedback({
            type: "error",
            text: json.error ?? "Impossible de charger le planning.",
          });
          return;
        }

        if (json.project?.retroplanningSheetId) {
          setRetroSheetId(json.project.retroplanningSheetId);
        }
        setTasks(json.tasks ?? []);
        setProposals(json.proposals ?? []);
        setSnapshots(json.snapshots ?? []);
        if (syncFromSheet) {
          showToast("Planning synchronisé depuis Google Sheets.");
        }
      } finally {
        setLoading(false);
        setSyncingSheet(false);
      }
    },
    [queryProjectId]
  );

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) await loadAll(false);
    };
    void init();
    const onRefresh = () => void loadAll(false);
    window.addEventListener("go:shell-refresh", onRefresh);
    return () => {
      active = false;
      window.removeEventListener("go:shell-refresh", onRefresh);
    };
  }, [loadAll]);

  function handleApiError(
    status: number,
    json: { error?: string; code?: string }
  ) {
    if (status === 412) {
      setSetupRequiredMsg(
        json.error ?? "Connectez Google Workspace / IA dans Paramètres."
      );
      return;
    }
    if (status === 409 && json.code === "CP_CONFLICT") {
      setCpConflictMsg(
        json.error ?? "Document bloqué : appartient à un autre projet."
      );
      return;
    }
    const msg = json.error ?? "Une erreur est survenue.";
    setFeedback({ type: "error", text: msg });
    showToast(msg, "error");
  }

  async function handleSyncFromSheet() {
    if (!projectId) return;
    setSyncingSheet(true);
    setFeedback(null);
    await loadAll(true);
  }

  async function handleExportToGoogleSheet() {
    if (!projectId) return;
    setExportingSheet(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/retroplanning/export-sheet`,
        { method: "POST" }
      );
      const json = (await res.json()) as {
        spreadsheetId?: string;
        webViewLink?: string;
        created?: boolean;
        tasksCount?: number;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        handleApiError(res.status, json);
        return;
      }
      if (json.spreadsheetId) {
        setRetroSheetId(json.spreadsheetId);
      }
      const msg = json.created
        ? `Google Sheet créé dans le Drive (${json.tasksCount ?? 0} tâches exportées).`
        : `Google Sheet actualisé dans le Drive (${json.tasksCount ?? 0} tâches synchronisées).`;
      setFeedback({ type: "success", text: msg });
      showToast(msg);
      await loadAll(false);
    } finally {
      setExportingSheet(false);
    }
  }

  async function handleApplyBlankRetroTemplate(replaceExisting = false) {
    if (!projectId) return;
    setApplyingTemplate(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/retroplanning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "APPLY_BLANK_TEMPLATE",
          replaceExisting,
        }),
      });
      const json = (await res.json()) as {
        createdCount?: number;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        handleApiError(res.status, json);
        return;
      }
      showToast(
        `Modèle de rétroplanning vierge appliqué (${json.createdCount ?? 0} tâches sans dates).`
      );
      await loadAll(false);
    } finally {
      setApplyingTemplate(false);
    }
  }

  async function handleDateToolAction(payload: {
    deltaDays?: number;
    anchorStartDate?: string;
    clearDates?: boolean;
  }) {
    if (!projectId) return;
    setShiftingDates(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/retroplanning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SHIFT_DATES", ...payload }),
      });
      const json = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        handleApiError(res.status, json);
        return;
      }
      showToast(
        payload.clearDates
          ? "Toutes les dates ont été effacées."
          : payload.anchorStartDate
            ? `Planning daté à partir du ${payload.anchorStartDate}.`
            : `Toutes les dates décalées de ${payload.deltaDays} jour(s).`
      );
      setDateToolsOpen(false);
      await loadAll(false);
    } finally {
      setShiftingDates(false);
    }
  }

  async function handleCreateTask(payload: {
    phase: string;
    etape: string;
    tache: string;
    owner?: string;
    startDate?: string;
    endDate?: string;
    status: string;
    isMilestone: boolean;
    milestoneType?: string | null;
  }): Promise<boolean> {
    if (!projectId) return false;
    setFeedback(null);
    const res = await fetch(`/api/projects/${projectId}/retroplanning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { error?: string; code?: string };
    if (!res.ok) {
      handleApiError(res.status, json);
      return false;
    }
    showToast(`Tâche « ${payload.tache} » ajoutée.`);
    await loadAll(false);
    return true;
  }

  async function handleUpdateTask(payload: {
    id: string;
    owner?: string;
    startDate?: string | null;
    endDate?: string | null;
    status?: string;
    isMilestone?: boolean;
    milestoneType?: string | null;
    expectedUpdatedAt?: string;
  }): Promise<boolean> {
    if (!projectId) return false;
    setFeedback(null);
    const res = await fetch(`/api/projects/${projectId}/retroplanning`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { error?: string; code?: string };
    if (!res.ok) {
      handleApiError(res.status, json);
      return false;
    }
    showToast("Tâche mise à jour.");
    await loadAll(false);
    return true;
  }

  async function handleDeleteTask(taskId: string) {
    if (!projectId) return;
    setFeedback(null);
    const res = await fetch(
      `/api/projects/${projectId}/retroplanning?taskId=${encodeURIComponent(taskId)}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      showToast("Tâche supprimée.", "info");
      await loadAll(false);
    } else {
      const json = (await res.json()) as { error?: string; code?: string };
      handleApiError(res.status, json);
    }
  }

  async function handleRunVeille() {
    if (!projectId) return;
    setRunningVeille(true);
    setFeedback(null);
    setCpConflictMsg(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/retroplanning/veille`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ includeDrive: true }),
        }
      );
      const json = (await res.json()) as {
        proposals?: RetroProposalView[];
        blockedConflicts?: Array<{ reason: string }>;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        handleApiError(res.status, json);
        return;
      }
      if (json.blockedConflicts && json.blockedConflicts.length > 0) {
        setCpConflictMsg(json.blockedConflicts.map((c) => c.reason).join(" | "));
      }
      showToast(
        `Analyse terminée : ${json.proposals?.length ?? 0} suggestion(s) trouvée(s).`
      );
      await loadAll(false);
    } finally {
      setRunningVeille(false);
    }
  }

  async function handleApplyProposal(
    proposalId: string,
    overrides: { proposedStatus?: string; proposedEndDate?: string }
  ) {
    if (!projectId) return;
    setFeedback(null);
    const res = await fetch(
      `/api/projects/${projectId}/retroplanning/proposals/${proposalId}/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPLY", ...overrides }),
      }
    );
    const json = (await res.json()) as { error?: string; code?: string };
    if (!res.ok) {
      handleApiError(res.status, json);
      return;
    }
    showToast("Mise à jour appliquée au planning et à l'agenda.");
    await loadAll(false);
  }

  async function handleDismissProposal(proposalId: string) {
    if (!projectId) return;
    setFeedback(null);
    const res = await fetch(
      `/api/projects/${projectId}/retroplanning/proposals/${proposalId}/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DISMISS" }),
      }
    );
    const json = (await res.json()) as { error?: string; code?: string };
    if (!res.ok) {
      handleApiError(res.status, json);
      return;
    }
    showToast("Suggestion ignorée.", "info");
    await loadAll(false);
  }

  async function handleCreateSnapshot() {
    if (!projectId) return;
    setCreatingSnapshot(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/retroplanning/snapshots`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const json = (await res.json()) as {
        fileName?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        handleApiError(res.status, json);
        return;
      }
      showToast(`Archive créée : ${json.fileName ?? "OK"}`);
      await loadAll(false);
    } finally {
      setCreatingSnapshot(false);
    }
  }

  async function handleCompareSnapshots(fromId: string, toId: string) {
    if (!projectId) return;
    setComparing(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/retroplanning/snapshots?fromId=${encodeURIComponent(fromId)}&toId=${encodeURIComponent(toId)}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as {
        comparison?: SnapshotComparisonView;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        handleApiError(res.status, json);
        return;
      }
      setComparison(json.comparison ?? null);
    } finally {
      setComparing(false);
    }
  }

  const pendingProposalsCount = proposals.filter(
    (p) => p.status === "PENDING"
  ).length;
  const doneCount = tasks.filter((t) => t.status === "TERMINE").length;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Tâches & Planning
            </h1>
            {tasks.length > 0 && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                {doneCount} / {tasks.length} terminées
              </span>
            )}
            <Link
              href="/drive"
              data-testid="retroplanning-lock-banner"
              title="Planning interne uniquement — jamais synchronisé en continu au client (export PDF manuel dans Drive)"
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300"
            >
              <Lock className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
              Privé agence · Export PDF
            </Link>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {projectLabel || "Sélectionnez un projet dans le menu de gauche."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {projectId && (
            <a
              href={`/api/projects/${projectId}/retroplanning/export-xlsx`}
              data-testid="export-retro-xlsx-btn"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Excel (.xlsx)
            </a>
          )}

          <button
            type="button"
            disabled={!projectId || exportingSheet}
            onClick={() => void handleExportToGoogleSheet()}
            data-testid="export-retro-gsheet-btn"
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {exportingSheet
              ? "Mise à jour Drive..."
              : retroSheetId
                ? "Actualiser Google Sheets (Drive)"
                : "Exporter vers Google Sheets (Drive)"}
          </button>

          {retroSheetId && (
            <a
              href={`https://docs.google.com/spreadsheets/d/${retroSheetId}/edit`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-2xs hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
            >
              <span>Ouvrir le Sheet</span>
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
            </a>
          )}

          <button
            type="button"
            disabled={!projectId || syncingSheet}
            onClick={() => void handleSyncFromSheet()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 ${syncingSheet ? "animate-spin" : ""}`}
            />
            {syncingSheet ? "Sync..." : "Importer Sheets"}
          </button>

          <button
            type="button"
            disabled={!projectId}
            onClick={() => setDateToolsOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <CalendarClock className="h-3.5 w-3.5 text-rose-500" />
            Dates rapides
          </button>
        </div>
      </div>

      {/* Quick Date Tools & Blank Template Bar */}
      {dateToolsOpen && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-indigo-200/80 bg-indigo-50/50 p-4 text-xs dark:border-indigo-500/30 dark:bg-indigo-500/10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              Dater depuis un Kick-off :
            </span>
            <input
              type="date"
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <button
              type="button"
              disabled={shiftingDates || tasks.length === 0}
              onClick={() =>
                void handleDateToolAction({ anchorStartDate: anchorDate })
              }
              className="rounded-xl bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Auto-planifier les phases
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              Décaler tout :
            </span>
            <input
              type="number"
              value={shiftDays}
              onChange={(e) => setShiftDays(e.target.value)}
              className="w-16 rounded-xl border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <span className="text-slate-500">jours</span>
            <button
              type="button"
              disabled={shiftingDates || tasks.length === 0}
              onClick={() =>
                void handleDateToolAction({
                  deltaDays: Number.parseInt(shiftDays, 10) || 0,
                })
              }
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              Décaler
            </button>
            <button
              type="button"
              disabled={shiftingDates || tasks.length === 0}
              onClick={() => void handleDateToolAction({ clearDates: true })}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300"
            >
              Effacer les dates
            </button>
            <button
              type="button"
              disabled={applyingTemplate}
              onClick={() =>
                void handleApplyBlankRetroTemplate(tasks.length > 0)
              }
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {applyingTemplate
                ? "Application..."
                : "Charger le template vierge"}
            </button>
          </div>
        </section>
      )}

      {/* Clean Split View Tabs: Primary Task Views (Left) vs Secondary Tools (Right) */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={() => setActiveTab("list")}
            className={`inline-flex items-center gap-2 border-b-2 pb-3 text-[13px] font-semibold transition-colors ${
              activeTab === "list"
                ? "border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <ListTodo className="h-4 w-4" />
            Liste
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("kanban")}
            className={`inline-flex items-center gap-2 border-b-2 pb-3 text-[13px] font-semibold transition-colors ${
              activeTab === "kanban"
                ? "border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <Kanban className="h-4 w-4" />
            Kanban
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("timeline")}
            className={`inline-flex items-center gap-2 border-b-2 pb-3 text-[13px] font-semibold transition-colors ${
              activeTab === "timeline"
                ? "border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <GanttChartSquare className="h-4 w-4" />
            Chronologie
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => setActiveTab("ai")}
            className={`inline-flex items-center gap-1.5 border-b-2 pb-3 text-xs font-semibold transition-colors ${
              activeTab === "ai"
                ? "border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300"
                : "border-transparent text-slate-500 hover:text-violet-700 dark:text-slate-400 dark:hover:text-violet-300"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-violet-500 dark:text-violet-400" />
            Veille IA
            {pendingProposalsCount > 0 && (
              <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                {pendingProposalsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`inline-flex items-center gap-1.5 border-b-2 pb-3 text-xs font-semibold transition-colors ${
              activeTab === "history"
                ? "border-slate-700 text-slate-900 dark:border-slate-300 dark:text-white"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Historique ({snapshots.length})
          </button>
        </div>
      </div>

      {setupRequiredMsg && (
        <div
          role="alert"
          data-testid="setup-required-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-200"
        >
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span>{setupRequiredMsg}</span>
          </div>
          <Link
            href="/settings"
            className="rounded-xl bg-indigo-600 px-3.5 py-1.5 font-semibold text-white hover:bg-indigo-700"
          >
            Paramètres
          </Link>
        </div>
      )}

      {cpConflictMsg && (
        <div
          role="alert"
          data-testid="cp-conflict-banner"
          className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <span>{cpConflictMsg}</span>
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className={`rounded-2xl border p-3.5 text-xs ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
          Chargement de vos tâches...
        </div>
      ) : (
        <>
          {(activeTab === "list" ||
            activeTab === "kanban" ||
            activeTab === "timeline") && (
            <GanttBoard
              viewMode={activeTab}
              tasks={tasks}
              onCreateTask={handleCreateTask}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
            />
          )}

          {activeTab === "ai" && (
            <VeilleProposalPanel
              proposals={proposals}
              tasks={tasks}
              runningVeille={runningVeille}
              onRunVeille={handleRunVeille}
              onApplyProposal={handleApplyProposal}
              onDismissProposal={handleDismissProposal}
            />
          )}

          {activeTab === "history" && (
            <SnapshotComparator
              snapshots={snapshots}
              comparison={comparison}
              creatingSnapshot={creatingSnapshot}
              comparing={comparing}
              onCreateSnapshot={handleCreateSnapshot}
              onCompareSnapshots={handleCompareSnapshots}
            />
          )}
        </>
      )}
    </div>
  );
}
