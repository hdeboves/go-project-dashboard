import type { PrismaClient } from "@prisma/client";
import { syncProjectToExternal } from "@/lib/drive/sync-service";
import { AppHttpError } from "@/lib/errors";
import type { GoogleWorkspacePort } from "@/lib/ports";
import {
  type ConsolidatedDataset,
  buildConsolidatedDataset,
} from "@/lib/reporting/consolidator";
import {
  type BrandKit,
  PLATFORM_LABELS,
  SLIDES_DIMENSIONS_EMU,
  formatFrenchCompactNumber,
  formatFrenchInteger,
  normalizeInfluencePlatform,
  parseBrandKit,
  parseTalentsJson,
  resolveOrCreateReportingDeckInSandbox,
} from "@/lib/reporting/types";

export interface GeneratedSlideSummary {
  index: number;
  objectId: string;
  type:
    | "COVER"
    | "DIVIDER"
    | "CHRONOLOGY"
    | "FORTNITE_KPI"
    | "TALENT"
    | "CUMULATIVE"
    | "VERBATIMS";
  title: string;
  subtitle?: string;
  content: string;
  kpis?: Record<string, number | string>;
  platforms?: Array<{
    platform: string;
    label: string;
    views: number;
    likes: number;
    interactions: number;
    engagementRate: number;
  }>;
  verbatims?: Array<{
    authorHandle: string;
    platform: string;
    talentName: string | null;
    quote: string;
    likesCount: number;
  }>;
}

interface SlideElementLike {
  objectId?: string;
  shape?: {
    text?: {
      textElements?: Array<{ textRun?: { content?: string } }>;
    };
  };
  sheetsChart?: {
    spreadsheetId?: string;
    chartId?: number;
    linkingMode?: string;
  };
  size?: Record<string, unknown>;
  transform?: Record<string, unknown>;
}

interface SlidePageLike {
  objectId?: string;
  pageElements?: SlideElementLike[];
}

function extractSlideText(slide: SlidePageLike): string {
  const parts: string[] = [];
  for (const el of slide.pageElements ?? []) {
    for (const te of el.shape?.text?.textElements ?? []) {
      if (te.textRun?.content) {
        parts.push(te.textRun.content);
      }
    }
  }
  return parts.join(" ").trim();
}

function collectPlaceholderTokens(presentation: Record<string, unknown>): string[] {
  const tokens = new Set<string>();
  const slides = Array.isArray(presentation.slides)
    ? (presentation.slides as SlidePageLike[])
    : [];
  for (const s of slides) {
    const text = extractSlideText(s);
    const matches = text.match(/\{\{[^}]+\}\}/g);
    if (matches) {
      for (const m of matches) tokens.add(m);
    }
  }
  return Array.from(tokens);
}

