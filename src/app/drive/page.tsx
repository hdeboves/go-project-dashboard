"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileDown,
  Folder,
  Lock,
  RefreshCw,
  Search,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { showToast } from "@/lib/toast";

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

const CATEGORY_FILTERS = [
  { prefix: "ALL", label: "Tous" },
  { prefix: "001", label: "Budget" },
  { prefix: "002", label: "Pilotage" },
  { prefix: "003", label: "Présentations" },
  { prefix: "004", label: "Production" },
  { prefix: "005", label: "Admin" },
  { prefix: "006", label: "Reporting" },
];

export default function DrivePage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectLabel, setProjectLabel] = useState<string>("");
  const [nodes, setNodes] = useState<DriveNodeRow[]>([]);
  const [driftCount, setDriftCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "VALIDE_CLIENT" | "DRIFT" | "SHARED"
  >("ALL");
  const [searchQuery, setSearchQuery] = useState("");
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
        `${shell.activeProject.client} — ${shell.activeProject.nomJeu} (CP ${shell.activeProject.codeProjet})`
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
          text: err.error ?? "Impossible de charger les dossiers Drive.",
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
            `${shell.activeProject.client} — ${shell.activeProject.nomJeu} (CP ${shell.activeProject.codeProjet})`
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
            text: err.error ?? "Impossible de charger les dossiers Drive.",
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
        text: json.error ?? "Impossible de modifier ce statut.",
      });
    } else {
      showToast("Statut du dossier mis à jour.");
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
        syncedCount?: number;
      };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Échec de la publication vers l'espace client.",
        });
      } else {
        const msg = `Espace client mis à jour (${json.syncedCount ?? 0} élément(s) validé(s)). Le planning actif reste privé.`;
        setFeedback({ type: "success", text: msg });
        showToast(msg);
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
          text: json.error ?? "Impossible d'exporter le PDF.",
        });
      } else {
        const msg = `PDF déposé dans l'espace client : ${json.exportedFileName}.`;
        setFeedback({ type: "success", text: msg });
        showToast(msg);
        setExportModalOpen(false);
        setExportConfirmChecked(false);
      }
    } finally {
      setExportingOnce(false);
    }
  }

  const internalNodes = useMemo(
    () => nodes.filter((n) => !n.code.startsWith("EXT.")),
    [nodes]
  );
  const extNodes = useMemo(
    () => nodes.filter((n) => n.code.startsWith("EXT.")),
    [nodes]
  );

  const publishableCount = useMemo(
    () =>
      internalNodes.filter(
        (n) =>
          n.policy.syncMode === "SYNCABLE_ON_VALIDATION" &&
          (n.syncStatus?.validationStatus === "VALIDE_CLIENT" ||
            n.syncStatus?.driftDetected)
      ).length,
    [internalNodes]
  );

  const filteredInternalNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return internalNodes.filter((n) => {
      if (activeCategory !== "ALL" && !n.code.startsWith(activeCategory)) {
        return false;
      }
      if (
        statusFilter === "VALIDE_CLIENT" &&
        n.syncStatus?.validationStatus !== "VALIDE_CLIENT"
      ) {
        return false;
      }
      if (statusFilter === "DRIFT" && !n.syncStatus?.driftDetected) {
        return false;
      }
      if (statusFilter === "SHARED" && !n.extMirrorFileId) {
        return false;
      }
      if (
        q &&
        !n.name.toLowerCase().includes(q) &&
        !n.code.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [internalNodes, activeCategory, statusFilter, searchQuery]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Calm Header with inline 002.1 Lock Pill */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Fichiers Drive
            </h1>
            <span
              data-testid="retroplanning-lock-banner"
              title="Votre rétroplanning de travail (002.1) reste toujours privé côté agence. Utilisez « Export PDF planning » pour partager une version figée au client."
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200/80 bg-indigo-50/70 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300"
            >
              <Lock className="h-3 w-3" />
              Planning interne (002.1) · PDF manuel
            </span>
            {driftCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setStatusFilter((prev) => (prev === "DRIFT" ? "ALL" : "DRIFT"))
                }
                className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300"
              >
                <AlertTriangle className="h-3 w-3" />
                {driftCount} à republier
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {projectLabel || "Sélectionnez un projet dans la barre latérale."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!projectId || loading}
            onClick={() => void loadDriveTree(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </button>

          <button
            type="button"
            disabled={!projectId}
            onClick={() => setExportModalOpen(true)}
            data-testid="open-export-once-modal-btn"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            <FileDown className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            Export PDF planning
          </button>

          <button
            type="button"
            disabled={!projectId || syncing}
            onClick={() => void handleSyncExt()}
            data-testid="sync-ext-btn"
            title="Copie uniquement les dossiers marqués « Validé client » vers le Drive client (aucun e-mail envoyé, budget et planning toujours privés)."
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50"
          >
            <UploadCloud className="h-4 w-4" />
            {syncing
              ? "Publication..."
              : publishableCount > 0
                ? `Publier vers le client (${publishableCount})`
                : "Publier vers le client"}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          data-testid="drive-feedback"
          className={`rounded-2xl border px-4 py-3 text-xs ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* 2-Column Finder-Style Explorer */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:col-span-8 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Arborescence interne{" "}
                <span className="font-normal text-slate-400">
                  ({filteredInternalNodes.length})
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Passez un livrable en « Validé client » puis cliquez sur Publier.
              </p>
            </div>

            <div className="relative w-full sm:w-52">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrer un dossier..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white dark:focus:bg-slate-900"
              />
            </div>
          </div>

          {/* Sleek Underline Category Tabs + Actionable Status Filter */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 dark:border-slate-800/80">
            <div className="flex items-center gap-1 overflow-x-auto">
              {CATEGORY_FILTERS.map((cat) => {
                const active = activeCategory === cat.prefix;
                return (
                  <button
                    key={cat.prefix}
                    type="button"
                    onClick={() => setActiveCategory(cat.prefix)}
                    className={`relative shrink-0 px-3 py-2 text-xs font-medium transition-colors ${
                      active
                        ? "text-indigo-700 dark:text-indigo-300"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    {cat.label}
                    {active && (
                      <span className="absolute right-1.5 bottom-0 left-1.5 h-0.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1 py-1.5">
              {(
                [
                  { id: "ALL", label: "Tous statuts" },
                  { id: "VALIDE_CLIENT", label: "Validés" },
                  { id: "DRIFT", label: "À republier" },
                  { id: "SHARED", label: "Partagés" },
                ] as const
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStatusFilter(st.id)}
                  className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    statusFilter === st.id
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                      : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              Chargement des dossiers...
            </p>
          ) : filteredInternalNodes.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              Aucun dossier trouvé.
            </p>
          ) : (
            <div className="max-h-[540px] divide-y divide-slate-100/80 overflow-y-auto dark:divide-slate-800/60">
              {filteredInternalNodes.map((node) => {
                const isInternalOnly =
                  node.policy.syncMode === "INTERNAL_ONLY";
                const isRetroLocked = node.isRetroplanningLocked;
                const depth = Math.max(0, node.code.split(".").length - 1);
                const isRoot = depth === 0;

                return (
                  <div
                    key={node.id}
                    data-testid={`drive-node-${node.code}`}
                    className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs transition-colors sm:flex-nowrap sm:px-5 ${
                      isRoot
                        ? "bg-slate-100/70 dark:bg-slate-800/90"
                        : "hover:bg-slate-50/70 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    <div
                      className={`flex min-w-0 flex-1 items-center gap-2.5 ${
                        depth === 1
                          ? "border-l-2 border-slate-200/80 pl-5 dark:border-slate-700/80"
                          : depth >= 2
                            ? "border-l-2 border-slate-200/60 pl-10 dark:border-slate-800"
                            : ""
                      }`}
                    >
                      <Folder
                        className={`h-4 w-4 shrink-0 ${
                          isRetroLocked
                            ? "text-indigo-500"
                            : node.extMirrorFileId
                              ? "text-emerald-500"
                              : isInternalOnly
                                ? "text-slate-400"
                                : "text-indigo-400"
                        }`}
                      />
                      <span className="shrink-0 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {node.code}
                      </span>
                      <span
                        title={node.name}
                        className={`truncate ${
                          isRoot
                            ? "font-semibold text-slate-900 dark:text-white"
                            : "font-medium text-slate-700 dark:text-slate-200"
                        }`}
                      >
                        {node.name}
                      </span>
                      {node.policy.extMirrorCode && (
                        <span className="hidden shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:inline dark:bg-slate-800 dark:text-slate-400">
                          → {node.policy.extMirrorCode}
                        </span>
                      )}
                      {node.driveFileId && (
                        <a
                          href={
                            node.isFolder
                              ? `https://drive.google.com/drive/folders/${node.driveFileId}`
                              : `https://drive.google.com/file/d/${node.driveFileId}/view`
                          }
                          target="_blank"
                          rel="noreferrer"
                          title="Ouvrir dans Google Drive"
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {isRetroLocked ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                          <Lock className="h-3 w-3" />
                          Interne (PDF manuel)
                        </span>
                      ) : isInternalOnly ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          <Lock className="h-3 w-3" />
                          Privé agence
                        </span>
                      ) : (
                        <>
                          {node.syncStatus?.driftDetected && (
                            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                              À republier
                            </span>
                          )}
                          {node.extMirrorFileId && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" />
                              Partagé
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
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-[#111827] dark:text-slate-200"
                          >
                            <option value="BROUILLON_INTERNE">
                              Brouillon interne
                            </option>
                            <option value="EN_REVUE">En relecture</option>
                            <option value="VALIDE_CLIENT">Validé client</option>
                          </select>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="self-start rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:sticky lg:top-16 lg:col-span-4 dark:border-slate-800 dark:bg-[#111827]">
          <div className="border-b border-slate-100 pb-3.5 dark:border-slate-800/80">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Espace client{" "}
              <span className="font-normal text-slate-400">
                ({extNodes.length})
              </span>
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Dossiers visibles par le client. Budget, contrats et planning
              actif sont automatiquement masqués.
            </p>
          </div>

          <div className="mt-3.5 divide-y divide-slate-100 dark:divide-slate-800/70">
            {extNodes.map((ext) => {
              const extDepth = Math.max(0, ext.code.split(".").length - 2);
              return (
                <div
                  key={ext.id}
                  className="flex items-center justify-between gap-2 py-2.5 text-xs"
                >
                  <div
                    className={`flex min-w-0 items-center gap-2 ${
                      extDepth > 0
                        ? "border-l-2 border-emerald-200/80 pl-4 dark:border-emerald-500/30"
                        : ""
                    }`}
                  >
                    <Folder className="h-4 w-4 shrink-0 text-emerald-500" />
                    <span className="shrink-0 font-mono text-[10px] text-slate-400">
                      {ext.code}
                    </span>
                    <span
                      title={ext.name}
                      className={`truncate ${
                        extDepth === 0
                          ? "font-semibold text-slate-900 dark:text-white"
                          : "font-medium text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      {ext.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {ext.driveFileId && (
                      <a
                        href={`https://drive.google.com/drive/folders/${ext.driveFileId}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Ouvrir dans Google Drive"
                        className="rounded p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {/* Light PDF Export Modal */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-[#111827]">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
              <FileDown className="h-5 w-5" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Exporter un PDF du rétroplanning
              </h3>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Un PDF figé daté sera déposé dans le dossier client{" "}
              <strong>Rétroplanning & CR</strong>. Le planning actif ne sera pas
              synchronisé automatiquement par la suite.
            </p>

            <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
              <input
                type="checkbox"
                checked={exportConfirmChecked}
                onChange={(e) => setExportConfirmChecked(e.target.checked)}
                data-testid="confirm-manual-export-checkbox"
                className="mt-0.5 h-4 w-4 accent-rose-600"
              />
              <span>
                Je confirme vouloir partager cet instantané PDF au client.
              </span>
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setExportModalOpen(false);
                  setExportConfirmChecked(false);
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-300 dark:hover:bg-slate-800/70"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!exportConfirmChecked || exportingOnce}
                onClick={() => void handleExportOnce()}
                data-testid="confirm-export-once-btn"
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {exportingOnce ? "Export..." : "Exporter le PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
