"use client";

import {
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  ListChecks,
  Mic,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { showToast } from "@/lib/toast";

interface ActionItemView {
  text: string;
  owner?: string | null;
  dueDate?: string | null;
}

interface MeetingNoteView {
  id: string;
  projectId: string;
  source: string;
  title: string;
  meetingDate: string;
  durationMinutes: number | null;
  participants: string[];
  summary: string;
  keyDecisions: string[];
  actionItems: ActionItemView[];
  rawTranscript: string | null;
  driveFileId: string | null;
  driveFileName: string | null;
  driveWebViewLink: string | null;
  driveFolderCode: string;
  status: string;
  createdAt: string;
}

interface KrispConfigView {
  webhookUrl: string;
  webhookUrlWithSecret: string;
  secret: string;
  googleConnected: boolean;
  stats: {
    totalMeetings: number;
    savedToDriveCount: number;
  };
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

export function MeetingsWorkspace() {
  const searchParams = useSearchParams();
  const queryMeetingId = searchParams.get("meetingId");

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectLabel, setProjectLabel] = useState("");
  const [crFolderUrl, setCrFolderUrl] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<MeetingNoteView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(queryMeetingId);
  const [searchQuery, setSearchQuery] = useState("");
  const [checkedActions, setCheckedActions] = useState<Record<string, number[]>>(
    {}
  );
  const [convertedMeetingIds, setConvertedMeetingIds] = useState<Set<string>>(
    () => new Set()
  );
  const [krispConfig, setKrispConfig] = useState<KrispConfigView | null>(null);
  const [loading, setLoading] = useState(true);

  const [setupOpen, setSetupOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [creatingTasks, setCreatingTasks] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  // Import form state
  const [formTitle, setFormTitle] = useState("");
  const [formParticipants, setFormParticipants] = useState("");
  const [formSummary, setFormSummary] = useState("");
  const [formDecisions, setFormDecisions] = useState("");
  const [formActions, setFormActions] = useState("");
  const [formTranscript, setFormTranscript] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [shellRes, cfgRes] = await Promise.all([
        fetch("/api/shell/status", { cache: "no-store" }),
        fetch("/api/integrations/krisp/config", { cache: "no-store" }),
      ]);
      if (cfgRes.ok) {
        setKrispConfig((await cfgRes.json()) as KrispConfigView);
      }
      if (!shellRes.ok) return;
      const shell = (await shellRes.json()) as ShellInfo;
      if (!shell.activeProjectId || !shell.activeProject) {
        setProjectId(null);
        setMeetings([]);
        return;
      }
      setProjectId(shell.activeProjectId);
      setProjectLabel(
        `${shell.activeProject.client} — ${shell.activeProject.nomJeu} (CP ${shell.activeProject.codeProjet})`
      );

      const meetRes = await fetch(
        `/api/projects/${shell.activeProjectId}/meetings`,
        { cache: "no-store" }
      );
      if (meetRes.ok) {
        const json = (await meetRes.json()) as {
          crFolder: { url: string } | null;
          meetings: MeetingNoteView[];
        };
        setCrFolderUrl(json.crFolder?.url ?? null);
        setMeetings(json.meetings);
        setSelectedId((prev) => {
          if (queryMeetingId && json.meetings.some((m) => m.id === queryMeetingId)) {
            return queryMeetingId;
          }
          return prev && json.meetings.some((m) => m.id === prev)
            ? prev
            : (json.meetings[0]?.id ?? null);
        });
      }
    } finally {
      setLoading(false);
    }
  }, [queryMeetingId]);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) await loadData();
    };
    void init();
    const onRefresh = () => void loadData();
    window.addEventListener("go:shell-refresh", onRefresh);
    return () => {
      active = false;
      window.removeEventListener("go:shell-refresh", onRefresh);
    };
  }, [loadData]);

  async function handleCopy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copié dans le presse-papiers.`);
    } catch {
      showToast("Copie impossible sur ce navigateur.", "error");
    }
  }

  async function handleSimulateKrisp() {
    if (!projectId) return;
    setSimulating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulate: true }),
      });
      const json = (await res.json()) as {
        meeting?: MeetingNoteView;
        savedToDrive?: boolean;
        error?: string;
      };
      if (!res.ok) {
        showToast(json.error ?? "Impossible de simuler le CR Krisp.", "error");
        return;
      }
      showToast(
        json.savedToDrive
          ? "CR Krisp enregistré dans Drive (002.3) + notification envoyée !"
          : "CR Krisp créé dans le hub + notification envoyée !"
      );
      await loadData();
      if (json.meeting?.id) setSelectedId(json.meeting.id);
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setSimulating(false);
    }
  }

  async function handleManualImport(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !formTitle.trim() || !formSummary.trim()) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formTitle.trim(),
          participants: formParticipants
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
          summary: formSummary.trim(),
          keyDecisions: formDecisions
            .split("\n")
            .map((d) => d.trim())
            .filter(Boolean),
          actionItems: formActions
            .split("\n")
            .map((a) => a.trim())
            .filter(Boolean),
          rawTranscript: formTranscript.trim() || null,
        }),
      });
      const json = (await res.json()) as {
        meeting?: MeetingNoteView;
        savedToDrive?: boolean;
        error?: string;
      };
      if (!res.ok) {
        showToast(json.error ?? "Impossible d'importer ce CR.", "error");
        return;
      }
      showToast(
        json.savedToDrive
          ? "Compte rendu créé dans Drive (002.3) !"
          : "Compte rendu enregistré dans le hub !"
      );
      setFormTitle("");
      setFormParticipants("");
      setFormSummary("");
      setFormDecisions("");
      setFormActions("");
      setFormTranscript("");
      setImportOpen(false);
      await loadData();
      if (json.meeting?.id) setSelectedId(json.meeting.id);
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setImporting(false);
    }
  }

  function getSelectedActionIndices(meeting: MeetingNoteView): number[] {
    if (meeting.id in checkedActions) return checkedActions[meeting.id];
    // Pre-select internal agency actions, leave Client actions unchecked by default
    return meeting.actionItems
      .map((item, idx) =>
        (item.owner ?? "").toLowerCase().includes("client") ? -1 : idx
      )
      .filter((idx) => idx >= 0);
  }

  function toggleActionIndex(meeting: MeetingNoteView, idx: number) {
    const current = getSelectedActionIndices(meeting);
    const next = current.includes(idx)
      ? current.filter((i) => i !== idx)
      : [...current, idx];
    setCheckedActions((prev) => ({ ...prev, [meeting.id]: next }));
  }

  async function handleConvertActionsToTasks(meeting: MeetingNoteView) {
    const indices = getSelectedActionIndices(meeting);
    const chosenItems = indices
      .map((idx) => meeting.actionItems[idx])
      .filter(Boolean);
    if (!projectId || chosenItems.length === 0) return;
    setCreatingTasks(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/meetings/${meeting.id}/create-tasks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: chosenItems }),
        }
      );
      const json = (await res.json()) as {
        createdCount?: number;
        error?: string;
      };
      if (!res.ok) {
        showToast(json.error ?? "Impossible de créer les tâches.", "error");
        return;
      }
      setConvertedMeetingIds((prev) => new Set(prev).add(meeting.id));
      showToast(
        `${json.createdCount ?? 0} tâche(s) ajoutée(s) au rétroplanning !`
      );
    } finally {
      setCreatingTasks(false);
    }
  }

  const filteredMeetings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.summary.toLowerCase().includes(q) ||
        m.participants.some((p) => p.toLowerCase().includes(q)) ||
        m.keyDecisions.some((d) => d.toLowerCase().includes(q))
    );
  }, [meetings, searchQuery]);

  const selectedMeeting =
    filteredMeetings.find((m) => m.id === selectedId) ??
    filteredMeetings[0] ??
    null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Calm Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Comptes rendus Krisp
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              <Mic className="h-3 w-3" />
              Auto-classement Drive 002.3 + notif
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {projectLabel || "Sélectionnez un projet dans la barre latérale."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {crFolderUrl && (
            <a
              href={crFolderUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
            >
              <FolderOpen className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              Dossier 002.3
              <ExternalLink className="h-3 w-3 text-slate-400" />
            </a>
          )}

          <button
            type="button"
            onClick={() => setSetupOpen((v) => !v)}
            data-testid="krisp-setup-toggle"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            <Settings2 className="h-3.5 w-3.5 text-slate-500" />
            Relier Krisp
          </button>

          <button
            type="button"
            disabled={!projectId}
            onClick={() => setImportOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50"
          >
            {importOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            Importer un CR
          </button>
        </div>
      </div>

      {/* Collapsible Krisp Webhook Setup Guide */}
      {setupOpen && krispConfig && (
        <section
          data-testid="krisp-setup-panel"
          className="rounded-2xl border border-indigo-200/80 bg-white p-5 shadow-xs dark:border-indigo-500/30 dark:bg-[#111827]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Connecter Krisp en automatique (Webhook / Zapier / Make)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Dès qu&apos;une réunion se termine sur Krisp, le résumé est
                converti en Google Doc dans <strong>002.3 Comptes Rendus</strong>{" "}
                et déclenche une notification dans la cloche.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSetupOpen(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-[11px] font-semibold text-slate-500 uppercase">
                1. URL Webhook (prête à coller dans Krisp / Zapier / Make)
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-800 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                  {krispConfig.webhookUrlWithSecret}
                </code>
                <button
                  type="button"
                  onClick={() =>
                    void handleCopy(
                      krispConfig.webhookUrlWithSecret,
                      "Lien Webhook Krisp"
                    )
                  }
                  className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
                >
                  <Copy className="h-3 w-3" />
                  Copier
                </button>
              </div>
            </div>

            <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-[11px] font-semibold text-slate-500 uppercase">
                2. Routage automatique & test rapide
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                Mentionnez le <strong>client</strong>, le <strong>jeu</strong> ou
                le <strong>CP</strong> dans le titre Krisp : le Google Doc est
                rangé dans <code className="font-mono">002.3</code> et notifié.
              </p>
              <button
                type="button"
                disabled={!projectId || simulating}
                onClick={() => void handleSimulateKrisp()}
                data-testid="krisp-simulate-btn"
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {simulating
                  ? "Réception en cours..."
                  : "Simuler une réception Krisp"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Manual Import Form */}
      {importOpen && (
        <form
          onSubmit={handleManualImport}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-[#111827]"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Importer un compte rendu Krisp dans Drive (002.3)
            </h2>
            <button
              type="button"
              onClick={() => setImportOpen(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <input
              type="text"
              required
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Titre de la réunion (ex : Point Créa Semaine 48)"
              className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white"
            />
            <input
              type="text"
              value={formParticipants}
              onChange={(e) => setFormParticipants(e.target.value)}
              placeholder="Participants séparés par virgule (ex : Hugo, Paul, Client)"
              className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white"
            />
          </div>

          <textarea
            required
            rows={3}
            value={formSummary}
            onChange={(e) => setFormSummary(e.target.value)}
            placeholder="Collez ici le résumé Krisp..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white"
          />

          <div className="grid gap-3 md:grid-cols-2">
            <textarea
              rows={3}
              value={formDecisions}
              onChange={(e) => setFormDecisions(e.target.value)}
              placeholder="Décisions clés (1 par ligne)"
              className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white"
            />
            <textarea
              rows={3}
              value={formActions}
              onChange={(e) => setFormActions(e.target.value)}
              placeholder="Actions à suivre (1 par ligne)"
              className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white"
            />
          </div>

          <textarea
            rows={2}
            value={formTranscript}
            onChange={(e) => setFormTranscript(e.target.value)}
            placeholder="Transcription complète (optionnel)"
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white"
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setImportOpen(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={importing}
              className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {importing ? "Enregistrement..." : "Créer le Google Doc & notifier"}
            </button>
          </div>
        </form>
      )}

      {/* Main Split View: Meetings List (Left) + Structured CR Reader (Right) */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-14 text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Chargement des comptes rendus...
        </div>
      ) : meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-[#111827]">
          <Mic className="mx-auto h-9 w-9 text-indigo-400" />
          <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">
            Aucun compte rendu Krisp reçu sur ce projet
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
            Reliez votre webhook Krisp (ou testez dès maintenant avec un CR
            simulé) : chaque réunion est classée automatiquement dans le dossier
            Drive <strong>002.3 Comptes Rendus</strong> avec une notification.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <button
              type="button"
              disabled={!projectId || simulating}
              onClick={() => void handleSimulateKrisp()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Tester un CR Krisp maintenant
            </button>
            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Voir le lien Webhook
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* List (4 cols) */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:col-span-4 dark:border-slate-800 dark:bg-[#111827]">
            <div className="space-y-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">
                Réunions enregistrées ({filteredMeetings.length})
              </p>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher dans les CR..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/70 py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white"
                />
              </div>
            </div>
            <div className="max-h-[600px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800/80">
              {filteredMeetings.map((m) => {
                const active = selectedMeeting?.id === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(m.id);
                      setShowTranscript(false);
                    }}
                    className={`w-full px-4 py-3.5 text-left transition-colors ${
                      active
                        ? "bg-indigo-50/50 dark:bg-indigo-500/15"
                        : "hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-xs font-semibold ${
                          active
                            ? "text-indigo-700 dark:text-indigo-300"
                            : "text-slate-900 dark:text-white"
                        }`}
                      >
                        {m.title}
                      </p>
                      {m.status === "SAVED_TO_DRIVE" && (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span>
                        {new Date(m.meetingDate).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </span>
                      {m.durationMinutes && <span>· {m.durationMinutes} min</span>}
                      {m.actionItems.length > 0 && (
                        <span>· {m.actionItems.length} action(s)</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reader (8 cols) */}
          {selectedMeeting && (
            <article className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:col-span-8 dark:border-slate-800 dark:bg-[#111827]">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        selectedMeeting.status === "SAVED_TO_DRIVE"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      <FileText className="h-3 w-3" />
                      {selectedMeeting.status === "SAVED_TO_DRIVE"
                        ? "Classé dans Drive (002.3)"
                        : "Enregistré dans le hub"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                      <Clock className="h-3 w-3" />
                      {new Date(selectedMeeting.meetingDate).toLocaleDateString(
                        "fr-FR",
                        { day: "2-digit", month: "long", year: "numeric" }
                      )}
                      {selectedMeeting.durationMinutes
                        ? ` · ${selectedMeeting.durationMinutes} min`
                        : ""}
                    </span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                    {selectedMeeting.title}
                  </h2>
                  {selectedMeeting.participants.length > 0 && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <Users className="h-3.5 w-3.5" />
                      {selectedMeeting.participants.join(", ")}
                    </p>
                  )}
                </div>

                {selectedMeeting.driveWebViewLink && (
                  <a
                    href={selectedMeeting.driveWebViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                  >
                    Ouvrir le Google Doc
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>

              {/* Summary */}
              <div>
                <h3 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                  Résumé exécutif
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                  {selectedMeeting.summary}
                </p>
              </div>

              {/* Decisions */}
              {selectedMeeting.keyDecisions.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                    Décisions clés
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {selectedMeeting.keyDecisions.map((d, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200"
                      >
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Action Items + Selective 1-Click to Tasks */}
              {selectedMeeting.actionItems.length > 0 && (() => {
                const chosenIdx = getSelectedActionIndices(selectedMeeting);
                const alreadySent = convertedMeetingIds.has(selectedMeeting.id);
                return (
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-bold tracking-wider text-indigo-700 uppercase dark:text-indigo-300">
                        Actions détectées ({chosenIdx.length}/
                        {selectedMeeting.actionItems.length} sélectionnées)
                      </h3>
                      {alreadySent ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Ajoutées au rétroplanning
                          </span>
                          <Link
                            href="/retroplanning"
                            className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            Ouvrir le planning →
                          </Link>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={creatingTasks || chosenIdx.length === 0}
                          onClick={() =>
                            void handleConvertActionsToTasks(selectedMeeting)
                          }
                          data-testid="krisp-create-tasks-btn"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          <ListChecks className="h-3.5 w-3.5" />
                          {creatingTasks
                            ? "Ajout..."
                            : `Ajouter (${chosenIdx.length}) au rétroplanning`}
                        </button>
                      )}
                    </div>
                    <ul className="mt-3 divide-y divide-slate-200/70 dark:divide-slate-800">
                      {selectedMeeting.actionItems.map((a, idx) => {
                        const checked = chosenIdx.includes(idx);
                        return (
                          <li
                            key={idx}
                            className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
                          >
                            <label className="flex cursor-pointer items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={alreadySent}
                                onChange={() =>
                                  toggleActionIndex(selectedMeeting, idx)
                                }
                                className="h-3.5 w-3.5 accent-indigo-600"
                              />
                              <span className="font-medium text-slate-800 dark:text-slate-100">
                                {a.text}
                              </span>
                            </label>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                              {a.owner && (
                                <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                                  {a.owner}
                                </span>
                              )}
                              {a.dueDate && (
                                <span className="font-mono">{a.dueDate}</span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })()}

              {/* Collapsible Transcript */}
              {selectedMeeting.rawTranscript && (
                <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowTranscript((v) => !v)}
                    className="text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
                  >
                    {showTranscript
                      ? "Masquer la transcription Krisp"
                      : "Afficher la transcription complète"}
                  </button>
                  {showTranscript && (
                    <pre className="mt-2.5 max-h-60 overflow-y-auto rounded-xl bg-slate-50 p-3.5 font-sans text-xs leading-relaxed whitespace-pre-wrap text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      {selectedMeeting.rawTranscript}
                    </pre>
                  )}
                </div>
              )}
            </article>
          )}
        </div>
      )}
    </div>
  );
}