function buildSlidesPlan(
  dataset: ConsolidatedDataset,
  brandKit: BrandKit
): GeneratedSlideSummary[] {
  const { project, fortniteSummary, byTalent, byPlatform, totals, verbatims } =
    dataset;
  const talentByName = new Map(byTalent.map((t) => [t.talentName, t]));
  const configuredTalents = parseTalentsJson(project.talentsJson);
  const allTalents: string[] = [];
  for (const t of byTalent) {
    if (!allTalents.includes(t.talentName)) allTalents.push(t.talentName);
  }
  for (const name of configuredTalents) {
    if (!allTalents.includes(name)) allTalents.push(name);
  }

  const slides: GeneratedSlideSummary[] = [];
  let idx = 1;

  // 1. Couverture
  slides.push({
    index: idx++,
    objectId: "slide_cover",
    type: "COVER",
    title: `Couverture — REPORTING ${project.client}`,
    subtitle: `${project.nomJeu} · CP ${project.codeProjet}`,
    content: `REPORTING ${project.client} — ${project.nomJeu} (CP ${project.codeProjet})`,
  });

  // 2. Temps forts
  slides.push({
    index: idx++,
    objectId: "slide_highlights",
    type: "DIVIDER",
    title: "Temps forts",
    content: "Temps forts de l'opération",
  });

  // 3. Chronologie
  slides.push({
    index: idx++,
    objectId: "slide_chronology",
    type: "CHRONOLOGY",
    title: "Chronologie",
    subtitle: fortniteSummary.dateRangeLabel,
    content: `Chronologie de la campagne (${fortniteSummary.dateRangeLabel}) · ${fortniteSummary.totalDays} jours Fortnite suivis · ${totals.contentCount} contenus influence publiés`,
  });

  // 4. Expérience
  slides.push({
    index: idx++,
    objectId: "slide_experience",
    type: "DIVIDER",
    title: "Expérience",
    content: `Expérience ${project.nomJeu} — ${project.client}`,
  });

  // 5. Chiffres Fortnite
  slides.push({
    index: idx++,
    objectId: "slide_fortnite",
    type: "FORTNITE_KPI",
    title: "Chiffres Fortnite",
    subtitle: fortniteSummary.dateRangeLabel,
    content: [
      `${formatFrenchInteger(fortniteSummary.totalUniquePlayers)} (${fortniteSummary.totalUniquePlayers}) joueurs uniques`,
      `${formatFrenchInteger(fortniteSummary.totalSessions)} (${fortniteSummary.totalSessions}) sessions`,
      `${formatFrenchInteger(fortniteSummary.totalMinutesPlayed)} minutes jouées`,
      `${fortniteSummary.avgPlaytimeMinPerUser} min de jeu moyen par utilisateur`,
      `${fortniteSummary.maxPeakConcurrent} pic simultané max`,
      `${fortniteSummary.avgRetentionD1}% rétention J1 moyenne`,
    ].join(" · "),
    kpis: {
      totalUniquePlayers: fortniteSummary.totalUniquePlayers,
      totalSessions: fortniteSummary.totalSessions,
      totalMinutesPlayed: fortniteSummary.totalMinutesPlayed,
      avgPlaytimeSec: fortniteSummary.avgPlaytimeSec,
      avgRetentionD1: fortniteSummary.avgRetentionD1,
      maxPeakConcurrent: fortniteSummary.maxPeakConcurrent,
    },
  });

  // 6. Talents (0 slides if 0 talents; 1 slide per talent when talents exist)
  if (allTalents.length > 0) {
    slides.push({
      index: idx++,
      objectId: "slide_talents_divider",
      type: "DIVIDER",
      title: "Talents",
      content: `${allTalents.length} talent(s) activé(s)`,
    });

    for (const talentName of allTalents) {
      const agg = talentByName.get(talentName);
      const views = agg?.views ?? 0;
      const likes = agg?.likes ?? 0;
      const interactions = agg?.interactions ?? 0;
      const engagementRate = agg?.engagementRate ?? 0;
      const platLabels = (agg?.platforms ?? []).map((p) => PLATFORM_LABELS[p]);

      slides.push({
        index: idx++,
        objectId: `slide_talent_${idx}`,
        type: "TALENT",
        title: `Contenus - ${talentName}`,
        subtitle:
          platLabels.length > 0
            ? platLabels.join(" · ")
            : "Campagne Influence",
        content: [
          `${talentName}`,
          `${formatFrenchCompactNumber(views)} (${views}) vues`,
          `${formatFrenchCompactNumber(likes)} (${likes}) likes`,
          `${formatFrenchCompactNumber(interactions)} (${interactions}) interactions`,
          `${engagementRate}% engagement`,
        ].join(" · "),
        kpis: {
          views,
          likes,
          interactions,
          engagementRate,
          contentCount: agg?.contentCount ?? 0,
        },
      });
    }
  }

  // 7. Chiffres cumulés
  slides.push({
    index: idx++,
    objectId: "cumul_slide",
    type: "CUMULATIVE",
    title: "Chiffres cumulés",
    subtitle: `${allTalents.length} talents, ${totals.contentCount} contenus publiés`,
    content: [
      `${formatFrenchCompactNumber(totals.views)} (${totals.views}) vues cumulées`,
      `${formatFrenchCompactNumber(totals.likes)} (${totals.likes}) likes cumulés`,
      `${formatFrenchCompactNumber(totals.interactions)} (${totals.interactions}) interactions cumulées`,
      `Engagement moyen ${totals.engagementRate}%`,
      ...byPlatform.map(
        (p) =>
          `${p.label}: ${p.views} vues, ${p.likes} likes, ${p.interactions} interactions`
      ),
    ].join(" · "),
    kpis: {
      views: totals.views,
      likes: totals.likes,
      interactions: totals.interactions,
      engagementRate: totals.engagementRate,
      talentCount: allTalents.length,
      contentCount: totals.contentCount,
    },
    platforms: byPlatform.map((p) => ({
      platform: p.platform,
      label: p.label,
      views: p.views,
      likes: p.likes,
      interactions: p.interactions,
      engagementRate: p.engagementRate,
    })),
  });

  // 8. Ce que la communauté en dit (STRICTLY selectedForSlides === true)
  const selectedVerbatims = verbatims.filter((v) => v.selectedForSlides);
  const formattedVerbatims = selectedVerbatims.map((v) => {
    const plat = normalizeInfluencePlatform(v.platform);
    const trimmedQuote =
      v.quote.length > 280 ? `${v.quote.slice(0, 277)}...` : v.quote;
    return {
      authorHandle: v.authorHandle,
      platform: plat ? PLATFORM_LABELS[plat] : v.platform,
      talentName: v.talentName,
      quote: trimmedQuote,
      likesCount: v.likesCount,
    };
  });

  if (formattedVerbatims.length <= 6) {
    slides.push({
      index: idx++,
      objectId: "com_slide",
      type: "VERBATIMS",
      title: "Ce que la communauté en dit",
      subtitle: brandKit.verbatimSubtitle,
      content:
        formattedVerbatims.length > 0
          ? formattedVerbatims
              .map(
                (v) =>
                  `${v.authorHandle} (${v.platform}${v.talentName ? ` · ${v.talentName}` : ""}): "${v.quote}"`
              )
              .join(" | ")
          : "Aucun verbatim sélectionné pour le moment.",
      verbatims: formattedVerbatims,
    });
  } else {
    for (let start = 0; start < formattedVerbatims.length; start += 6) {
      const chunk = formattedVerbatims.slice(start, start + 6);
      slides.push({
        index: idx++,
        objectId: start === 0 ? "com_slide" : `com_slide_${Math.floor(start / 6) + 1}`,
        type: "VERBATIMS",
        title:
          start === 0
            ? "Ce que la communauté en dit"
            : `Ce que la communauté en dit (${Math.floor(start / 6) + 1})`,
        subtitle: brandKit.verbatimSubtitle,
        content: chunk
          .map(
            (v) =>
              `${v.authorHandle} (${v.platform}${v.talentName ? ` · ${v.talentName}` : ""}): "${v.quote}"`
          )
          .join(" | "),
        verbatims: chunk,
      });
    }
  }

  return slides;
}

