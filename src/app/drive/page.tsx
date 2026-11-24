"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  Folder,
  FolderGit2,
  Lock,
  RefreshCw,
  ShieldAlert,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface DriveNodeRow {
  id: string;
  code: string;
  name: string;
  driveFileId: string | null;
  isFolder: boolean;
  mimeType: string | null;
  isExtEligible: boolean;
  extMirrorFileId: string | null;
  lastSyncedAt: string | null;
  isRetroplanningLocked: boolean;
  policy: {
    syncMode: "INTERNAL_ONLY" | "NO_PERMANENT_EXT_SYNC" | "SYNCABLE_ON_VALIDATION";
    extMirrorCode: string | null;
  };
  syncStatus: {
    validationStatus: "BROUILLON_INTERNE" | "EN_REVUE" | "VALIDE_CLIENT";
    driftDetected: boolean;
    allowPermanentExtSync: boolean;
    lastExtSyncAt: string | null;
  } | null;
}

interface ShellInfo {
  activeProjectId: string | null;
  activeProject: {
    id: string;
    codeProjet: string;
    client: string;
    nomJeu: string;
  } | null;
}

export default function DrivePage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectLabel, setProjectLabel] = useState<string>("");
  const [nodes, setNodes] = useState<DriveNodeRow[]>([]);
  const [driftCount, setDriftCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportConfirmChecked, setExportConfirmChecked] = useState(false);
  const [exportingOnce, setExportingOnce] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadDriveTree = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const shellRes = await fetch("/api/shell/status", { cache: "no-store" });
      if (!shellRes.ok) return;
      const shell = (await shellRes.json()) as ShellInfo;
      if (!shell.activeProjectId || !shell.activeProject) {
        setProjectId(null);
        setNodes([]);
        return;
      }
      setProjectId(shell.activeProjectId);
      setProjectLabel(
        `CP ${shell.activeProject.codeProjet} | ${shell.activeProject.client} — ${shell.activeProject.nomJeu}`
      );

      const res = await fetch(
        `/api/projects/${shell.activeProjectId}/drive${refresh ? "?refresh=1" : ""}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const json = (await res.json()) as {
          nodes: DriveNodeRow[];
          driftCount: number;
        };
        setNodes(json.nodes);
        setDriftCount(json.driftCount);
      } else {
        const err = (await res.json()) as { error?: string };
        setFeedback({
          type: "error",
          text: err.error ?? "Impossible de charger l'arborescence Drive.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const shellRes = await fetch("/api/shell/status", { cache: "no-store" });
        if (!shellRes.ok || !active) return;
        const shell = (await shellRes.json()) as ShellInfo;
        if (!shell.activeProjectId || !shell.activeProject) {
          if (active) {
            setProjectId(null);
            setNodes([]);
          }
          return;
        }
        if (active) {
          setProjectId(shell.activeProjectId);
          setProjectLabel(
            `CP ${shell.activeProject.codeProjet} | ${shell.activeProject.client} — ${shell.activeProject.nomJeu}`
          );
        }

        const res = await fetch(
          `/api/projects/${shell.activeProjectId}/drive`,
          { cache: "no-store" }
        );
        if (!active) return;
        if (res.ok) {
          const json = (await res.json()) as {
            nodes: DriveNodeRow[];
            driftCount: number;
          };
          setNodes(json.nodes);
          setDriftCount(json.driftCount);
        } else {
          const err = (await res.json()) as { error?: string };
          setFeedback({
            type: "error",
            text: err.error ?? "Impossible de charger l'arborescence Drive.",
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    const handler = () => {
      void loadDriveTree(false);
    };
    window.addEventListener("go:shell-refresh", handler);
    return () => {
      active = false;
      window.removeEventListener("go:shell-refresh", handler);
    };
  }, [loadDriveTree]);

  async function handleStatusChange(
    nodeId: string,
    validationStatus: "BROUILLON_INTERNE" | "EN_REVUE" | "VALIDE_CLIENT"
  ) {
    if (!projectId) return;
    setFeedback(null);
    const res = await fetch(`/api/projects/${projectId}/drive/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ validationStatus }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setFeedback({
        type: "error",
        text: json.error ?? "Erreur de mise à jour du statut.",
      });
    } else {
      await loadDriveTree(false);
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    }
  }

  async function handleSyncExt() {
    if (!projectId) return;
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/drive/sync-ext`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        error?: string;
        code?: string;
        syncedCount?: number;
        skippedCount?: number;
      };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: `[HTTP ${res.status} · ${json.code ?? "ERREUR"}] ${json.error ?? "Échec de la synchronisation [EXT]."}`,
        });
      } else {
        setFeedback({
          type: "success",
          text: `Synchronisation [EXT] terminée : ${json.syncedCount ?? 0} fichier(s) synchronisé(s) (via files.update en place / export propre). 002.1 Rétroplanning Actif ignoré.`,
        });
        await loadDriveTree(false);
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleExportOnce() {
    if (!projectId) return;
    setExportingOnce(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/retroplanning/export-once`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            explicitManualExportConfirm: exportConfirmChecked,
          }),
        }
      );
      const json = (await res.json()) as {
        error?: string;
        exportedFileName?: string;
      };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Échec de l'export ponctuel.",
        });
      } else {
        setFeedback({
          type: "success",
          text: `Export ponctuel figé créé dans [EXT]/01. Rétroplanning & CR : ${json.exportedFileName}. Aucune synchronisation permanente activée.`,
        });
        setExportModalOpen(false);
        setExportConfirmChecked(false);
      }
    } finally {
      setExportingOnce(false);
    }
  }

  const internalNodes = nodes.filter((n) => !n.code.startsWith("EXT."));
  const extNodes = nodes.filter((n) => n.code.startsWith("EXT."));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Drive 001→006 & Miroir Client [EXT]
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {projectLabel || "Sélectionnez ou initialisez un projet."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={!projectId || loading}
            onClick={() => void loadDriveTree(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-[#232b3d] disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Contrôler les décalages Drive
          </button>

          <button
            type="button"
            disabled={!projectId}
            onClick={() => setExportModalOpen(true)}
            data-testid="open-export-once-modal-btn"
            className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
          >
            <FileDown className="h-3.5 w-3.5" />
            Export ponctuel manuel 002.1
          </button>

          <button
            type="button"
            disabled={!projectId || syncing}
            onClick={() => void handleSyncExt()}
            data-testid="sync-ext-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-[#e11d48] px-4 py-2 text-xs font-semibold text-white hover:bg-[#ff2e58] disabled:opacity-50"
          >
            <UploadCloud className="h-4 w-4" />
            {syncing ? "Synchronisation..." : "Synchroniser vers [EXT]"}
          </button>
        </div>
      </div>

      {/* Mandatory 002.1 Lock Banner */}
      <div
        data-testid="retroplanning-lock-banner"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-950/25 px-5 py-3.5 text-xs text-amber-100"
      >
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400" />
          <span>
            <strong>Verrou impératif 002.1 Rétroplanning Actif :</strong>{" "}
            Strictement interne par défaut (<code className="font-mono">NO_PERMANENT_EXT_SYNC</code>).
            Même si son statut est &quot;Validé Client&quot;, aucune
            synchronisation permanente vers <code className="font-mono">[EXT]</code>{" "}
            n&apos;est possible.
          </span>
        </div>
        {driftCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-1 font-mono font-semibold text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            {driftCount} Décalage(s) Interne/Client détecté(s)
          </span>
        )}
      </div>

      {feedback && (
        <div
          role="status"
          data-testid="drive-feedback"
          className={`rounded-xl border p-4 text-sm ${
            feedback.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
              : "border-red-500/40 bg-red-950/40 text-red-200"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* 2-Column Tree View: Internal vs [EXT] */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Internal Tree (2 cols) */}
        <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-[#232b3d] pb-3">
            <div className="flex items-center gap-2">
              <FolderGit2 className="h-5 w-5 text-cyan-400" />
              <h2 className="text-sm font-bold text-white">
                Arborescence Interne 001. → 006. ({internalNodes.length} nœuds)
              </h2>
            </div>
            <span className="font-mono text-[11px] text-slate-400">
              files.update en place (liens clients préservés)
            </span>
          </div>

          {loading ? (
            <p className="mt-4 text-sm text-slate-400">Chargement...</p>
          ) : internalNodes.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">
              Aucun nœud Drive provisionné. Rendez-vous sur{" "}
              <code className="font-mono">/projects</code> pour initialiser
              l&apos;arborescence.
            </p>
          ) : (
            <div className="mt-3 max-h-[600px] divide-y divide-[#232b3d]/60 overflow-y-auto pr-1">
              {internalNodes.map((node) => {
                const isInternalOnly =
                  node.policy.syncMode === "INTERNAL_ONLY";
                const isRetroLocked = node.isRetroplanningLocked;

                return (
                  <div
                    key={node.id}
                    data-testid={`drive-node-${node.code}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Folder
                        className={`h-4 w-4 shrink-0 ${
                          isRetroLocked
                            ? "text-amber-400"
                            : isInternalOnly
                              ? "text-slate-500"
                              : "text-cyan-400"
                        }`}
                      />
                      <span className="font-mono text-[11px] text-slate-400">
                        {node.code}
                      </span>
                      <span className="truncate font-medium text-slate-100">
                        {node.name}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {isRetroLocked ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                          <ShieldAlert className="h-3 w-3" />
                          Verrou Interne Permanent
                        </span>
                      ) : isInternalOnly ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800/70 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                          <Lock className="h-3 w-3" />
                          Strictement Interne
                        </span>
                      ) : (
                        <>
                          {node.syncStatus?.driftDetected && (
                            <span className="rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                              Décalage Interne/Client détecté
                            </span>
                          )}
                          {node.extMirrorFileId && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" />
                              Miroir [EXT] lié
                            </span>
                          )}
                          <select
                            aria-label={`Statut de validation ${node.name}`}
                            value={
                              node.syncStatus?.validationStatus ??
                              "BROUILLON_INTERNE"
                            }
                            onChange={(e) =>
                              void handleStatusChange(
                                node.id,
                                e.target.value as
                                  | "BROUILLON_INTERNE"
                                  | "EN_REVUE"
                                  | "VALIDE_CLIENT"
                              )
                            }
                            className="rounded border border-[#232b3d] bg-[#171d2b] px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
                          >
                            <option value="BROUILLON_INTERNE">
                              Brouillon Interne
                            </option>
                            <option value="EN_REVUE">En Revue</option>
                            <option value="VALIDE_CLIENT">Validé Client</option>
                          </select>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* [EXT] Mirror Column */}
        <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
          <div className="border-b border-[#232b3d] pb-3">
            <h2 className="text-sm font-bold text-white">
              Miroir Client [EXT] ({extNodes.length} dossiers)
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Exclut automatiquement 001. Budget, 005. Administratif & 002.1
              Rétroplanning.
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {extNodes.map((ext) => (
              <div
                key={ext.id}
                className="flex items-center justify-between rounded-lg border border-[#232b3d] bg-[#171d2b]/60 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Folder className="h-4 w-4 text-emerald-400" />
                  <span className="font-medium text-slate-200">{ext.name}</span>
                </div>
                <span className="font-mono text-[10px] text-slate-400">
                  {ext.code}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Explicit Manual One-Off Export Modal for 002.1 */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-amber-500/50 bg-[#11151f] p-6 shadow-2xl">
            <div className="flex items-center gap-2.5 text-amber-300">
              <ShieldAlert className="h-5 w-5" />
              <h3 className="text-base font-bold text-white">
                Export ponctuel manuel du Rétroplanning (002.1)
              </h3>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-300">
              Cette action génère uniquement un PDF figé daté dans{" "}
              <code className="font-mono text-cyan-300">
                [EXT]/01. Rétroplanning & CR
              </code>
              . La synchronisation permanente de{" "}
              <code className="font-mono">002.1</code> reste strictement
              désactivée.
            </p>

            <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-[#232b3d] bg-[#171d2b] p-3 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={exportConfirmChecked}
                onChange={(e) => setExportConfirmChecked(e.target.checked)}
                data-testid="confirm-manual-export-checkbox"
                className="mt-0.5"
              />
              <span>
                Je confirme vouloir exporter manuellement un instantané PDF
                ponctuel du rétroplanning vers le dossier client [EXT].
              </span>
            </label>

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setExportModalOpen(false);
                  setExportConfirmChecked(false);
                }}
                className="rounded-lg border border-[#232b3d] bg-[#171d2b] px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-[#232b3d]"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!exportConfirmChecked || exportingOnce}
                onClick={() => void handleExportOnce()}
                data-testid="confirm-export-once-btn"
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
              >
                {exportingOnce ? "Export en cours..." : "Exporter le PDF figé"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
