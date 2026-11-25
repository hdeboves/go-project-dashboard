import type { DriveNode, PrismaClient, Project, SyncStatus } from "@prisma/client";
import { getSyncPolicy } from "@/lib/drive/sync-policy";
import { computeDrift } from "@/lib/drive/sync-service";
import { PILOT_SANDBOX_CONFIG, slugifySegment } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import { PROD_IMMUTABLE_IDS } from "@/lib/google/sandbox-guard";
import type { DrivePort } from "@/lib/ports";

export const REPORTING_TABS = [
  "Synthèse Fortnite",
  "Influence par Talent",
  "Cumulé Réseaux",
  "Verbatims",
] as const;

export type ReportingTab = (typeof REPORTING_TABS)[number];

export const INFLUENCE_PLATFORMS = [
  "TIKTOK",
  "YOUTUBE_SHORTS",
  "INSTAGRAM",
  "SNAPCHAT",
] as const;

export type InfluencePlatform = (typeof INFLUENCE_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<InfluencePlatform, string> = {
  TIKTOK: "TikTok",
  YOUTUBE_SHORTS: "YouTube Shorts",
  INSTAGRAM: "Instagram",
  SNAPCHAT: "Snapchat",
};

export const PLATFORM_FOLDER_ALIASES: Record<
  InfluencePlatform,
  readonly string[]
> = {
  TIKTOK: ["TikTok", "TIKTOK", "tiktok"],
  YOUTUBE_SHORTS: [
    "YouTube Shorts",
    "YouTube",
    "YOUTUBE",
    "youtube_shorts",
    "youtube",
  ],
  INSTAGRAM: ["Instagram", "INSTA", "instagram", "insta"],
  SNAPCHAT: ["Snapchat", "SNAP", "snapchat", "snap"],
};

export const SLIDES_DIMENSIONS_EMU = {
  width: 9144000,
  height: 5143500,
} as const;

export interface BrandKit {
  templateVariant: "GO_CAISSE_EPARGNE" | "GO_CLASSIC";
  client?: string;
  pageSizeEmu: { width: number; height: number };
  layoutObjectId: string;
  primaryColor: string;
  accentColor: string;
  secondaryColor: string;
  fontFamily: string;
  colors: {
    background: string;
    cardBg: string;
    cardBorder: string;
    leftStripe: string;
    accentPrimary: string;
    accentSecondary: string;
    textPrimary: string;
    textMuted: string;
  };
  fonts: {
    display: string;
    body: string;
    icons: string;
  };
  chartPalette: string[];
  verbatimSubtitle: string;
}

export const DEFAULT_BRAND_KIT: BrandKit = {
  templateVariant: "GO_CAISSE_EPARGNE",
  pageSizeEmu: { ...SLIDES_DIMENSIONS_EMU },
  layoutObjectId: "h46f1a6b4d8dce21b_4_4343",
  primaryColor: "#2543BD",
  accentColor: "#EFF85D",
  secondaryColor: "#141031",
  fontFamily: "Rethink Sans",
  colors: {
    background: "#141031",
    cardBg: "#1E1A3F",
    cardBorder: "#3A3566",
    leftStripe: "#2543BD",
    accentPrimary: "#EFF85D",
    accentSecondary: "#4C6CFF",
    textPrimary: "#FFFFFF",
    textMuted: "#CBD5E1",
  },
  fonts: {
    display: "Rethink Sans",
    body: "Rethink Sans",
    icons: "Material Icons",
  },
  chartPalette: ["#EFF85D", "#4C6CFF", "#2543BD", "#FFAB40", "#0097A7"],
  verbatimSubtitle: "La communauté réagit à l'opération",
};

export function parseBrandKit(
  brandKitJson: string | null | undefined,
  override?: Partial<BrandKit>
): BrandKit {
  let raw: Record<string, unknown> = {};
  if (brandKitJson) {
    try {
      const parsed = JSON.parse(brandKitJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>;
      }
    } catch {
      raw = {};
    }
  }

  const rawColors =
    raw.colors && typeof raw.colors === "object" && !Array.isArray(raw.colors)
      ? (raw.colors as Record<string, unknown>)
      : {};
  const rawFonts =
    raw.fonts && typeof raw.fonts === "object" && !Array.isArray(raw.fonts)
      ? (raw.fonts as Record<string, unknown>)
      : {};

  const primaryColor =
    override?.primaryColor ??
    (typeof raw.primaryColor === "string"
      ? raw.primaryColor
      : DEFAULT_BRAND_KIT.primaryColor);
  const accentColor =
    override?.accentColor ??
    (typeof raw.accentColor === "string"
      ? raw.accentColor
      : DEFAULT_BRAND_KIT.accentColor);
  const secondaryColor =
    override?.secondaryColor ??
    (typeof raw.secondaryColor === "string"
      ? raw.secondaryColor
      : DEFAULT_BRAND_KIT.secondaryColor);
  const fontFamily =
    override?.fontFamily ??
    (typeof raw.fontFamily === "string"
      ? raw.fontFamily
      : DEFAULT_BRAND_KIT.fontFamily);

  return {
    ...DEFAULT_BRAND_KIT,
    ...(typeof raw.client === "string" ? { client: raw.client } : {}),
    ...(override?.templateVariant ? { templateVariant: override.templateVariant } : {}),
    primaryColor,
    accentColor,
    secondaryColor,
    fontFamily,
    colors: {
      background:
        override?.colors?.background ??
        (typeof rawColors.background === "string"
          ? rawColors.background
          : DEFAULT_BRAND_KIT.colors.background),
      cardBg:
        override?.colors?.cardBg ??
        (typeof rawColors.cardBg === "string"
          ? rawColors.cardBg
          : DEFAULT_BRAND_KIT.colors.cardBg),
      cardBorder:
        override?.colors?.cardBorder ??
        (typeof rawColors.cardBorder === "string"
          ? rawColors.cardBorder
          : DEFAULT_BRAND_KIT.colors.cardBorder),
      leftStripe:
        override?.colors?.leftStripe ??
        (typeof rawColors.leftStripe === "string"
          ? rawColors.leftStripe
          : primaryColor),
      accentPrimary:
        override?.colors?.accentPrimary ??
        (typeof rawColors.accentPrimary === "string"
          ? rawColors.accentPrimary
          : accentColor),
      accentSecondary:
        override?.colors?.accentSecondary ??
        (typeof rawColors.accentSecondary === "string"
          ? rawColors.accentSecondary
          : DEFAULT_BRAND_KIT.colors.accentSecondary),
      textPrimary:
        override?.colors?.textPrimary ??
        (typeof rawColors.textPrimary === "string"
          ? rawColors.textPrimary
          : DEFAULT_BRAND_KIT.colors.textPrimary),
      textMuted:
        override?.colors?.textMuted ??
        (typeof rawColors.textMuted === "string"
          ? rawColors.textMuted
          : DEFAULT_BRAND_KIT.colors.textMuted),
    },
    fonts: {
      display:
        override?.fonts?.display ??
        (typeof rawFonts.display === "string" ? rawFonts.display : fontFamily),
      body:
        override?.fonts?.body ??
        (typeof rawFonts.body === "string" ? rawFonts.body : fontFamily),
      icons:
        override?.fonts?.icons ??
        (typeof rawFonts.icons === "string"
          ? rawFonts.icons
          : DEFAULT_BRAND_KIT.fonts.icons),
    },
  };
}

export function parseTalentsJson(talentsJson: string | null | undefined): string[] {
  if (!talentsJson) return [];
  try {
    const parsed = JSON.parse(talentsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim());
  } catch {
    return [];
  }
}

export function computeEngagementRate(metrics: {
  views: number | null | undefined;
  likes?: number | null | undefined;
  comments?: number | null | undefined;
  shares?: number | null | undefined;
  reposts?: number | null | undefined;
  saves?: number | null | undefined;
}): number {
  const views = metrics.views ?? 0;
  if (!Number.isFinite(views) || views <= 0) {
    return 0;
  }
  const totalActions =
    (metrics.likes ?? 0) +
    (metrics.comments ?? 0) +
    (metrics.shares ?? 0) +
    (metrics.reposts ?? 0) +
    (metrics.saves ?? 0);
  const rate = (totalActions / views) * 100;
  return Number.isFinite(rate) ? Number(rate.toFixed(2)) : 0;
}

export function computeInteractions(metrics: {
  comments?: number | null | undefined;
  shares?: number | null | undefined;
  reposts?: number | null | undefined;
  saves?: number | null | undefined;
}): number {
  return (
    (metrics.comments ?? 0) +
    (metrics.shares ?? 0) +
    (metrics.reposts ?? 0) +
    (metrics.saves ?? 0)
  );
}

export function formatFrenchCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2).replace(".", ",")}M`;
  }
  if (Math.abs(value) >= 1_000) {
    const k = value / 1_000;
    const rounded = Number(k.toFixed(1));
    const str = Number.isInteger(rounded)
      ? String(rounded)
      : rounded.toFixed(1).replace(".", ",");
    return `${str}K`;
  }
  return String(Math.round(value));
}

export function formatFrenchInteger(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString("fr-FR");
}

export function normalizeInfluencePlatform(
  raw: string
): InfluencePlatform | null {
  const upper = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (upper === "TIKTOK" || upper === "TIK_TOK") return "TIKTOK";
  if (
    upper === "YOUTUBE_SHORTS" ||
    upper === "YOUTUBE" ||
    upper === "YT_SHORTS"
  ) {
    return "YOUTUBE_SHORTS";
  }
  if (upper === "INSTAGRAM" || upper === "INSTA") return "INSTAGRAM";
  if (upper === "SNAPCHAT" || upper === "SNAP") return "SNAPCHAT";
  return null;
}

export function getTalentPlatformDriveCode(
  talentName: string,
  platform: InfluencePlatform
): string {
  const talentSlug = slugifySegment(talentName);
  const platformSlug = slugifySegment(PLATFORM_LABELS[platform]);
  return `006.1.2.${talentSlug}.${platformSlug}`;
}

export async function findDriveNodeByCode(
  prisma: PrismaClient,
  projectId: string,
  code: string
): Promise<(DriveNode & { syncStatus: SyncStatus | null }) | null> {
  return prisma.driveNode.findFirst({
    where: { projectId, code },
    include: { syncStatus: true },
  });
}

export async function ensureReportingSheetInSandbox(
  prisma: PrismaClient,
  drive: DrivePort,
  project: Project
): Promise<{ reportingSheetId: string; node0062: DriveNode }> {
  const folder0062 = await prisma.driveNode.findFirst({
    where: { projectId: project.id, code: "006.2" },
  });

  if (
    project.reportingSheetId &&
    !PROD_IMMUTABLE_IDS.has(project.reportingSheetId)
  ) {
    const existingNode = await prisma.driveNode.findFirst({
      where: {
        projectId: project.id,
        OR: [
          { code: "006.2.sheet" },
          { driveFileId: project.reportingSheetId },
        ],
      },
    });
    if (existingNode) {
      return {
        reportingSheetId: project.reportingSheetId,
        node0062: existingNode,
      };
    }
    const createdNode = await prisma.driveNode.create({
      data: {
        projectId: project.id,
        code: "006.2.sheet",
        name: `[${project.codeProjet}] Reporting ${project.client} - ${project.nomJeu}`,
        driveFileId: project.reportingSheetId,
        parentNodeId: folder0062?.id ?? null,
        isFolder: false,
        mimeType: "application/vnd.google-apps.spreadsheet",
        isExtEligible: false,
      },
    });
    await prisma.syncStatus.upsert({
      where: { driveNodeId: createdNode.id },
      update: { allowPermanentExtSync: false },
      create: {
        projectId: project.id,
        driveNodeId: createdNode.id,
        validationStatus: "BROUILLON_INTERNE",
        driftDetected: false,
        allowPermanentExtSync: false,
      },
    });
    return {
      reportingSheetId: project.reportingSheetId,
      node0062: createdNode,
    };
  }

  const destinationParentId =
    folder0062?.driveFileId ?? project.driveInternalRootId;
  if (!destinationParentId) {
    throw new AppHttpError(
      400,
      "DRIVE_TREE_NOT_PROVISIONED",
      "L'arborescence Drive (006.2 Reporting Excel & Sheets) doit être provisionnée avant la consolidation."
    );
  }

  const copyName = `[${project.isSandbox ? "PILOTE " : ""}${project.codeProjet}] Reporting ${project.client} - ${project.nomJeu}`;
  const copied = await drive.copyFile({
    sourceFileId: PILOT_SANDBOX_CONFIG.prodTemplates.reportingSheetId,
    destinationParentId,
    name: copyName,
  });

  await prisma.project.update({
    where: { id: project.id },
    data: { reportingSheetId: copied.id },
  });

  const existingFileNode = await prisma.driveNode.findFirst({
    where: { projectId: project.id, code: "006.2.sheet" },
  });
  const node0062 = existingFileNode
    ? await prisma.driveNode.update({
        where: { id: existingFileNode.id },
        data: {
          name: copyName,
          driveFileId: copied.id,
          parentNodeId: folder0062?.id ?? null,
          isFolder: false,
          mimeType: "application/vnd.google-apps.spreadsheet",
          isExtEligible: false,
          internalModifiedAt: new Date(),
        },
      })
    : await prisma.driveNode.create({
        data: {
          projectId: project.id,
          code: "006.2.sheet",
          name: copyName,
          driveFileId: copied.id,
          parentNodeId: folder0062?.id ?? null,
          isFolder: false,
          mimeType: "application/vnd.google-apps.spreadsheet",
          isExtEligible: false,
          internalModifiedAt: new Date(),
        },
      });

  await prisma.syncStatus.upsert({
    where: { driveNodeId: node0062.id },
    update: { allowPermanentExtSync: false },
    create: {
      projectId: project.id,
      driveNodeId: node0062.id,
      validationStatus: "BROUILLON_INTERNE",
      driftDetected: false,
      allowPermanentExtSync: false,
    },
  });

  return { reportingSheetId: copied.id, node0062 };
}

export async function resolveOrCreateReportingDeckInSandbox(
  prisma: PrismaClient,
  drive: DrivePort,
  project: Project
): Promise<{
  slidesFileId: string;
  node0063: DriveNode & { syncStatus: SyncStatus | null };
}> {
  const folder0063 = await prisma.driveNode.findFirst({
    where: { projectId: project.id, code: "006.3" },
  });
  const destinationParentId =
    folder0063?.driveFileId ?? project.driveInternalRootId;
  if (!destinationParentId) {
    throw new AppHttpError(
      400,
      "DRIVE_TREE_NOT_PROVISIONED",
      "L'arborescence Drive (006.3 Reporting Client (Slides)) doit être provisionnée avant la génération."
    );
  }

  const templateSourceId =
    project.reportingTemplateSlidesId &&
    !PROD_IMMUTABLE_IDS.has(project.reportingTemplateSlidesId)
      ? project.reportingTemplateSlidesId
      : PILOT_SANDBOX_CONFIG.prodTemplates.reportingTemplateSlidesId;

  const datePrefix = new Date().toISOString().slice(0, 10);
  const deckName = `${datePrefix} - Reporting ${project.client} - ${project.nomJeu}`;

  const copied = await drive.copyFile({
    sourceFileId: templateSourceId,
    destinationParentId,
    name: deckName,
  });

  // Store clean template reference if not yet set
  if (!project.reportingTemplateSlidesId) {
    await prisma.project.update({
      where: { id: project.id },
      data: { reportingTemplateSlidesId: copied.id },
    });
  }

  const policy = getSyncPolicy("006.3.slides");
  const now = new Date();

  const existingNode = await prisma.driveNode.findFirst({
    where: { projectId: project.id, code: "006.3.slides" },
    include: { syncStatus: true },
  });

  // Preserve extMirrorFileId & SyncStatus.validationStatus across regenerations!
  const upsertedNode = existingNode
    ? await prisma.driveNode.update({
        where: { id: existingNode.id },
        data: {
          name: deckName,
          driveFileId: copied.id,
          parentNodeId: folder0063?.id ?? existingNode.parentNodeId,
          isFolder: false,
          mimeType: "application/vnd.google-apps.presentation",
          isExtEligible: policy.isExtEligible,
          internalModifiedAt: now,
        },
      })
    : await prisma.driveNode.create({
        data: {
          projectId: project.id,
          code: "006.3.slides",
          name: deckName,
          driveFileId: copied.id,
          parentNodeId: folder0063?.id ?? null,
          isFolder: false,
          mimeType: "application/vnd.google-apps.presentation",
          isExtEligible: policy.isExtEligible,
          internalModifiedAt: now,
        },
      });

  const existingValidationStatus =
    existingNode?.syncStatus?.validationStatus ?? "BROUILLON_INTERNE";
  const driftDetected = computeDrift(upsertedNode, {
    validationStatus: existingValidationStatus,
    allowPermanentExtSync: policy.allowPermanentExtSync,
  });

  const syncStatus = await prisma.syncStatus.upsert({
    where: { driveNodeId: upsertedNode.id },
    update: {
      allowPermanentExtSync: policy.allowPermanentExtSync,
      driftDetected,
    },
    create: {
      projectId: project.id,
      driveNodeId: upsertedNode.id,
      validationStatus: "BROUILLON_INTERNE",
      driftDetected,
      allowPermanentExtSync: policy.allowPermanentExtSync,
    },
  });

  return {
    slidesFileId: copied.id,
    node0063: { ...upsertedNode, syncStatus },
  };
}