export async function generateReportingSlides(
  prisma: PrismaClient,
  gateway: GoogleWorkspacePort,
  projectId: string,
  options?: {
    brandKitOverride?: Partial<BrandKit>;
    chartId?: number | null;
  }
): Promise<{
  ok: true;
  slidesFileId: string;
  driveFileId: string;
  nodeId: string;
  dimensionsEmu: { width: number; height: number };
  brandKit: BrandKit;
  slides: GeneratedSlideSummary[];
  excludedUnverifiedCount: number;
}> {
  const dataset = await buildConsolidatedDataset(prisma, projectId);
  const brandKit = parseBrandKit(
    dataset.project.brandKitJson,
    options?.brandKitOverride
  );

  const { slidesFileId, node0063 } =
    await resolveOrCreateReportingDeckInSandbox(
      prisma,
      gateway.drive,
      dataset.project
    );

  const presentation = await gateway.slides.getPresentation(slidesFileId);
  const existingSlides = Array.isArray(
    (presentation as { slides?: unknown[] }).slides
  )
    ? ((presentation as { slides?: SlidePageLike[] }).slides ?? [])
    : [];

  const slidePlan = buildSlidesPlan(dataset, brandKit);

  // Replace known tokens / leftover {{...}} placeholders on live presentations
  if (existingSlides.length > 0) {
    const tokensInTemplate = collectPlaceholderTokens(presentation);
    const tokenValues: Record<string, string> = {
      "{{CLIENT}}": dataset.project.client,
      "{{JEU}}": dataset.project.nomJeu,
      "{{CODE_PROJET}}": dataset.project.codeProjet,
      "{{PERIODE}}": dataset.fortniteSummary.dateRangeLabel,
      "{{JOUEURS_UNIQUES}}": formatFrenchCompactNumber(
        dataset.fortniteSummary.totalUniquePlayers
      ),
      "{{SESSIONS}}": formatFrenchCompactNumber(
        dataset.fortniteSummary.totalSessions
      ),
      "{{MINUTES_JOUEES}}": formatFrenchCompactNumber(
        dataset.fortniteSummary.totalMinutesPlayed
      ),
      "{{VUES_CUMULEES}}": formatFrenchCompactNumber(dataset.totals.views),
      "{{LIKES_CUMULES}}": formatFrenchCompactNumber(dataset.totals.likes),
      "{{INTERACTIONS_CUMULEES}}": formatFrenchCompactNumber(
        dataset.totals.interactions
      ),
    };

    const replacements: Array<{ token: string; value: string }> = [];
    for (const [token, value] of Object.entries(tokenValues)) {
      replacements.push({ token, value });
    }
    for (const leftover of tokensInTemplate) {
      if (!(leftover in tokenValues)) {
        replacements.push({ token: leftover, value: "" });
      }
    }

    await gateway.slides.replaceAllText({
      presentationId: slidesFileId,
      replacements,
    });

    // Embed Fortnite Sheet chart if available
    if (
      dataset.project.reportingSheetId &&
      typeof options?.chartId === "number"
    ) {
      const fortnitePage =
        existingSlides.find((s) =>
          /Chiffres/i.test(extractSlideText(s))
        ) ?? existingSlides[0];
      if (fortnitePage?.objectId) {
        await gateway.slides.embedSheetsChart({
          presentationId: slidesFileId,
          pageObjectId: fortnitePage.objectId,
          spreadsheetId: dataset.project.reportingSheetId,
          chartId: options.chartId,
          linkingMode: "LINKED",
          elementProperties: {
            size: {
              width: { magnitude: 3000000, unit: "EMU" },
              height: { magnitude: 1800000, unit: "EMU" },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: 5500000,
              translateY: 2800000,
              unit: "EMU",
            },
          },
        });
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "REPORTING_SLIDES_GENERATED",
      targetType: "REPORTING_SLIDES",
      targetId: slidesFileId,
      detailsJson: JSON.stringify({
        nodeId: node0063.id,
        slideCount: slidePlan.length,
        dimensionsEmu: SLIDES_DIMENSIONS_EMU,
        brandPalette: brandKit.colors,
        fontFamily: brandKit.fontFamily,
        talentsCount: dataset.byTalent.length,
        selectedVerbatimsCount: dataset.verbatims.filter(
          (v) => v.selectedForSlides
        ).length,
      }),
    },
  });

  return {
    ok: true,
    slidesFileId,
    driveFileId: slidesFileId,
    nodeId: node0063.id,
    dimensionsEmu: { ...SLIDES_DIMENSIONS_EMU },
    brandKit,
    slides: slidePlan,
    excludedUnverifiedCount: dataset.excludedUnverifiedCount,
  };
}

