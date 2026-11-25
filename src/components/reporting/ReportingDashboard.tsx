"use client";

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderSearch,
  Layers,
  MessageSquareQuote,
  Presentation,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  INFLUENCE_PLATFORMS,
  type InfluencePlatform,
  PLATFORM_LABELS,
  REPORTING_TABS,
  type ReportingTab,
  computeEngagementRate,
  computeInteractions,
  formatFrenchInteger,
} from "@/lib/reporting/types";

interface ShellStatus {
  activeProjectId: string | null;
  activeProject: {
    id: string;
    codeProjet: string;
    client: string;
    nomJeu: string;
    isSandbox: boolean;
    reportingSheetId?: string | null;
    reportingTemplateSlidesId?: string | null;
    talentsJson?: string;
  } | null;
  googleConnected: boolean;
  geminiConfigured: boolean;
}

interface FortniteRow {
  id: string;
  date: string;
  uniquePlayers: number;
  sessions: number;
  avgPlaytimeSec: number;
  retentionD1: number | null;
  peakConcurrent: number;
}

interface FortniteSummary {
  totalDays: number;
  totalUniquePlayers: number;
  totalSessions: number;
  avgPlaytimeSec: number;
  avgRetentionD1: number;
  maxPeakConcurrent: number;
  totalMinutesPlayed: number;
  avgPlaytimeMinPerUser: number;
  dateRangeLabel: string;
}

interface InfluenceMetricItem {
  id: string;
  projectId: string;
  rawFileId: string | null;
  talentName: string;
  platform: string;
  contentUrl: string | null;
  sparkCode: string | null;
  publishedAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  reposts: number | null;
  saves: number | null;
  engagementRate: number | null;
  confidenceJson: string | null;
  verifiedByHuman: boolean;
}

interface VerbatimItem {
  id: string;
  authorHandle: string;
  platform: string;
  talentName: string | null;
  quote: string;
  likesCount: number;
  selectedForSlides: boolean;
}

interface DriveNodeItem {
  id: string;
  code: string;
  name: string;
  driveFileId: string | null;
  isFolder: boolean;
  extMirrorFileId: string | null;
  validationStatus?: "BROUILLON_INTERNE" | "EN_REVUE" | "VALIDE_CLIENT";
  syncStatus: {
    validationStatus: "BROUILLON_INTERNE" | "EN_REVUE" | "VALIDE_CLIENT";
    driftDetected: boolean;
    allowPermanentExtSync: boolean;
  } | null;
}

interface SlideSummaryItem {
  index: number;
  objectId: string;
  type: string;
  title: string;
  subtitle?: string;
  content: string;
}

interface DriveCandidate {
  driveFileId: string;
  name: string;
  mimeType: string;
  talentHint: string | null;
  platformHint: InfluencePlatform | null;
}

type EditableMetricDraft = {
  views: string;
  likes: string;
  comments: string;
  shares: string;
  reposts: string;
  saves: string;
  contentUrl: string;
  sparkCode: string;
};

function parseConfidenceMap(json: string | null): Record<string, number> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "number" && Number.isFinite(v)) {
          out[k] = v;
        }
      }
      return out;
    }
  } catch {
    // Ignore invalid JSON
  }
  return {};
}

function toNullableIntInput(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  return Math.round(num);
}

function metricToDraft(m: InfluenceMetricItem): EditableMetricDraft {
  return {
    views: m.views !== null && m.views !== undefined ? String(m.views) : "",
    likes: m.likes !== null && m.likes !== undefined ? String(m.likes) : "",
    comments:
      m.comments !== null && m.comments !== undefined ? String(m.comments) : "",
    shares: m.shares !== null && m.shares !== undefined ? String(m.shares) : "",
    reposts:
      m.reposts !== null && m.reposts !== undefined ? String(m.reposts) : "",
    saves: m.saves !== null && m.saves !== undefined ? String(m.saves) : "",
    contentUrl: m.contentUrl ?? "",
    sparkCode: m.sparkCode ?? "",
  };
}

