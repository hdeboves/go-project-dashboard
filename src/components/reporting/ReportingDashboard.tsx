"use client";

import {
  AlertTriangle,
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

type StepTab = "fortnite" | "influence" | "consolidate" | "slides";

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
    // ignore
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

  const [stepTab, setStepTab] = useState<StepTab>("fortnite");
  const [shell, setShell] = useState<ShellStatus | null>(null);
  const [projectId, setProjectId] = useState<string | null>(queryProjectId);
  const [loading, setLoading] = useState(true);

  const [errorBanner, setErrorBanner] = useState<{
    kind: "setup" | "cp_conflict" | "error";
    text: string;
  } | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const [fortniteFile, setFortniteFile] = useState<File | null>(null);
  const [uploadingFortnite, setUploadingFortnite] = useState(false);
  const [fortniteRows, setFortniteRows] = useState<FortniteRow[]>([]);
  const [fortniteSummary, setFortniteSummary] =
    useState<FortniteSummary | null>(null);

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

  const [verbatims, setVerbatims] = useState<VerbatimItem[]>([]);
  const [verbHandle, setVerbHandle] = useState("");
  const [verbPlatform, setVerbPlatform] = useState<InfluencePlatform>("TIKTOK");
  const [verbTalent, setVerbTalent] = useState("");
  const [verbQuote, setVerbQuote] = useState("");
  const [verbLikes, setVerbLikes] = useState("0");
  const [verbSelected, setVerbSelected] = useState(true);
  const [addingVerbatim, setAddingVerbatim] = useState(false);

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
  const [unverifiedOnly, setUnverifiedOnly] = useState(false);
  const [projectBudgetSoldHt, setProjectBudgetSoldHt] = useState<number>(0);

  const handleApiFailure = useCallback(
    (status: number, json: { error?: string; code?: string }) => {
      if (status === 412) {
        setErrorBanner({
          kind: "setup",
          text:
            json.error ??
            "Connectez Google Workspace et l'assistant IA dans Paramètres.",
        });
        return;
      }
      if (status === 409 || json.code === "CP_CONFLICT") {
        setErrorBanner({
          kind: "cp_conflict",
          text:
            json.error ??
            "Document bloqué : appartient à un autre projet.",
        });
        return;
      }
      setErrorBanner({
        kind: "error",
        text: json.error ?? "Une erreur est survenue.",
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
          if (!resolvedId) resolvedId = shellJson.activeProjectId;
          if (shellJson.activeProject?.reportingSheetId && !reportingSheetId) {
            setReportingSheetId(shellJson.activeProject.reportingSheetId);
          }
        }
        setProjectId(resolvedId);
        if (!resolvedId) return;

        const [fortRes, infRes, verbRes, driveRes, budgetRes] =
          await Promise.all([
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
            fetch(`/api/projects/${resolvedId}/budget`, { cache: "no-store" }),
          ]);

        if (budgetRes.ok) {
          const bJson = (await budgetRes.json()) as {
            summary?: { soldTotalHt?: number };
          };
          setProjectBudgetSoldHt(bJson.summary?.soldTotalHt ?? 0);
        }

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
          for (const m of list) drafts[m.id] = metricToDraft(m);
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
            project?: { reportingSheetId?: string | null };
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
          if (found0063?.driveFileId) setSlidesFileId(found0063.driveFileId);
          if (
            found0063?.extMirrorFileId &&
            (found0063.syncStatus?.validationStatus === "VALIDE_CLIENT" ||
              found0063.validationStatus === "VALIDE_CLIENT")
          ) {
            setPublishedExtMessage("Publié dans l'espace client");
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
    return {
      views: byPlatformConsolidated.reduce((s, p) => s + p.views, 0),
      likes: byPlatformConsolidated.reduce((s, p) => s + p.likes, 0),
      interactions: byPlatformConsolidated.reduce(
        (s, p) => s + p.interactions,
        0
      ),
    };
  }, [byPlatformConsolidated]);

  async function handleFortniteUpload() {
    if (!projectId) return;
    if (!fortniteFile) {
      setErrorBanner({
        kind: "error",
        text: "Choisissez d'abord un fichier CSV ou Excel Fortnite.",
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
      setSuccessBanner(`${json.importedCount ?? 0} jour(s) Fortnite importé(s).`);
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
      setSuccessBanner("Aucune capture trouvée dans le dossier Drive Influence.");
    }
  }

  async function handleInfluenceUpload() {
    if (!projectId) return;
    const cleanTalent = infTalent.trim();
    if (!cleanTalent) {
      setErrorBanner({
        kind: "error",
        text: "Indiquez le nom du talent avant d'analyser.",
      });
      return;
    }
    if (!infFile && !infDriveFileId) {
      setErrorBanner({
        kind: "error",
        text: "Choisissez une capture image ou un fichier Drive.",
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
        `Capture lue pour ${cleanTalent}. Vérifiez les chiffres ci-dessous puis validez.`
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
      setSuccessBanner("Chiffres validés.");
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
        setVerbatims((prev) => [
          json.verbatim!,
          ...prev.filter((v) => v.id !== json.verbatim!.id),
        ]);
      }
      setVerbHandle("");
      setVerbQuote("");
      setVerbLikes("0");
      setSuccessBanner("Commentaire ajouté.");
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
      };
      if (!res.ok) {
        handleApiFailure(res.status, json);
        return;
      }
      if (json.reportingSheetId) setReportingSheetId(json.reportingSheetId);
      setSuccessBanner("Tableur Google Sheets mis à jour avec vos 4 onglets.");
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
        `Présentation générée (${json.slides?.length ?? 0} slides).`
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
    setSuccessBanner("Statut de validation mis à jour.");
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
      };
      if (!res.ok) {
        handleApiFailure(res.status, json);
        return;
      }
      setPublishedExtMessage("Publié dans l'espace client");
      setSuccessBanner("Reporting publié dans le dossier client.");
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

  const verifiedInfluenceCount = influenceMetrics.filter(
    (m) => m.verifiedByHuman
  ).length;

  const reportingSteps = [
    {
      id: "fortnite" as const,
      num: 1,
      label: "Stats Fortnite",
      done: fortniteRows.length > 0,
      meta:
        fortniteRows.length > 0
          ? `${fortniteRows.length} j. importés`
          : "CSV / Excel à importer",
    },
    {
      id: "influence" as const,
      num: 2,
      label: "Captures Influence",
      done:
        influenceMetrics.length > 0 &&
        verifiedInfluenceCount === influenceMetrics.length,
      meta:
        influenceMetrics.length > 0
          ? `${verifiedInfluenceCount}/${influenceMetrics.length} validées`
          : "0 capture",
    },
    {
      id: "consolidate" as const,
      num: 3,
      label: "Synthèse & Excel",
      done: Boolean(reportingSheetId),
      meta: reportingSheetId ? "4 onglets prêts" : "À consolider",
    },
    {
      id: "slides" as const,
      num: 4,
      label: "Slides Client",
      done: Boolean(publishedExtMessage || slidesFileId),
      meta: publishedExtMessage
        ? "Publié client"
        : slidesFileId
          ? "Slides prêtes"
          : "À générer",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Calm Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Reporting Bilan
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {shell?.activeProject
              ? `${shell.activeProject.client} — ${shell.activeProject.nomJeu} (CP ${shell.activeProject.codeProjet})`
              : "Sélectionnez un projet dans la barre latérale."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadAllData(projectId)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </div>

      {/* Executive Summary Strip (Vues, Joueurs, Engagement pondéré, CPV) */}
      <section className="grid grid-cols-2 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:grid-cols-4 lg:divide-x lg:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#111827]">
        <div className="px-4 py-3.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Vues Influence validées
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-white">
            {formatFrenchInteger(cumulativeTotals.views)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {verifiedInfluenceCount}/{influenceMetrics.length} captures validées
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Joueurs uniques Fortnite
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-white">
            {formatFrenchInteger(fortniteSummary?.totalUniquePlayers ?? 0)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {fortniteRows.length} jour(s) importé(s)
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Engagement pondéré
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-indigo-600 dark:text-indigo-400">
            {cumulativeTotals.views > 0
              ? `${computeEngagementRate({
                  views: cumulativeTotals.views,
                  likes: cumulativeTotals.likes,
                  comments: cumulativeTotals.interactions,
                  shares: 0,
                  reposts: 0,
                  saves: 0,
                }) ?? 0}%`
              : "—"}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {formatFrenchInteger(
              cumulativeTotals.likes + cumulativeTotals.interactions
            )}{" "}
            interactions totales
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            CPV / Coût joueur (ROI)
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {projectBudgetSoldHt > 0 && cumulativeTotals.views > 0
              ? `${(projectBudgetSoldHt / cumulativeTotals.views).toFixed(3)} €`
              : projectBudgetSoldHt > 0 &&
                  (fortniteSummary?.totalUniquePlayers ?? 0) > 0
                ? `${(projectBudgetSoldHt / (fortniteSummary?.totalUniquePlayers ?? 1)).toFixed(2)} €`
                : "—"}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {projectBudgetSoldHt > 0
              ? `Base vendue ${formatFrenchInteger(Math.round(projectBudgetSoldHt))} € HT`
              : "Budget projet non importé"}
          </p>
        </div>
      </section>

      {/* Smart 4-Step Progress Stepper */}
      <nav
        aria-label="Étapes du reporting"
        className="grid grid-cols-2 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:grid-cols-4 lg:divide-x lg:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#111827]"
      >
        {reportingSteps.map((step) => {
          const active = stepTab === step.id;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => setStepTab(step.id)}
              className={`relative flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                active
                  ? "bg-indigo-50/40 dark:bg-indigo-500/10"
                  : "hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  step.done
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                    : active
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                }`}
              >
                {step.done ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  step.num
                )}
              </span>
              <div className="min-w-0">
                <p
                  className={`truncate text-xs font-semibold ${
                    active
                      ? "text-indigo-700 dark:text-indigo-300"
                      : "text-slate-800 dark:text-slate-100"
                  }`}
                >
                  {step.label}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {step.meta}
                </p>
              </div>
              {active && (
                <span className="absolute right-0 bottom-0 left-0 h-0.5 bg-indigo-600 dark:bg-indigo-400" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Alerts */}
      {showSetupWarning && (
        <div
          role="alert"
          data-testid="setup-required-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-200"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span>
              {errorBanner?.kind === "setup"
                ? errorBanner.text
                : "Connectez Google Workspace et l'assistant IA dans Paramètres."}
            </span>
          </div>
          <Link
            href="/settings"
            className="rounded-xl bg-indigo-600 px-3.5 py-1.5 font-semibold text-white hover:bg-indigo-700"
          >
            Paramètres
          </Link>
        </div>
      )}

      {errorBanner && errorBanner.kind !== "setup" && (
        <div
          role="alert"
          data-testid={
            errorBanner.kind === "cp_conflict"
              ? "cp-conflict-banner"
              : "error-banner"
          }
          className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
        >
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <span>{errorBanner.text}</span>
        </div>
      )}

      {successBanner && (
        <div
          role="status"
          data-testid="reporting-success-banner"
          className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{successBanner}</span>
        </div>
      )}

      {/* STEP 1: FORTNITE */}
      {stepTab === "fortnite" && (
        <section className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800/80">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Statistiques Portail Créateur Fortnite
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Importez votre fichier CSV ou Excel (.xlsx) Epic Games.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                type="file"
                accept=".csv,.xlsx"
                data-testid="fortnite-file-input"
                onChange={(e) => setFortniteFile(e.target.files?.[0] ?? null)}
                className="block text-xs text-slate-600 file:mr-3 file:rounded-xl file:border file:border-slate-200 file:bg-slate-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-100 dark:text-slate-300 dark:file:border-slate-700 dark:file:bg-slate-800 dark:file:text-slate-200 dark:hover:file:bg-slate-700"
              />
              <button
                type="button"
                disabled={uploadingFortnite || !projectId}
                onClick={() => void handleFortniteUpload()}
                data-testid="fortnite-import-btn"
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {uploadingFortnite ? "Import..." : "Importer"}
              </button>
            </div>
          </div>

          <div className="grid divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/40 sm:grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-800/30">
            {[
              {
                label: "Joueurs uniques",
                value: formatFrenchInteger(
                  fortniteSummary?.totalUniquePlayers ?? 0
                ),
              },
              {
                label: "Sessions",
                value: formatFrenchInteger(fortniteSummary?.totalSessions ?? 0),
              },
              {
                label: "Temps moyen",
                value: `${formatFrenchInteger(fortniteSummary?.avgPlaytimeSec ?? 0)} s`,
              },
              {
                label: "Rétention J1",
                value: `${fortniteSummary?.avgRetentionD1 ?? 0}%`,
              },
              {
                label: "Pic simultané",
                value: formatFrenchInteger(
                  fortniteSummary?.maxPeakConcurrent ?? 0
                ),
              },
            ].map((kpi) => (
              <div key={kpi.label} className="px-4 py-3.5">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {kpi.label}
                </p>
                <p className="mt-1 font-mono text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {kpi.value}
                </p>
              </div>
            ))}
          </div>

          {fortniteRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className="px-3.5 py-2.5">Date</th>
                    <th className="px-3.5 py-2.5">Joueurs uniques</th>
                    <th className="px-3.5 py-2.5">Sessions</th>
                    <th className="px-3.5 py-2.5">Temps moyen (s)</th>
                    <th className="px-3.5 py-2.5">Rétention J1</th>
                    <th className="px-3.5 py-2.5">Pic simultané</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800/80 dark:bg-[#111827]">
                  {fortniteRows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3.5 py-2 font-mono text-slate-700 dark:text-slate-200">
                        {r.date}
                      </td>
                      <td className="px-3.5 py-2 font-mono">
                        {formatFrenchInteger(r.uniquePlayers)}
                      </td>
                      <td className="px-3.5 py-2 font-mono">
                        {formatFrenchInteger(r.sessions)}
                      </td>
                      <td className="px-3.5 py-2 font-mono">
                        {r.avgPlaytimeSec}
                      </td>
                      <td className="px-3.5 py-2 font-mono">
                        {r.retentionD1 !== null ? `${r.retentionD1}%` : "—"}
                      </td>
                      <td className="px-3.5 py-2 font-mono">
                        {formatFrenchInteger(r.peakConcurrent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* STEP 2: INFLUENCE */}
      {stepTab === "influence" && (
        <section className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800/80">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Captures WhatsApp Influence
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                L&apos;IA lit automatiquement les vues, likes et partages — vous
                validez côte à côte.
              </p>
            </div>
            <button
              type="button"
              disabled={!projectId}
              onClick={() => void handleLoadDriveCandidates()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
            >
              <FolderSearch className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              Importer depuis Drive
            </button>
          </div>

          <div className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-6 dark:bg-slate-800/60">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Talent
              </label>
              <input
                type="text"
                list="talents-datalist"
                value={infTalent}
                onChange={(e) => setInfTalent(e.target.value)}
                placeholder="ex : Kalut"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
              <datalist id="talents-datalist">
                {talents.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Réseau
              </label>
              <select
                value={infPlatform}
                onChange={(e) =>
                  setInfPlatform(e.target.value as InfluencePlatform)
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              >
                {INFLUENCE_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Lien vidéo
              </label>
              <input
                type="text"
                value={infContentUrl}
                onChange={(e) => setInfContentUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Code Spark Ads
              </label>
              <input
                type="text"
                value={infSparkCode}
                onChange={(e) => setInfSparkCode(e.target.value)}
                placeholder="Optionnel"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
            </div>

            <div className="flex flex-col justify-end gap-2 md:col-span-2">
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                data-testid="influence-file-input"
                onChange={(e) => {
                  setInfFile(e.target.files?.[0] ?? null);
                  setInfDriveFileId("");
                }}
                className="block text-xs text-slate-600 file:mr-2 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-2.5 py-1 file:text-xs dark:text-slate-300"
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
                    if (chosen?.platformHint)
                      setInfPlatform(chosen.platformHint);
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-100"
                >
                  <option value="">— Ou choisir depuis Drive —</option>
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
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {uploadingInfluence ? "Lecture..." : "Lire la capture"}
              </button>
            </div>
          </div>

          {influenceMetrics.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Aucune capture ajoutée pour le moment.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {verifiedInfluenceCount}/{influenceMetrics.length} capture(s)
                  validée(s)
                </p>
                <button
                  type="button"
                  onClick={() => setUnverifiedOnly((v) => !v)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                    unverifiedOnly
                      ? "bg-rose-50 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  À vérifier uniquement (
                  {influenceMetrics.length - verifiedInfluenceCount})
                </button>
              </div>
              {influenceMetrics
                .filter((m) => !unverifiedOnly || !m.verifiedByHuman)
                .map((m) => {
                const draft = metricDrafts[m.id] ?? metricToDraft(m);
                const confidenceMap = parseConfidenceMap(m.confidenceJson);
                const previewSrc =
                  m.rawFileId && projectId
                    ? `/api/projects/${projectId}/reporting/preview/${m.rawFileId}`
                    : null;
                const platLabel =
                  PLATFORM_LABELS[m.platform as InfluencePlatform] ??
                  m.platform;

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
                  { key: "comments", label: "Comms" },
                  { key: "shares", label: "Partages" },
                  { key: "reposts", label: "Reposts" },
                  { key: "saves", label: "Enreg." },
                ];

                return (
                  <div
                    key={m.id}
                    data-testid={`influence-card-${m.id}`}
                    className="grid gap-5 rounded-2xl border border-slate-200 bg-slate-50/40 p-4 lg:grid-cols-12 dark:border-slate-800 dark:bg-slate-800/60"
                  >
                    <div
                      data-testid="influence-preview-pane"
                      className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-3 lg:col-span-4 dark:border-slate-800 dark:bg-[#111827]"
                    >
                      {previewSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          data-testid="influence-screenshot-preview"
                          src={previewSrc}
                          alt={`Capture ${m.talentName}`}
                          className="max-h-64 w-auto rounded object-contain"
                        />
                      ) : (
                        <div className="py-10 text-xs text-slate-400">
                          Aperçu indisponible
                        </div>
                      )}
                    </div>

                    <div className="space-y-4 lg:col-span-8">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900 dark:text-white">
                            {m.talentName}
                          </span>
                          <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-200">
                            {platLabel}
                          </span>
                          {m.verifiedByHuman ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" />
                              Validé
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                              À vérifier
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                          <span>
                            Interactions :{" "}
                            <strong>
                              {formatFrenchInteger(previewInteractions)}
                            </strong>
                          </span>
                          <span>
                            Engagement : <strong>{previewEng}%</strong>
                          </span>
                        </div>
                      </div>

                      <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                        {numericFields.map(({ key, label }) => {
                          const conf = confidenceMap[key];
                          const isLow = typeof conf === "number" && conf < 0.8;
                          return (
                            <div key={key}>
                              <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                                {label}
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
                                className={`w-full rounded-xl border bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:outline-none dark:bg-[#111827] dark:text-white ${
                                  isLow
                                    ? "border-rose-400 dark:border-rose-500"
                                    : "border-slate-200 focus:border-indigo-500 dark:border-slate-700"
                                }`}
                              />
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={savingMetricId === m.id}
                          onClick={() => void handleSaveMetric(m.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {savingMetricId === m.id
                            ? "Enregistrement..."
                            : "Valider ces chiffres"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* STEP 3: CONSOLIDATION & EXCEL */}
      {stepTab === "consolidate" && (
        <section className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800/80">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Synthèse consolidée & Export Excel
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Toutes vos données validées réunies dans un classeur à 4
                onglets.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={consolidating || !projectId}
                onClick={() => void handleConsolidate()}
                data-testid="consolidate-sheets-btn"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                {consolidating ? "Mise à jour..." : "Envoyer vers Google Sheets"}
              </button>

              {projectId && (
                <a
                  href={`/api/projects/${projectId}/reporting/export-xlsx`}
                  download={`reporting_${shell?.activeProject?.codeProjet ?? projectId}.xlsx`}
                  data-testid="export-xlsx-link"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  <Download className="h-4 w-4" />
                  Télécharger Excel
                </a>
              )}
            </div>
          </div>

          {reportingSheetId && (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5 text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
              <span className="inline-flex items-center gap-2 font-medium">
                <Layers className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Tableur Google Sheets lié
              </span>
              <a
                href={`https://docs.google.com/spreadsheets/d/${reportingSheetId}/edit`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
              >
                Ouvrir le Google Sheet
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {/* 4 Sub-tabs */}
          <div className="flex flex-wrap gap-1.5">
            {REPORTING_TABS.map((tabName) => (
              <button
                key={tabName}
                type="button"
                onClick={() => setActiveTab(tabName)}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === tabName
                    ? "bg-slate-900 text-white dark:bg-indigo-600"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {tabName}
              </button>
            ))}
          </div>

          {activeTab === "Synthèse Fortnite" && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className="px-3.5 py-2">Date</th>
                    <th className="px-3.5 py-2">Joueurs</th>
                    <th className="px-3.5 py-2">Sessions</th>
                    <th className="px-3.5 py-2">Temps moyen (s)</th>
                    <th className="px-3.5 py-2">Rétention J1</th>
                    <th className="px-3.5 py-2">Pic simultané</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800/80 dark:bg-[#111827]">
                  {fortniteRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-center text-slate-400"
                      >
                        Aucune donnée Fortnite importée.
                      </td>
                    </tr>
                  ) : (
                    fortniteRows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3.5 py-2 font-mono">{r.date}</td>
                        <td className="px-3.5 py-2 font-mono">
                          {formatFrenchInteger(r.uniquePlayers)}
                        </td>
                        <td className="px-3.5 py-2 font-mono">
                          {formatFrenchInteger(r.sessions)}
                        </td>
                        <td className="px-3.5 py-2 font-mono">
                          {r.avgPlaytimeSec}
                        </td>
                        <td className="px-3.5 py-2 font-mono">
                          {r.retentionD1 ?? "—"}
                        </td>
                        <td className="px-3.5 py-2 font-mono">
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
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className="px-3.5 py-2">Talent</th>
                    <th className="px-3.5 py-2">Contenus</th>
                    <th className="px-3.5 py-2">Vues</th>
                    <th className="px-3.5 py-2">Likes</th>
                    <th className="px-3.5 py-2">Interactions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800/80 dark:bg-[#111827]">
                  {byTalentConsolidated.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-slate-400"
                      >
                        Validez vos captures Influence à l&apos;étape 2 pour les
                        voir apparaître ici.
                      </td>
                    </tr>
                  ) : (
                    byTalentConsolidated.map((t) => (
                      <tr key={t.talentName}>
                        <td className="px-3.5 py-2 font-semibold text-slate-900 dark:text-white">
                          {t.talentName}
                        </td>
                        <td className="px-3.5 py-2 font-mono">{t.count}</td>
                        <td className="px-3.5 py-2 font-mono">
                          {formatFrenchInteger(t.views)}
                        </td>
                        <td className="px-3.5 py-2 font-mono">
                          {formatFrenchInteger(t.likes)}
                        </td>
                        <td className="px-3.5 py-2 font-mono">
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
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className="px-3.5 py-2">Réseau</th>
                    <th className="px-3.5 py-2">Contenus</th>
                    <th className="px-3.5 py-2">Vues</th>
                    <th className="px-3.5 py-2">Likes</th>
                    <th className="px-3.5 py-2">Interactions</th>
                    <th className="px-3.5 py-2">Engagement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800/80 dark:bg-[#111827]">
                  {byPlatformConsolidated.map((p) => (
                    <tr key={p.platform}>
                      <td className="px-3.5 py-2 font-semibold text-slate-900 dark:text-white">
                        {p.label}
                      </td>
                      <td className="px-3.5 py-2 font-mono">{p.count}</td>
                      <td className="px-3.5 py-2 font-mono">
                        {formatFrenchInteger(p.views)}
                      </td>
                      <td className="px-3.5 py-2 font-mono">
                        {formatFrenchInteger(p.likes)}
                      </td>
                      <td className="px-3.5 py-2 font-mono">
                        {formatFrenchInteger(p.interactions)}
                      </td>
                      <td className="px-3.5 py-2 font-mono">
                        {p.engagementRate}%
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold text-slate-900 dark:bg-slate-800/60 dark:text-white">
                    <td className="px-3.5 py-2">Total</td>
                    <td className="px-3.5 py-2 font-mono">
                      {verifiedMetrics.length}
                    </td>
                    <td className="px-3.5 py-2 font-mono">
                      {formatFrenchInteger(cumulativeTotals.views)}
                    </td>
                    <td className="px-3.5 py-2 font-mono">
                      {formatFrenchInteger(cumulativeTotals.likes)}
                    </td>
                    <td className="px-3.5 py-2 font-mono">
                      {formatFrenchInteger(cumulativeTotals.interactions)}
                    </td>
                    <td className="px-3.5 py-2 font-mono">
                      {cumulativeTotals.views > 0
                        ? `${computeEngagementRate({
                            views: cumulativeTotals.views,
                            likes: cumulativeTotals.likes,
                            comments: cumulativeTotals.interactions,
                            shares: 0,
                            reposts: 0,
                            saves: 0,
                          }) ?? 0}%`
                        : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "Verbatims" && (
            <div className="space-y-4">
              <div className="grid gap-2.5 rounded-xl bg-slate-50 p-4 md:grid-cols-6 dark:bg-slate-800/60">
                <input
                  type="text"
                  value={verbHandle}
                  onChange={(e) => setVerbHandle(e.target.value)}
                  placeholder="@auteur"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-[#111827] dark:text-white"
                />
                <select
                  value={verbPlatform}
                  onChange={(e) =>
                    setVerbPlatform(e.target.value as InfluencePlatform)
                  }
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-[#111827] dark:text-white"
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
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-[#111827] dark:text-white"
                />
                <input
                  type="text"
                  value={verbQuote}
                  onChange={(e) => setVerbQuote(e.target.value)}
                  placeholder="Commentaire positif de la communauté..."
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 md:col-span-2 dark:border-slate-800 dark:bg-[#111827] dark:text-white"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={verbLikes}
                    onChange={(e) => setVerbLikes(e.target.value)}
                    className="w-16 rounded-xl border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-800 dark:bg-[#111827] dark:text-white"
                  />
                  <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={verbSelected}
                      onChange={(e) => setVerbSelected(e.target.checked)}
                      className="accent-rose-600"
                    />
                    Slides
                  </label>
                  <button
                    type="button"
                    disabled={addingVerbatim || !projectId}
                    onClick={() => void handleAddVerbatim()}
                    className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                  >
                    Ajouter
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800/80 dark:border-slate-800">
                {verbatims.length === 0 ? (
                  <p className="p-6 text-center text-xs text-slate-400">
                    Aucun commentaire enregistré.
                  </p>
                ) : (
                  verbatims.map((v) => (
                    <div
                      key={v.id}
                      className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 text-xs dark:bg-[#111827]"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <MessageSquareQuote className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {v.authorHandle}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {PLATFORM_LABELS[v.platform as InfluencePlatform] ??
                              v.platform}
                            {v.talentName ? ` · ${v.talentName}` : ""}
                          </span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-200">« {v.quote} »</p>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={v.selectedForSlides}
                          onChange={() => void handleToggleVerbatim(v)}
                          className="accent-rose-600"
                        />
                        Inclure dans Slides
                      </label>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* STEP 4: SLIDES & PUBLISH */}
      {stepTab === "slides" && (
        <section className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800/80">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Présentation Google Slides & Publication Client
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Générez la présentation chartée puis publiez-la dans
                l&apos;espace client une fois relue.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={generatingSlides || !projectId}
                onClick={() => void handleGenerateSlides()}
                data-testid="generate-slides-btn"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
              >
                <Presentation className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                {generatingSlides ? "Création..." : "Générer les Slides"}
              </button>

              {node0063 && (
                <select
                  name="validationStatus"
                  data-testid="reporting-validation-select"
                  aria-label="Statut de validation du reporting"
                  value={currentValidationStatus}
                  onChange={(e) =>
                    void handleValidationStatusChange(
                      e.target.value as
                        | "BROUILLON_INTERNE"
                        | "EN_REVUE"
                        | "VALIDE_CLIENT"
                    )
                  }
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200"
                >
                  <option value="BROUILLON_INTERNE">Brouillon interne</option>
                  <option value="EN_REVUE">En relecture</option>
                  <option value="VALIDE_CLIENT">Validé client</option>
                </select>
              )}

              <button
                type="button"
                disabled={
                  publishingExt ||
                  !projectId ||
                  !slidesFileId ||
                  currentValidationStatus !== "VALIDE_CLIENT"
                }
                title={
                  !slidesFileId
                    ? "Générez d'abord les Slides avant de publier"
                    : currentValidationStatus !== "VALIDE_CLIENT"
                      ? "Passez le statut sur « Validé client » pour activer la publication"
                      : "Copier les Slides validées dans l'espace client"
                }
                onClick={() => void handlePublishExt()}
                data-testid="publish-ext-btn"
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ExternalLink className="h-4 w-4" />
                {publishingExt ? "Publication..." : "Publier pour le client"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            {slidesFileId && (
              <a
                href={`https://docs.google.com/presentation/d/${slidesFileId}/edit`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <Presentation className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                Ouvrir les Google Slides
                <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
              </a>
            )}
            {publishedExtMessage && (
              <span
                data-testid="published-ext-status"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3.5 py-2 font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              >
                <CheckCircle2 className="h-4 w-4" />
                {publishedExtMessage}
              </span>
            )}
          </div>

          {generatedSlides.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {generatedSlides.map((slide) => (
                <div
                  key={slide.objectId}
                  className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/60"
                >
                  <span className="text-[10px] font-semibold text-indigo-600 uppercase dark:text-indigo-400">
                    Slide {slide.index}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {slide.title}
                  </h3>
                  {slide.subtitle && (
                    <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                      {slide.subtitle}
                    </p>
                  )}
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {slide.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