export async function publishReportingToExternal(
  prisma: PrismaClient,
  gateway: GoogleWorkspacePort,
  projectId: string,
  params: { confirmValidation?: boolean }
): Promise<{
  ok: true;
  extMirrorFileId: string;
  driveFileId: string;
  destinationFolderCode: "EXT.04";
  destinationFolderId: string | null;
  chartsLinkingMode: "NOT_LINKED_IMAGE";
  detachedChartsCount: number;
  method: string;
}> {
  if (params.confirmValidation !== true) {
    throw new AppHttpError(
      400,
      "CONFIRM_VALIDATION_REQUIRED",
      "Confirmation explicite requise (confirmValidation: true) pour publier vers [EXT]."
    );
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const node0063 = await prisma.driveNode.findFirst({
    where: {
      projectId,
      code: "006.3.slides",
      isFolder: false,
    },
    include: { syncStatus: true },
  });

  if (!node0063 || !node0063.driveFileId) {
    throw new AppHttpError(
      404,
      "REPORTING_SLIDES_MISSING",
      "Aucun deck Reporting (006.3) n'a encore été généré pour ce projet."
    );
  }

  if (node0063.syncStatus?.validationStatus !== "VALIDE_CLIENT") {
    throw new AppHttpError(
      403,
      "CLIENT_VALIDATION_REQUIRED",
      `Publication [EXT] bloquée : le document 006.3 doit avoir le statut "Validé Client" (statut actuel : ${node0063.syncStatus?.validationStatus ?? "BROUILLON_INTERNE"}).`
    );
  }

  // Ensure any LINKED Sheets charts on the deck are detached to NOT_LINKED_IMAGE before external delivery
  let detachedChartsCount = 0;
  const presentation = await gateway.slides.getPresentation(
    node0063.driveFileId
  );
  const slides = Array.isArray((presentation as { slides?: unknown[] }).slides)
    ? ((presentation as { slides?: SlidePageLike[] }).slides ?? [])
    : [];

  for (const slide of slides) {
    if (!slide.objectId) continue;
    for (const el of slide.pageElements ?? []) {
      if (
        el.objectId &&
        el.sheetsChart &&
        el.sheetsChart.linkingMode !== "NOT_LINKED_IMAGE" &&
        el.sheetsChart.spreadsheetId &&
        typeof el.sheetsChart.chartId === "number"
      ) {
        await gateway.slides.batchUpdate({
          presentationId: node0063.driveFileId,
          requests: [{ deleteObject: { objectId: el.objectId } }],
        });
        await gateway.slides.embedSheetsChart({
          presentationId: node0063.driveFileId,
          pageObjectId: slide.objectId,
          spreadsheetId: el.sheetsChart.spreadsheetId,
          chartId: el.sheetsChart.chartId,
          linkingMode: "NOT_LINKED_IMAGE",
          elementProperties: {
            ...(el.size ? { size: el.size } : {}),
            ...(el.transform ? { transform: el.transform } : {}),
          },
        });
        detachedChartsCount += 1;
      }
    }
  }

  const syncRes = await syncProjectToExternal(prisma, gateway.drive, projectId, {
    nodeIds: [node0063.id],
  });

  const synced = syncRes.syncedNodes[0];
  if (!synced) {
    throw new AppHttpError(
      500,
      "EXT_SYNC_EMPTY",
      "La synchronisation vers [EXT]/04. Reporting Final n'a produit aucun fichier."
    );
  }

  const ext04Folder = await prisma.driveNode.findFirst({
    where: { projectId, code: "EXT.04" },
  });

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "REPORTING_PUBLISHED_EXT",
      targetType: "EXT_REPORTING_FINAL",
      targetId: synced.extMirrorFileId,
      detailsJson: JSON.stringify({
        nodeId: node0063.id,
        slidesFileId: node0063.driveFileId,
        extMirrorFileId: synced.extMirrorFileId,
        method: synced.method,
        chartsLinkingMode: "NOT_LINKED_IMAGE",
        detachedChartsCount,
        destinationFolderCode: "EXT.04",
      }),
    },
  });

  return {
    ok: true,
    extMirrorFileId: synced.extMirrorFileId,
    driveFileId: synced.extMirrorFileId,
    destinationFolderCode: "EXT.04",
    destinationFolderId:
      ext04Folder?.driveFileId ?? project.driveExternalRootId ?? null,
    chartsLinkingMode: "NOT_LINKED_IMAGE",
    detachedChartsCount,
    method: synced.method,
  };
}