export function ReportingDashboard() {
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId");

  const [shell, setShell] = useState<ShellStatus | null>(null);
  const [projectId, setProjectId] = useState<string | null>(queryProjectId);
  const [loading, setLoading] = useState(true);

  const [errorBanner, setErrorBanner] = useState<{
    kind: "setup" | "cp_conflict" | "error";
    text: string;
  } | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Fortnite state
  const [fortniteFile, setFortniteFile] = useState<File | null>(null);
  const [uploadingFortnite, setUploadingFortnite] = useState(false);
  const [fortniteRows, setFortniteRows] = useState<FortniteRow[]>([]);
  const [fortniteSummary, setFortniteSummary] =
    useState<FortniteSummary | null>(null);

  // Influence state
  const [influenceMetrics, setInfluenceMetrics] = useState<
    InfluenceMetricItem[]
  >([]);
  const [metricDrafts, setMetricDrafts] = useState<
    Record<string, EditableMetricDraft>
  >({});
  const [savingMetricId, setSavingMetricId] = useState<string | null>(null);
  const [talents, setTalents] = useState<string[]>([]);
  const [infTalent, setInfTalent] = useState("");
  const [infPlatform, setInfPlatform] = useState<InfluencePlatform>("TIKTOK");
  const [infContentUrl, setInfContentUrl] = useState("");
  const [infSparkCode, setInfSparkCode] = useState("");
  const [infFile, setInfFile] = useState<File | null>(null);
  const [infDriveFileId, setInfDriveFileId] = useState("");
  const [driveCandidates, setDriveCandidates] = useState<DriveCandidate[]>([]);
  const [uploadingInfluence, setUploadingInfluence] = useState(false);

  // Verbatims state
  const [verbatims, setVerbatims] = useState<VerbatimItem[]>([]);
  const [verbHandle, setVerbHandle] = useState("");
  const [verbPlatform, setVerbPlatform] = useState<InfluencePlatform>("TIKTOK");
  const [verbTalent, setVerbTalent] = useState("");
  const [verbQuote, setVerbQuote] = useState("");
  const [verbLikes, setVerbLikes] = useState("0");
  const [verbSelected, setVerbSelected] = useState(true);
  const [addingVerbatim, setAddingVerbatim] = useState(false);

  // Consolidation & Slides state
  const [activeTab, setActiveTab] = useState<ReportingTab>(REPORTING_TABS[0]);
  const [consolidating, setConsolidating] = useState(false);
  const [reportingSheetId, setReportingSheetId] = useState<string | null>(null);
  const [generatingSlides, setGeneratingSlides] = useState(false);
  const [publishingExt, setPublishingExt] = useState(false);
  const [generatedSlides, setGeneratedSlides] = useState<SlideSummaryItem[]>(
    []
  );
  const [slidesFileId, setSlidesFileId] = useState<string | null>(null);
  const [node0063, setNode0063] = useState<DriveNodeItem | null>(null);
  const [publishedExtMessage, setPublishedExtMessage] = useState<string | null>(
    null
  );

  const handleApiFailure = useCallback(
    (status: number, json: { error?: string; code?: string }) => {
      if (status === 412) {
        setErrorBanner({
          kind: "setup",
          text:
            json.error ??
            "Connexion Google Workspace ou clé Gemini requise dans /settings.",
        });
        return;
      }
      if (status === 409 || json.code === "CP_CONFLICT") {
        setErrorBanner({
          kind: "cp_conflict",
          text:
            json.error ??
            "Conflit de Code Projet détecté. Injection automatique bloquée.",
        });
        return;
      }
      setErrorBanner({
        kind: "error",
        text: `[HTTP ${status}${json.code ? ` · ${json.code}` : ""}] ${
          json.error ?? "Une erreur est survenue."
        }`,
      });
    },
    []
  );

  const loadAllData = useCallback(
    async (explicitProjectId?: string | null, showSpinner = false) => {
      if (showSpinner) setLoading(true);
      try {
        const shellRes = await fetch("/api/shell/status", {
          cache: "no-store",
        });
        let resolvedId = explicitProjectId ?? queryProjectId ?? null;
        if (shellRes.ok) {
          const shellJson = (await shellRes.json()) as ShellStatus;
          setShell(shellJson);
          if (!resolvedId) {
            resolvedId = shellJson.activeProjectId;
          }
          if (
            shellJson.activeProject?.reportingSheetId &&
            !reportingSheetId
          ) {
            setReportingSheetId(shellJson.activeProject.reportingSheetId);
          }
        }
        setProjectId(resolvedId);
        if (!resolvedId) {
          return;
        }

        const [fortRes, infRes, verbRes, driveRes] = await Promise.all([
          fetch(`/api/projects/${resolvedId}/reporting/fortnite`, {
            cache: "no-store",
          }),
          fetch(`/api/projects/${resolvedId}/reporting/influence`, {
            cache: "no-store",
          }),
          fetch(`/api/projects/${resolvedId}/reporting/verbatims`, {
            cache: "no-store",
          }),
          fetch(`/api/projects/${resolvedId}/drive`, { cache: "no-store" }),
        ]);

        if (fortRes.ok) {
          const fortJson = (await fortRes.json()) as {
            rows: FortniteRow[];
            summary: FortniteSummary;
          };
          setFortniteRows(fortJson.rows ?? []);
          setFortniteSummary(fortJson.summary ?? null);
        }

        if (infRes.ok) {
          const infJson = (await infRes.json()) as {
            metrics: InfluenceMetricItem[];
            talents: string[];
          };
          const list = infJson.metrics ?? [];
          setInfluenceMetrics(list);
          setTalents(infJson.talents ?? []);
          if ((infJson.talents ?? []).length > 0 && !infTalent) {
            setInfTalent(infJson.talents[0]);
          }
          const drafts: Record<string, EditableMetricDraft> = {};
          for (const m of list) {
            drafts[m.id] = metricToDraft(m);
          }
          setMetricDrafts(drafts);
        }

        if (verbRes.ok) {
          const verbJson = (await verbRes.json()) as {
            verbatims: VerbatimItem[];
          };
          setVerbatims(verbJson.verbatims ?? []);
        }

        if (driveRes.ok) {
          const driveJson = (await driveRes.json()) as {
            nodes: DriveNodeItem[];
            project?: {
              reportingSheetId?: string | null;
              reportingTemplateSlidesId?: string | null;
            };
          };
          if (driveJson.project?.reportingSheetId) {
            setReportingSheetId(driveJson.project.reportingSheetId);
          }
          const found0063 =
            (driveJson.nodes ?? []).find(
              (n) => n.code === "006.3.slides" && !n.isFolder
            ) ??
            (driveJson.nodes ?? []).find(
              (n) => n.code.startsWith("006.3") && !n.isFolder
            ) ??
            null;
          setNode0063(found0063);
          if (found0063?.driveFileId) {
            setSlidesFileId(found0063.driveFileId);
          }
          if (
            found0063?.extMirrorFileId &&
            (found0063.syncStatus?.validationStatus === "VALIDE_CLIENT" ||
              found0063.validationStatus === "VALIDE_CLIENT")
          ) {
            setPublishedExtMessage(
              `Publié dans [EXT] / 04. Reporting Final (VALIDE_CLIENT) — ID ${found0063.extMirrorFileId}`
            );
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [infTalent, queryProjectId, reportingSheetId]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadAllData(queryProjectId, false);
    }, 0);
    const handler = () => {
      void loadAllData(queryProjectId, true);
    };
    window.addEventListener("go:shell-refresh", handler);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("go:shell-refresh", handler);
    };
  }, [loadAllData, queryProjectId]);

  const verifiedMetrics = useMemo(
    () => influenceMetrics.filter((m) => m.verifiedByHuman),
    [influenceMetrics]
  );

  const byTalentConsolidated = useMemo(() => {
    const map = new Map<
      string,
      {
        talentName: string;
        count: number;
        views: number;
        likes: number;
        interactions: number;
      }
    >();
    for (const m of verifiedMetrics) {
      const cur = map.get(m.talentName) ?? {
        talentName: m.talentName,
        count: 0,
        views: 0,
        likes: 0,
        interactions: 0,
      };
      cur.count += 1;
      cur.views += m.views ?? 0;
      cur.likes += m.likes ?? 0;
      cur.interactions += computeInteractions(m);
      map.set(m.talentName, cur);
    }
    return Array.from(map.values());
  }, [verifiedMetrics]);

  const byPlatformConsolidated = useMemo(() => {
    return INFLUENCE_PLATFORMS.map((plat) => {
      const rows = verifiedMetrics.filter((m) => m.platform === plat);
      const views = rows.reduce((s, r) => s + (r.views ?? 0), 0);
      const likes = rows.reduce((s, r) => s + (r.likes ?? 0), 0);
      const comments = rows.reduce((s, r) => s + (r.comments ?? 0), 0);
      const shares = rows.reduce((s, r) => s + (r.shares ?? 0), 0);
      const reposts = rows.reduce((s, r) => s + (r.reposts ?? 0), 0);
      const saves = rows.reduce((s, r) => s + (r.saves ?? 0), 0);
      const interactions = comments + shares + reposts + saves;
      return {
        platform: plat,
        label: PLATFORM_LABELS[plat],
        count: rows.length,
        views,
        likes,
        interactions,
        engagementRate: computeEngagementRate({
          views,
          likes,
          comments,
          shares,
          reposts,
          saves,
        }),
      };
    });
  }, [verifiedMetrics]);

  const cumulativeTotals = useMemo(() => {
    const views = byPlatformConsolidated.reduce((s, p) => s + p.views, 0);
    const likes = byPlatformConsolidated.reduce((s, p) => s + p.likes, 0);
    const interactions = byPlatformConsolidated.reduce(
      (s, p) => s + p.interactions,
      0
    );
    return { views, likes, interactions };
  }, [byPlatformConsolidated]);

  async function handleFortniteUpload() {
    if (!projectId) return;
    if (!fortniteFile) {
      setErrorBanner({
        kind: "error",
        text: "Sélectionnez un fichier CSV ou Excel (.xlsx) Fortnite avant d'importer.",
      });
      return;
    }

    setUploadingFortnite(true);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const form = new FormData();
      form.append("file", fortniteFile);

      const res = await fetch(`/api/projects/${projectId}/reporting/fortnite`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        error?: string;
        code?: string;
        rows?: FortniteRow[];
        summary?: FortniteSummary;
        importedCount?: number;
      };
      if (!res.ok) {
        handleApiFailure(res.status, json);
        return;
      }
      setFortniteRows(json.rows ?? []);
      setFortniteSummary(json.summary ?? null);
      setFortniteFile(null);
      setSuccessBanner(
        `${json.importedCount ?? 0} jour(s) Fortnite importé(s) et archivé(s) dans 006.1.1.`
      );
    } finally {
      setUploadingFortnite(false);
    }
  }

  async function handleLoadDriveCandidates() {
    if (!projectId) return;
    setErrorBanner(null);
    const res = await fetch(
      `/api/projects/${projectId}/reporting/influence?listDrive=1`,
      { cache: "no-store" }
    );
    const json = (await res.json()) as {
      error?: string;
      code?: string;
      driveCandidates?: DriveCandidate[];
    };
    if (!res.ok) {
      handleApiFailure(res.status, json);
      return;
    }
    setDriveCandidates(json.driveCandidates ?? []);
    if ((json.driveCandidates ?? []).length === 0) {
      setSuccessBanner(
        "Aucune capture image trouvée actuellement dans 006.1/02_Influence."
      );
    }
  }

  async function handleInfluenceUpload() {
    if (!projectId) return;
    const cleanTalent = infTalent.trim();
    if (!cleanTalent) {
      setErrorBanner({
        kind: "error",
        text: "Renseignez le nom du talent avant d'extraire la capture.",
      });
      return;
    }
    if (!infFile && !infDriveFileId) {
      setErrorBanner({
        kind: "error",
        text: "Choisissez une capture image locale ou un fichier Drive 006.1.2.",
      });
      return;
    }

    setUploadingInfluence(true);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      let res: Response;
      if (infFile) {
        const form = new FormData();
        form.append("file", infFile);
        form.append("talentName", cleanTalent);
        form.append("platform", infPlatform);
        if (infContentUrl.trim()) form.append("contentUrl", infContentUrl.trim());
        if (infSparkCode.trim()) form.append("sparkCode", infSparkCode.trim());
        res = await fetch(`/api/projects/${projectId}/reporting/influence`, {
          method: "POST",
          body: form,
        });
      } else {
        res = await fetch(`/api/projects/${projectId}/reporting/influence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driveFileId: infDriveFileId,
            talentName: cleanTalent,
            platform: infPlatform,
            contentUrl: infContentUrl.trim() || undefined,
            sparkCode: infSparkCode.trim() || undefined,
          }),
        });
      }

      const json = (await res.json()) as {
        error?: string;
        code?: string;
        metric?: InfluenceMetricItem;
      };
      if (!res.ok) {
        handleApiFailure(res.status, json);
        return;
      }

      if (json.metric) {
        setInfluenceMetrics((prev) => [json.metric!, ...prev]);
        setMetricDrafts((prev) => ({
          ...prev,
          [json.metric!.id]: metricToDraft(json.metric!),
        }));
      }
      setInfFile(null);
      setInfDriveFileId("");
      setSuccessBanner(
        `Capture analysée par Gemini Vision pour ${cleanTalent} (${PLATFORM_LABELS[infPlatform]}). Vérifiez les chiffres ci-dessous.`
      );
    } finally {
      setUploadingInfluence(false);
    }
  }

  async function handleSaveMetric(metricId: string) {
    if (!projectId) return;
    const draft = metricDrafts[metricId];
    if (!draft) return;

    setSavingMetricId(metricId);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/reporting/influence/${metricId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            views: toNullableIntInput(draft.views),
            likes: toNullableIntInput(draft.likes),
            comments: toNullableIntInput(draft.comments),
            shares: toNullableIntInput(draft.shares),
            reposts: toNullableIntInput(draft.reposts),
            saves: toNullableIntInput(draft.saves),
            contentUrl: draft.contentUrl.trim() || null,
            sparkCode: draft.sparkCode.trim() || null,
            verifiedByHuman: true,
          }),
        }
      );

      const json = (await res.json()) as {
        error?: string;
        code?: string;
        metric?: InfluenceMetricItem;
      };
      if (!res.ok) {
        handleApiFailure(res.status, json);
        return;
      }

      if (json.metric) {
        setInfluenceMetrics((prev) =>
          prev.map((m) => (m.id === metricId ? json.metric! : m))
        );
        setMetricDrafts((prev) => ({
          ...prev,
          [metricId]: metricToDraft(json.metric!),
        }));
      }
      setSuccessBanner("Métrique vérifiée et sauvegardée.");
    } finally {
      setSavingMetricId(null);
    }
  }

  async function handleAddVerbatim() {
    if (!projectId) return;
    setAddingVerbatim(true);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/reporting/verbatims`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authorHandle: verbHandle,
            platform: verbPlatform,
            talentName: verbTalent.trim() || null,
            quote: verbQuote,
            likesCount: Math.max(0, Number(verbLikes) || 0),
            selectedForSlides: verbSelected,
          }),
        }
      );
      const json = (await res.json()) as {
        error?: string;
        code?: string;
        verbatim?: VerbatimItem;
      };
      if (!res.ok) {
        handleApiFailure(res.status, json);
        return;
      }
      if (json.verbatim) {
        setVerbatims((prev) => {
          const withoutDup = prev.filter((v) => v.id !== json.verbatim!.id);
          return [json.verbatim!, ...withoutDup];
        });
      }
      setVerbHandle("");
      setVerbQuote("");
      setVerbLikes("0");
      setSuccessBanner("Verbatim ajouté.");
    } finally {
      setAddingVerbatim(false);
    }
  }

  async function handleToggleVerbatim(v: VerbatimItem) {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/reporting/verbatims`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verbatimId: v.id,
        selectedForSlides: !v.selectedForSlides,
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as { verbatim: VerbatimItem };
      setVerbatims((prev) =>
        prev.map((item) => (item.id === v.id ? json.verbatim : item))
      );
    }
  }

  async function handleConsolidate() {
    if (!projectId) return;
    setConsolidating(true);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/reporting/consolidate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const json = (await res.json()) as {
        error?: string;
        code?: string;
        reportingSheetId?: string;
        warnings?: string[];
      };
      if (!res.ok) {
        handleApiFailure(res.status, json);
        return;
      }
      if (json.reportingSheetId) {
        setReportingSheetId(json.reportingSheetId);
      }
      setSuccessBanner(
        `Consolidation 4 onglets réussie dans Google Sheets (006.2 : ${json.reportingSheetId ?? ""}).${
          json.warnings?.length ? ` ${json.warnings.join(" ")}` : ""
        }`
      );
    } finally {
      setConsolidating(false);
    }
  }

  async function handleGenerateSlides() {
    if (!projectId) return;
    setGeneratingSlides(true);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/reporting/generate-slides`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const json = (await res.json()) as {
        error?: string;
        code?: string;
        slidesFileId?: string;
        slides?: SlideSummaryItem[];
      };
      if (!res.ok) {
        handleApiFailure(res.status, json);
        return;
      }
      setSlidesFileId(json.slidesFileId ?? null);
      setGeneratedSlides(json.slides ?? []);
      setSuccessBanner(
        `Slides générés dans 006.3 (${json.slides?.length ?? 0} slides, format 16:9 charté).`
      );
      await loadAllData(projectId);
    } finally {
      setGeneratingSlides(false);
    }
  }

  async function handleValidationStatusChange(
    nextStatus: "BROUILLON_INTERNE" | "EN_REVUE" | "VALIDE_CLIENT"
  ) {
    if (!projectId || !node0063) return;
    setErrorBanner(null);
    const res = await fetch(
      `/api/projects/${projectId}/drive/nodes/${node0063.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validationStatus: nextStatus }),
      }
    );
    const json = (await res.json()) as {
      error?: string;
      code?: string;
      syncStatus?: DriveNodeItem["syncStatus"];
    };
    if (!res.ok) {
      handleApiFailure(res.status, json);
      return;
    }
    setNode0063((prev) =>
      prev
        ? {
            ...prev,
            validationStatus: nextStatus,
            syncStatus: json.syncStatus ?? prev.syncStatus,
          }
        : prev
    );
    setSuccessBanner(`Statut de validation 006.3 mis à jour : ${nextStatus}.`);
  }

  async function handlePublishExt() {
    if (!projectId) return;
    setPublishingExt(true);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/reporting/publish-ext`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmValidation: true }),
        }
      );
      const json = (await res.json()) as {
        error?: string;
        code?: string;
        extMirrorFileId?: string;
      };
      if (!res.ok) {
        handleApiFailure(res.status, json);
        return;
      }
      const msg = `Publié dans [EXT] / 04. Reporting Final (VALIDE_CLIENT) — ID ${
        json.extMirrorFileId ?? ""
      }`;
      setPublishedExtMessage(msg);
      setSuccessBanner(msg);
      await loadAllData(projectId);
    } finally {
      setPublishingExt(false);
    }
  }

  const showSetupWarning =
    errorBanner?.kind === "setup" ||
    (shell !== null && (!shell.googleConnected || !shell.geminiConfigured));

  const currentValidationStatus =
    node0063?.syncStatus?.validationStatus ??
    node0063?.validationStatus ??
    "BROUILLON_INTERNE";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <BarChart3 className="h-6 w-6 text-[#e11d48]" />
            <h1 className="text-2xl font-bold text-white">
              Reporting Fin de Jeu Fortnite &amp; Influence
            </h1>
            <span className="rounded-full border border-[#e11d48]/40 bg-[#e11d48]/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-rose-300">
              Jalon 3 · M4
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {shell?.activeProject
              ? `CP ${shell.activeProject.codeProjet} · ${shell.activeProject.client} — ${shell.activeProject.nomJeu}`
              : projectId
                ? `Projet ${projectId}`
                : "Sélectionnez un projet pour démarrer le reporting."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadAllData(projectId)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-[#232b3d] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </div>

      {/* Precondition 412 Banner */}
      {showSetupWarning && (
        <div
          role="alert"
          data-testid="setup-required-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/50 bg-amber-950/30 p-4 text-sm text-amber-100"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
            <span>
              {errorBanner?.kind === "setup"
                ? errorBanner.text
                : "Configuration requise : connectez Google Workspace (OAuth2) et renseignez GEMINI_API_KEY pour exécuter les imports Drive/Sheets/Slides et l'extraction Vision."}
            </span>
          </div>
          <Link
            href="/settings"
            className="rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
          >
            Configurer dans Paramètres
          </Link>
        </div>
      )}

      {/* CP Conflict or Error Banner */}
      {errorBanner && errorBanner.kind !== "setup" && (
        <div
          role="alert"
          data-testid={
            errorBanner.kind === "cp_conflict"
              ? "cp-conflict-banner"
              : "error-banner"
          }
          className="flex items-center gap-2.5 rounded-xl border border-red-500 bg-red-950/50 p-4 text-sm text-red-200"
        >
          <ShieldAlert className="h-5 w-5 shrink-0 text-red-400" />
          <span>{errorBanner.text}</span>
        </div>
      )}

      {/* Success Banner */}
      {successBanner && (
        <div
          role="status"
          data-testid="reporting-success-banner"
          className="flex items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-4 text-sm text-emerald-200"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
          <span>{successBanner}</span>
        </div>
      )}

      {/* SECTION 1: Fortnite Creator Portal (F20) */}
      <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#232b3d] pb-4">
          <div>
            <h2 className="text-base font-bold text-white">
              1. Portail Créateur Fortnite (006.1.1)
            </h2>
            <p className="text-xs text-slate-400">
              Importez les exports CSV (virgule ou point-virgule) ou Excel
              (.xlsx) Epic Games Creator Portal.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,.xlsx"
              data-testid="fortnite-file-input"
              onChange={(e) => setFortniteFile(e.target.files?.[0] ?? null)}
              className="block text-xs text-slate-300 file:mr-3 file:rounded-lg file:border file:border-[#232b3d] file:bg-[#171d2b] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-200 hover:file:bg-[#232b3d]"
            />
            <button
              type="button"
              disabled={uploadingFortnite || !projectId}
              onClick={() => void handleFortniteUpload()}
              data-testid="fortnite-import-btn"
              className="inline-flex items-center gap-2 rounded-lg bg-[#e11d48] px-4 py-2 text-xs font-semibold text-white hover:bg-[#ff2e58] disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploadingFortnite
                ? "Import en cours..."
                : "Importer le fichier Fortnite"}
            </button>
          </div>
        </div>

        {/* Fortnite KPI Cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-[#232b3d] bg-[#171d2b] p-4">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">
              Joueurs uniques
            </p>
            <p className="mt-1 font-mono text-xl font-bold text-white">
              {formatFrenchInteger(fortniteSummary?.totalUniquePlayers ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border border-[#232b3d] bg-[#171d2b] p-4">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">
              Sessions totales
            </p>
            <p className="mt-1 font-mono text-xl font-bold text-white">
              {formatFrenchInteger(fortniteSummary?.totalSessions ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border border-[#232b3d] bg-[#171d2b] p-4">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">
              Temps moyen / session
            </p>
            <p className="mt-1 font-mono text-xl font-bold text-cyan-300">
              {formatFrenchInteger(fortniteSummary?.avgPlaytimeSec ?? 0)} s
            </p>
          </div>
          <div className="rounded-lg border border-[#232b3d] bg-[#171d2b] p-4">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">
              Rétention J1 moyenne
            </p>
            <p className="mt-1 font-mono text-xl font-bold text-emerald-300">
              {fortniteSummary?.avgRetentionD1 ?? 0}%
            </p>
          </div>
          <div className="rounded-lg border border-[#232b3d] bg-[#171d2b] p-4">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">
              Pic simultané max
            </p>
            <p className="mt-1 font-mono text-xl font-bold text-amber-300">
              {formatFrenchInteger(fortniteSummary?.maxPeakConcurrent ?? 0)}
            </p>
          </div>
        </div>

        {/* Daily Fortnite Table */}
        {fortniteRows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-[#232b3d]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#171d2b] text-[11px] uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Joueurs uniques</th>
                  <th className="px-3 py-2.5">Sessions</th>
                  <th className="px-3 py-2.5">Temps moyen (s)</th>
                  <th className="px-3 py-2.5">Rétention J1 (%)</th>
                  <th className="px-3 py-2.5">Pic simultané</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232b3d]/60">
                {fortniteRows.map((r) => (
                  <tr key={r.id} className="hover:bg-[#171d2b]/50">
                    <td className="px-3 py-2 font-mono text-slate-200">
                      {r.date}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatFrenchInteger(r.uniquePlayers)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatFrenchInteger(r.sessions)}
                    </td>
                    <td className="px-3 py-2 font-mono">{r.avgPlaytimeSec}</td>
                    <td className="px-3 py-2 font-mono">
                      {r.retentionD1 !== null ? `${r.retentionD1}%` : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatFrenchInteger(r.peakConcurrent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* SECTION 2: Influence Gemini Vision & Side-by-Side Control UI (F21) */}
      <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#232b3d] pb-4">
          <div>
            <h2 className="text-base font-bold text-white">
              2. Captures WhatsApp Influence &amp; Contrôle Côte à Côte (006.1.2)
            </h2>
            <p className="text-xs text-slate-400">
              Extraction multimodale Gemini Vision puis validation humaine
              obligatoire avant consolidation.
            </p>
          </div>
          <button
            type="button"
            disabled={!projectId}
            onClick={() => void handleLoadDriveCandidates()}
            className="inline-flex items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-[#232b3d]"
          >
            <FolderSearch className="h-3.5 w-3.5 text-cyan-400" />
            Charger depuis Drive 006.1.2
          </button>
        </div>

        {/* Upload / Drive Pick Form */}
        <div className="grid gap-3 rounded-lg border border-[#232b3d] bg-[#171d2b]/70 p-4 md:grid-cols-6">
          <div className="md:col-span-1">
            <label className="mb-1 block text-[11px] font-medium text-slate-300">
              Talent
            </label>
            <input
              type="text"
              list="talents-datalist"
              value={infTalent}
              onChange={(e) => setInfTalent(e.target.value)}
              placeholder="ex: Kalut"
              className="w-full rounded-lg border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
            <datalist id="talents-datalist">
              {talents.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          <div className="md:col-span-1">
            <label className="mb-1 block text-[11px] font-medium text-slate-300">
              Plateforme
            </label>
            <select
              value={infPlatform}
              onChange={(e) =>
                setInfPlatform(e.target.value as InfluencePlatform)
              }
              className="w-full rounded-lg border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
            >
              {INFLUENCE_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-1">
            <label className="mb-1 block text-[11px] font-medium text-slate-300">
              URL Contenu
            </label>
            <input
              type="text"
              value={infContentUrl}
              onChange={(e) => setInfContentUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="md:col-span-1">
            <label className="mb-1 block text-[11px] font-medium text-slate-300">
              Code Spark Ads
            </label>
            <input
              type="text"
              value={infSparkCode}
              onChange={(e) => setInfSparkCode(e.target.value)}
              placeholder="#SPARK..."
              className="w-full rounded-lg border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="md:col-span-2 flex flex-col justify-end gap-2">
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              data-testid="influence-file-input"
              onChange={(e) => {
                setInfFile(e.target.files?.[0] ?? null);
                setInfDriveFileId("");
              }}
              className="block text-xs text-slate-300 file:mr-2 file:rounded file:border file:border-[#232b3d] file:bg-[#090b10] file:px-2.5 file:py-1 file:text-xs file:text-slate-200"
            />
            {driveCandidates.length > 0 && (
              <select
                value={infDriveFileId}
                onChange={(e) => {
                  const chosen = driveCandidates.find(
                    (c) => c.driveFileId === e.target.value
                  );
                  setInfDriveFileId(e.target.value);
                  setInfFile(null);
                  if (chosen?.talentHint) setInfTalent(chosen.talentHint);
                  if (chosen?.platformHint) setInfPlatform(chosen.platformHint);
                }}
                className="rounded border border-[#232b3d] bg-[#090b10] px-2 py-1 text-xs text-slate-200"
              >
                <option value="">-- Ou choisir un fichier Drive 006.1.2 --</option>
                {driveCandidates.map((c) => (
                  <option key={c.driveFileId} value={c.driveFileId}>
                    {c.talentHint ? `${c.talentHint} / ` : ""}
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={uploadingInfluence || !projectId}
              onClick={() => void handleInfluenceUpload()}
              data-testid="influence-extract-btn"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#e11d48] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#ff2e58] disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {uploadingInfluence
                ? "Extraction Vision..."
                : "Analyser avec Gemini Vision"}
            </button>
          </div>
        </div>

        {/* Side-by-Side Verification Cards */}
        {influenceMetrics.length === 0 ? (
          <p className="text-xs text-slate-400">
            Aucune capture Influence ingérée pour ce projet.
          </p>
        ) : (
          <div className="space-y-4">
            {influenceMetrics.map((m) => {
              const draft = metricDrafts[m.id] ?? metricToDraft(m);
              const confidenceMap = parseConfidenceMap(m.confidenceJson);
              const previewSrc =
                m.rawFileId && projectId
                  ? `/api/projects/${projectId}/reporting/preview/${m.rawFileId}`
                  : null;
              const platLabel =
                PLATFORM_LABELS[m.platform as InfluencePlatform] ?? m.platform;

              const previewEng = computeEngagementRate({
                views: toNullableIntInput(draft.views),
                likes: toNullableIntInput(draft.likes),
                comments: toNullableIntInput(draft.comments),
                shares: toNullableIntInput(draft.shares),
                reposts: toNullableIntInput(draft.reposts),
                saves: toNullableIntInput(draft.saves),
              });

              const previewInteractions = computeInteractions({
                comments: toNullableIntInput(draft.comments),
                shares: toNullableIntInput(draft.shares),
                reposts: toNullableIntInput(draft.reposts),
                saves: toNullableIntInput(draft.saves),
              });

              const numericFields: Array<{
                key: keyof Pick<
                  EditableMetricDraft,
                  "views" | "likes" | "comments" | "shares" | "reposts" | "saves"
                >;
                label: string;
              }> = [
                { key: "views", label: "Vues" },
                { key: "likes", label: "Likes" },
                { key: "comments", label: "Commentaires" },
                { key: "shares", label: "Partages" },
                { key: "reposts", label: "Reposts" },
                { key: "saves", label: "Enregistrements" },
              ];

              return (
                <div
                  key={m.id}
                  data-testid={`influence-card-${m.id}`}
                  className="grid gap-5 rounded-xl border border-[#232b3d] bg-[#171d2b]/70 p-4 lg:grid-cols-12"
                >
                  {/* Left: Raw Screenshot Preview */}
                  <div
                    data-testid="influence-preview-pane"
                    className="flex flex-col items-center justify-center rounded-lg border border-[#232b3d] bg-[#090b10] p-3 lg:col-span-4"
                  >
                    {previewSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        data-testid="influence-screenshot-preview"
                        src={previewSrc}
                        alt={`Capture Influence ${m.talentName} ${platLabel}`}
                        className="max-h-72 w-auto rounded object-contain"
                      />
                    ) : (
                      <div className="py-10 text-xs text-slate-500">
                        Aperçu image indisponible
                      </div>
                    )}
                    <p className="mt-2 font-mono text-[10px] text-slate-400">
                      Original immuable dans 006.1.2
                    </p>
                  </div>

                  {/* Right: Editable Verified Fields */}
                  <div className="space-y-4 lg:col-span-8">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-bold text-white">
                          {m.talentName}
                        </span>
                        <span className="rounded bg-[#232b3d] px-2 py-0.5 font-mono text-[11px] text-cyan-300">
                          {platLabel}
                        </span>
                        {m.verifiedByHuman ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" />
                            Vérifié
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                            <AlertTriangle className="h-3 w-3" />À vérifier
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 font-mono text-xs">
                        <span className="text-slate-300">
                          Interactions :{" "}
                          <strong className="text-white">
                            {formatFrenchInteger(previewInteractions)}
                          </strong>
                        </span>
                        <span className="text-slate-300">
                          Engagement :{" "}
                          <strong className="text-amber-300">
                            {previewEng}%
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* Numeric Grid */}
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      {numericFields.map(({ key, label }) => {
                        const conf = confidenceMap[key];
                        const isLowConfidence =
                          typeof conf === "number" && conf < 0.8;
                        return (
                          <div key={key}>
                            <label className="mb-1 flex items-center justify-between text-[11px] text-slate-300">
                              <span>{label}</span>
                              {isLowConfidence && (
                                <span
                                  title={`Confiance IA : ${Math.round(conf * 100)}%`}
                                  className="rounded bg-amber-500/20 px-1 text-[9px] font-bold text-amber-300"
                                >
                                  {Math.round(conf * 100)}%
                                </span>
                              )}
                            </label>
                            <input
                              type="number"
                              min={0}
                              name={key}
                              data-testid={`influence-${key}-input`}
                              value={draft[key]}
                              onChange={(e) =>
                                setMetricDrafts((prev) => ({
                                  ...prev,
                                  [m.id]: {
                                    ...draft,
                                    [key]: e.target.value,
                                  },
                                }))
                              }
                              placeholder="—"
                              className={`w-full rounded-lg border bg-[#090b10] px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none ${
                                isLowConfidence
                                  ? "border-amber-500/70 focus:border-amber-400"
                                  : "border-[#232b3d] focus:border-cyan-500"
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>

                    {/* Content URL & Spark Code */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-400">
                          Lien du contenu ({m.contentUrl ?? "non renseigné"})
                        </label>
                        <input
                          type="text"
                          name="contentUrl"
                          value={draft.contentUrl}
                          onChange={(e) =>
                            setMetricDrafts((prev) => ({
                              ...prev,
                              [m.id]: {
                                ...draft,
                                contentUrl: e.target.value,
                              },
                            }))
                          }
                          className="w-full rounded-lg border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-400">
                          Code Spark Ads ({m.sparkCode ?? "non renseigné"})
                        </label>
                        <input
                          type="text"
                          name="sparkCode"
                          value={draft.sparkCode}
                          onChange={(e) =>
                            setMetricDrafts((prev) => ({
                              ...prev,
                              [m.id]: {
                                ...draft,
                                sparkCode: e.target.value,
                              },
                            }))
                          }
                          className="w-full rounded-lg border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={savingMetricId === m.id}
                        onClick={() => void handleSaveMetric(m.id)}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {savingMetricId === m.id
                          ? "Enregistrement..."
                          : "Valider & Vérifier"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 3: Verbatims & 4-Tab Consolidation + .xlsx Export (F22) */}
      <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#232b3d] pb-4">
          <div>
            <h2 className="text-base font-bold text-white">
              3. Consolidation 4 Onglets (006.2) &amp; Export Excel
            </h2>
            <p className="text-xs text-slate-400">
              Réconciliation automatique des métriques vérifiées + gestion des
              verbatims sélectionnés pour les Slides.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={consolidating || !projectId}
              onClick={() => void handleConsolidate()}
              data-testid="consolidate-sheets-btn"
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {consolidating
                ? "Consolidation..."
                : "Consolider vers Sheets (006.2)"}
            </button>

            {projectId && (
              <a
                href={`/api/projects/${projectId}/reporting/export-xlsx`}
                download={`reporting_${shell?.activeProject?.codeProjet ?? projectId}.xlsx`}
                data-testid="export-xlsx-link"
                className="inline-flex items-center gap-2 rounded-lg bg-[#e11d48] px-4 py-2 text-xs font-semibold text-white hover:bg-[#ff2e58]"
              >
                <Download className="h-4 w-4" />
                Exporter .xlsx
              </a>
            )}
          </div>
        </div>

        {reportingSheetId && (
          <div className="flex items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 text-xs text-slate-300">
            <Layers className="h-4 w-4 text-cyan-400" />
            <span>
              Google Sheet 006.2 lié :{" "}
              <code className="font-mono text-cyan-300">{reportingSheetId}</code>
            </span>
          </div>
        )}

        {/* 4-Tab Bar (All 4 exact tab names rendered simultaneously) */}
        <div className="flex flex-wrap gap-2 border-b border-[#232b3d] pb-2">
          {REPORTING_TABS.map((tabName) => {
            const isActive = activeTab === tabName;
            return (
              <button
                key={tabName}
                type="button"
                onClick={() => setActiveTab(tabName)}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                  isActive
                    ? "bg-[#e11d48] text-white"
                    : "border border-[#232b3d] bg-[#171d2b] text-slate-300 hover:bg-[#232b3d]"
                }`}
              >
                {tabName}
              </button>
            );
          })}
        </div>

        {/* Tab Preview Panel */}
        {activeTab === "Synthèse Fortnite" && (
          <div className="overflow-x-auto rounded-lg border border-[#232b3d]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#171d2b] text-[11px] uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Joueurs uniques</th>
                  <th className="px-3 py-2">Sessions</th>
                  <th className="px-3 py-2">Temps moyen (s)</th>
                  <th className="px-3 py-2">Rétention J1 (%)</th>
                  <th className="px-3 py-2">Pic simultané</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232b3d]/60">
                {fortniteRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-4 text-center text-slate-400"
                    >
                      Aucune donnée Fortnite importée.
                    </td>
                  </tr>
                ) : (
                  fortniteRows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-mono">{r.date}</td>
                      <td className="px-3 py-2 font-mono">
                        {formatFrenchInteger(r.uniquePlayers)}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {formatFrenchInteger(r.sessions)}
                      </td>
                      <td className="px-3 py-2 font-mono">{r.avgPlaytimeSec}</td>
                      <td className="px-3 py-2 font-mono">
                        {r.retentionD1 ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {formatFrenchInteger(r.peakConcurrent)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "Influence par Talent" && (
          <div className="overflow-x-auto rounded-lg border border-[#232b3d]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#171d2b] text-[11px] uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Talent</th>
                  <th className="px-3 py-2">Contenus vérifiés</th>
                  <th className="px-3 py-2">Vues</th>
                  <th className="px-3 py-2">Likes</th>
                  <th className="px-3 py-2">Interactions (hors Likes)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232b3d]/60">
                {byTalentConsolidated.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-slate-400"
                    >
                      Aucune métrique Influence vérifiée (verifiedByHuman =
                      true).
                    </td>
                  </tr>
                ) : (
                  byTalentConsolidated.map((t) => (
                    <tr key={t.talentName}>
                      <td className="px-3 py-2 font-semibold text-white">
                        {t.talentName}
                      </td>
                      <td className="px-3 py-2 font-mono">{t.count}</td>
                      <td className="px-3 py-2 font-mono">
                        {formatFrenchInteger(t.views)}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {formatFrenchInteger(t.likes)}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {formatFrenchInteger(t.interactions)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "Cumulé Réseaux" && (
          <div className="overflow-x-auto rounded-lg border border-[#232b3d]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#171d2b] text-[11px] uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Plateforme</th>
                  <th className="px-3 py-2">Contenus</th>
                  <th className="px-3 py-2">Vues</th>
                  <th className="px-3 py-2">Likes</th>
                  <th className="px-3 py-2">Interactions</th>
                  <th className="px-3 py-2">Engagement %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232b3d]/60">
                {byPlatformConsolidated.map((p) => (
                  <tr key={p.platform}>
                    <td className="px-3 py-2 font-semibold text-white">
                      {p.label}
                    </td>
                    <td className="px-3 py-2 font-mono">{p.count}</td>
                    <td className="px-3 py-2 font-mono">
                      {formatFrenchInteger(p.views)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatFrenchInteger(p.likes)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatFrenchInteger(p.interactions)}
                    </td>
                    <td className="px-3 py-2 font-mono">{p.engagementRate}%</td>
                  </tr>
                ))}
                <tr className="bg-[#171d2b] font-bold text-white">
                  <td className="px-3 py-2">Total Général</td>
                  <td className="px-3 py-2 font-mono">
                    {verifiedMetrics.length}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatFrenchInteger(cumulativeTotals.views)}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatFrenchInteger(cumulativeTotals.likes)}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatFrenchInteger(cumulativeTotals.interactions)}
                  </td>
                  <td className="px-3 py-2 font-mono">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "Verbatims" && (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border border-[#232b3d] bg-[#171d2b]/60 p-4 md:grid-cols-6">
              <input
                type="text"
                value={verbHandle}
                onChange={(e) => setVerbHandle(e.target.value)}
                placeholder="@auteur"
                className="rounded-lg border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-white"
              />
              <select
                value={verbPlatform}
                onChange={(e) =>
                  setVerbPlatform(e.target.value as InfluencePlatform)
                }
                className="rounded-lg border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-white"
              >
                {INFLUENCE_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={verbTalent}
                onChange={(e) => setVerbTalent(e.target.value)}
                placeholder="Talent (optionnel)"
                className="rounded-lg border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-white"
              />
              <input
                type="text"
                value={verbQuote}
                onChange={(e) => setVerbQuote(e.target.value)}
                placeholder="Citation de la communauté..."
                className="md:col-span-2 rounded-lg border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-white"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={verbLikes}
                  onChange={(e) => setVerbLikes(e.target.value)}
                  className="w-16 rounded-lg border border-[#232b3d] bg-[#090b10] px-2 py-1.5 font-mono text-xs text-white"
                />
                <label className="flex items-center gap-1 text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={verbSelected}
                    onChange={(e) => setVerbSelected(e.target.checked)}
                  />
                  Slides
                </label>
                <button
                  type="button"
                  disabled={addingVerbatim || !projectId}
                  onClick={() => void handleAddVerbatim()}
                  className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  Ajouter
                </button>
              </div>
            </div>

            <div className="divide-y divide-[#232b3d]/60 rounded-lg border border-[#232b3d]">
              {verbatims.length === 0 ? (
                <p className="p-4 text-center text-xs text-slate-400">
                  Aucun verbatim enregistré.
                </p>
              ) : (
                verbatims.map((v) => (
                  <div
                    key={v.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <MessageSquareQuote className="h-3.5 w-3.5 text-cyan-400" />
                        <span className="font-semibold text-white">
                          {v.authorHandle}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {PLATFORM_LABELS[v.platform as InfluencePlatform] ??
                            v.platform}
                          {v.talentName ? ` · ${v.talentName}` : ""}
                        </span>
                      </div>
                      <p className="text-slate-200">&ldquo;{v.quote}&rdquo;</p>
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={v.selectedForSlides}
                        onChange={() => void handleToggleVerbatim(v)}
                      />
                      Sélectionné Slides
                    </label>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </section>

      {/* SECTION 4: Branded Slides Generator (006.3) & [EXT] Publish (F23) */}
      <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#232b3d] pb-4">
          <div>
            <h2 className="text-base font-bold text-white">
              4. Google Slides Reporting Charté (006.3) &amp; Publication [EXT]
            </h2>
            <p className="text-xs text-slate-400">
              Format 16:9 (9144000×5143500 EMU), charte GamersOrigin / client
              appliquée, graphique détaché en image fixe lors de la publication
              [EXT]/04. Reporting Final.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={generatingSlides || !projectId}
              onClick={() => void handleGenerateSlides()}
              data-testid="generate-slides-btn"
              className="inline-flex items-center gap-2 rounded-lg bg-[#2543BD] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4C6CFF] disabled:opacity-50"
            >
              <Presentation className="h-4 w-4" />
              {generatingSlides
                ? "Génération..."
                : "Générer Slides Reporting (006.3)"}
            </button>

            {node0063 && (
              <select
                name="validationStatus"
                data-testid="reporting-validation-select"
                aria-label="Statut de validation 006.3"
                value={currentValidationStatus}
                onChange={(e) =>
                  void handleValidationStatusChange(
                    e.target.value as
                      | "BROUILLON_INTERNE"
                      | "EN_REVUE"
                      | "VALIDE_CLIENT"
                  )
                }
                className="rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
              >
                <option value="BROUILLON_INTERNE">Brouillon Interne</option>
                <option value="EN_REVUE">En Revue</option>
                <option value="VALIDE_CLIENT">Validé Client</option>
              </select>
            )}

            <button
              type="button"
              disabled={publishingExt || !projectId}
              onClick={() => void handlePublishExt()}
              data-testid="publish-ext-btn"
              className="inline-flex items-center gap-2 rounded-lg bg-[#e11d48] px-4 py-2 text-xs font-semibold text-white hover:bg-[#ff2e58] disabled:opacity-50"
            >
              <ExternalLink className="h-4 w-4" />
              {publishingExt ? "Publication..." : "Publier vers [EXT]"}
            </button>
          </div>
        </div>

        {/* Status Bar */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {slidesFileId && (
            <span className="rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-1.5 font-mono text-slate-200">
              Slides généré (006.3) : {slidesFileId}
            </span>
          )}
          {publishedExtMessage && (
            <span
              data-testid="published-ext-status"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-3 py-1.5 font-semibold text-emerald-300"
            >
              <CheckCircle2 className="h-4 w-4" />
              {publishedExtMessage}
            </span>
          )}
        </div>

        {/* Generated Slide Deck Preview */}
        {generatedSlides.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {generatedSlides.map((slide) => (
              <div
                key={slide.objectId}
                className="rounded-xl border border-[#3A3566] bg-[#141031] p-4 space-y-1.5"
              >
                <div className="flex items-center justify-between text-[10px] font-mono text-[#4C6CFF]">
                  <span>
                    Slide {slide.index} · {slide.type}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-white">{slide.title}</h3>
                {slide.subtitle && (
                  <p className="text-[11px] font-semibold text-[#EFF85D]">
                    {slide.subtitle}
                  </p>
                )}
                <p className="text-xs leading-relaxed text-slate-300">
                  {slide.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
