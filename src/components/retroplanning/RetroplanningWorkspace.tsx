"use client";

import { AlertTriangle, RefreshCw, Settings, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GanttBoard, type RetroTaskView } from "@/components/retroplanning/GanttBoard";
import {
  SnapshotComparator,
  type RetroSnapshotView,
  type SnapshotComparisonView,
} from "@/components/retroplanning/SnapshotComparator";
import {
  VeilleProposalPanel,
  type RetroProposalView,
} from "@/components/retroplanning/VeilleProposalPanel";

interface ShellStatusResponse {
  activeProjectId: string | null;
  projects: Array<{
    id: string;
    codeProjet: string;
    client: string;
    nomJeu: string;
    isSandbox: boolean;
  }>;
  googleConnected: boolean;
  geminiConfigured: boolean;
}

export function RetroplanningWorkspace() {
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId");

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectLabel, setProjectLabel] = useState("");
  const [tasks, setTasks] = useState<RetroTaskView[]>([]);
  const [proposals, setProposals] = useState<RetroProposalView[]>([]);
  const [snapshots, setSnapshots] = useState<RetroSnapshotView[]>([]);
  const [comparison, setComparison] = useState<SnapshotComparisonView | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingSheet, setSyncingSheet] = useState(false);
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
          setTasks([]);
          setProposals([]);
          setSnapshots([]);
          return;
        }

        setProjectId(targetId);
        const proj = shell?.projects.find((p) => p.id === targetId);
        setProjectLabel(
          proj
            ? `CP ${proj.codeProjet} | ${proj.client} — ${proj.nomJeu}`
            : `Projet ${targetId}`
        );

        if (shell && !shell.googleConnected) {
          setSetupRequiredMsg(
            "Connecteur Google Workspace non configuré. Connectez OAuth2 et la clé Gemini dans Paramètres."
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
            text: json.error ?? "Impossible de charger le rétroplanning.",
          });
          return;
        }

        setTasks(json.tasks ?? []);
        setProposals(json.proposals ?? []);
        setSnapshots(json.snapshots ?? []);
        if (syncFromSheet) {
          setFeedback({
            type: "success",
            text: "Synchronisation depuis Sheet 002.1 (Par semaine) terminée.",
          });
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
      if (active) {
        await loadAll(false);
      }
    };
    void init();
    const onRefresh = () => void loadAll(false);
    window.addEventListener("go:shell-refresh", onRefresh);
    return () => {
      active = false;
      window.removeEventListener("go:shell-refresh", onRefresh);
    };
  }, [loadAll]);

  function handleApiError(status: number, json: { error?: string; code?: string }) {
    if (status === 412) {
      setSetupRequiredMsg(
        json.error ?? "Connecteur Google Workspace / Gemini requis dans Paramètres."
      );
      return;
    }
    if (status === 409 && json.code === "CP_CONFLICT") {
      setCpConflictMsg(
        json.error ?? "Conflit de Code Projet détecté : injection automatique bloquée."
      );
      return;
    }
    setFeedback({
      type: "error",
      text: json.error ?? `Erreur HTTP ${status}.`,
    });
  }

  async function handleSyncFromSheet() {
    if (!projectId) return;
    setSyncingSheet(true);
    setFeedback(null);
    await loadAll(true);
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
    setFeedback({ type: "success", text: `Tâche "${payload.tache}" ajoutée.` });
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
    setFeedback({
      type: "success",
      text: "Tâche mise à jour et synchronisée avec 002.1.",
    });
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
      const res = await fetch(`/api/projects/${projectId}/retroplanning/veille`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeDrive: true }),
      });
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
      setFeedback({
        type: "success",
        text: `Veille IA terminée : ${json.proposals?.length ?? 0} proposition(s) générée(s).`,
      });
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
    setFeedback({
      type: "success",
      text: "Proposition appliquée à la base, au Sheet 002.1 et aux cascades Agenda.",
    });
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
      setFeedback({
        type: "success",
        text: `Snapshot archivé dans 002.2 : ${json.fileName ?? "OK"}`,
      });
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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Rétroplanning Gantt, Veille IA & Historique 14j
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {projectLabel || "Sélectionnez ou initialisez un projet."}
          </p>
        </div>

        <button
          type="button"
          disabled={!projectId || syncingSheet}
          onClick={() => void handleSyncFromSheet()}
          className="inline-flex items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-[#232b3d] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncingSheet ? "animate-spin" : ""}`} />
          Synchroniser depuis 002.1
        </button>
      </div>

      {/* Mandatory 002.1 Internal-Only Lock Banner */}
      <div
        data-testid="retroplanning-lock-banner"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-950/25 px-5 py-3.5 text-xs text-amber-100"
      >
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400" />
          <span>
            <strong>Verrou impératif 002.1 Rétroplanning Actif :</strong>{" "}
            Strictement interne par défaut (
            <code className="font-mono">NO_PERMANENT_EXT_SYNC</code>). Jamais
            synchronisé en permanence vers <code className="font-mono">[EXT]</code>{" "}
            (seul un Export ponctuel manuel existe dans Drive).
          </span>
        </div>
      </div>

      {setupRequiredMsg && (
        <div
          role="alert"
          data-testid="setup-required-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/50 bg-amber-950/40 p-4 text-xs text-amber-100"
        >
          <div className="flex items-center gap-2.5">
            <Settings className="h-4 w-4 text-amber-300" />
            <span>{setupRequiredMsg}</span>
          </div>
          <Link
            href="/settings"
            className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-slate-950 hover:bg-amber-400"
          >
            Configurer dans Paramètres
          </Link>
        </div>
      )}

      {cpConflictMsg && (
        <div
          role="alert"
          data-testid="cp-conflict-banner"
          className="flex items-center gap-2.5 rounded-xl border border-red-500/50 bg-red-950/50 p-4 text-xs font-medium text-red-200"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{cpConflictMsg}</span>
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className={`rounded-xl border p-3.5 text-xs ${
            feedback.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
              : "border-red-500/40 bg-red-950/40 text-red-200"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-8 text-center text-sm text-slate-400">
          Chargement du rétroplanning...
        </div>
      ) : (
        <>
          <GanttBoard
            tasks={tasks}
            onCreateTask={handleCreateTask}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <VeilleProposalPanel
              proposals={proposals}
              runningVeille={runningVeille}
              onRunVeille={handleRunVeille}
              onApplyProposal={handleApplyProposal}
              onDismissProposal={handleDismissProposal}
            />
            <SnapshotComparator
              snapshots={snapshots}
              comparison={comparison}
              creatingSnapshot={creatingSnapshot}
              comparing={comparing}
              onCreateSnapshot={handleCreateSnapshot}
              onCompareSnapshots={handleCompareSnapshots}
            />
          </div>
        </>
      )}
    </div>
  );
}
