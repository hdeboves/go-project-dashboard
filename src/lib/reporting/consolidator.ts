import type {
  FortniteMetric,
  InfluenceMetric,
  PrismaClient,
  Project,
  Verbatim,
} from "@prisma/client";
import ExcelJS from "exceljs";
import { AppHttpError } from "@/lib/errors";
import type { GoogleWorkspacePort } from "@/lib/ports";
import {
  type FortniteSummary,
  computeFortniteSummary,
} from "@/lib/reporting/fortnite-parser";
import {
  INFLUENCE_PLATFORMS,
  type InfluencePlatform,
  PLATFORM_LABELS,
  REPORTING_TABS,
  computeEngagementRate,
  computeInteractions,
  ensureReportingSheetInSandbox,
  normalizeInfluencePlatform,
} from "@/lib/reporting/types";

export interface TalentAggregate {
  talentName: string;
  contentCount: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  reposts: number;
  saves: number;
  interactions: number;
  engagementRate: number;
  platforms: InfluencePlatform[];
}

export interface PlatformAggregate {
  platform: InfluencePlatform;
  label: string;
  contentCount: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  reposts: number;
  saves: number;
  interactions: number;
  engagementRate: number;
}

export interface InfluenceTotals {
  contentCount: number;
  talentCount: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  reposts: number;
  saves: number;
  interactions: number;
  engagementRate: number;
}

export interface ConsolidatedDataset {
  project: Project;
  fortniteRows: FortniteMetric[];
  fortniteSummary: FortniteSummary;
  verifiedInfluence: InfluenceMetric[];
  excludedUnverifiedCount: number;
  byTalent: TalentAggregate[];
  byPlatform: PlatformAggregate[];
  totals: InfluenceTotals;
  verbatims: Verbatim[];
}

export async function buildConsolidatedDataset(
  prisma: PrismaClient,
  projectId: string
): Promise<ConsolidatedDataset> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const [fortniteRows, verifiedInfluence, excludedUnverifiedCount, verbatims] =
    await Promise.all([
      prisma.fortniteMetric.findMany({
        where: { projectId },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      }),
      prisma.influenceMetric.findMany({
        where: { projectId, verifiedByHuman: true },
        orderBy: [
          { talentName: "asc" },
          { platform: "asc" },
          { createdAt: "asc" },
        ],
      }),
      prisma.influenceMetric.count({
        where: { projectId, verifiedByHuman: false },
      }),
      prisma.verbatim.findMany({
        where: { projectId },
        orderBy: [
          { selectedForSlides: "desc" },
          { likesCount: "desc" },
          { createdAt: "asc" },
        ],
      }),
    ]);

  const fortniteSummary = computeFortniteSummary(fortniteRows);

  const talentMap = new Map<
    string,
    {
      talentName: string;
      contentCount: number;
      views: number;
      likes: number;
      comments: number;
      shares: number;
      reposts: number;
      saves: number;
      platforms: Set<InfluencePlatform>;
    }
  >();

  const platformMap = new Map<
    InfluencePlatform,
    {
      contentCount: number;
      views: number;
      likes: number;
      comments: number;
      shares: number;
      reposts: number;
      saves: number;
    }
  >();

  for (const p of INFLUENCE_PLATFORMS) {
    platformMap.set(p, {
      contentCount: 0,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      reposts: 0,
      saves: 0,
    });
  }

  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalReposts = 0;
  let totalSaves = 0;

  for (const m of verifiedInfluence) {
    const views = m.views ?? 0;
    const likes = m.likes ?? 0;
    const comments = m.comments ?? 0;
    const shares = m.shares ?? 0;
    const reposts = m.reposts ?? 0;
    const saves = m.saves ?? 0;
    const plat = normalizeInfluencePlatform(m.platform) ?? "TIKTOK";

    totalViews += views;
    totalLikes += likes;
    totalComments += comments;
    totalShares += shares;
    totalReposts += reposts;
    totalSaves += saves;

    const existingTalent = talentMap.get(m.talentName) ?? {
      talentName: m.talentName,
      contentCount: 0,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      reposts: 0,
      saves: 0,
      platforms: new Set<InfluencePlatform>(),
    };
    existingTalent.contentCount += 1;
    existingTalent.views += views;
    existingTalent.likes += likes;
    existingTalent.comments += comments;
    existingTalent.shares += shares;
    existingTalent.reposts += reposts;
    existingTalent.saves += saves;
    existingTalent.platforms.add(plat);
    talentMap.set(m.talentName, existingTalent);

    const platAgg = platformMap.get(plat)!;
    platAgg.contentCount += 1;
    platAgg.views += views;
    platAgg.likes += likes;
    platAgg.comments += comments;
    platAgg.shares += shares;
    platAgg.reposts += reposts;
    platAgg.saves += saves;
  }

  const byTalent: TalentAggregate[] = Array.from(talentMap.values()).map(
    (t) => ({
      talentName: t.talentName,
      contentCount: t.contentCount,
      views: t.views,
      likes: t.likes,
      comments: t.comments,
      shares: t.shares,
      reposts: t.reposts,
      saves: t.saves,
      interactions: computeInteractions(t),
      engagementRate: computeEngagementRate(t),
      platforms: Array.from(t.platforms),
    })
  );

  const byPlatform: PlatformAggregate[] = INFLUENCE_PLATFORMS.map((plat) => {
    const agg = platformMap.get(plat)!;
    return {
      platform: plat,
      label: PLATFORM_LABELS[plat],
      contentCount: agg.contentCount,
      views: agg.views,
      likes: agg.likes,
      comments: agg.comments,
      shares: agg.shares,
      reposts: agg.reposts,
      saves: agg.saves,
      interactions: computeInteractions(agg),
      engagementRate: computeEngagementRate(agg),
    };
  });

  const totals: InfluenceTotals = {
    contentCount: verifiedInfluence.length,
    talentCount: byTalent.length,
    views: totalViews,
    likes: totalLikes,
    comments: totalComments,
    shares: totalShares,
    reposts: totalReposts,
    saves: totalSaves,
    interactions: computeInteractions({
      comments: totalComments,
      shares: totalShares,
      reposts: totalReposts,
      saves: totalSaves,
    }),
    engagementRate: computeEngagementRate({
      views: totalViews,
      likes: totalLikes,
      comments: totalComments,
      shares: totalShares,
      reposts: totalReposts,
      saves: totalSaves,
    }),
  };

  return {
    project,
    fortniteRows,
    fortniteSummary,
    verifiedInfluence,
    excludedUnverifiedCount,
    byTalent,
    byPlatform,
    totals,
    verbatims,
  };
}

function buildSyntheseFortniteValues(
  dataset: ConsolidatedDataset,
  forGoogleSheets: boolean
): unknown[][] {
  const s = dataset.fortniteSummary;
  const rows: unknown[][] = [
    ["Synthèse Fortnite — Portail Créateur", `${dataset.project.client} — ${dataset.project.nomJeu} (CP ${dataset.project.codeProjet})`],
    ["Période", s.dateRangeLabel],
    ["Joueurs uniques totaux", s.totalUniquePlayers],
    ["Sessions totales", s.totalSessions],
    ["Minutes jouées estimées", s.totalMinutesPlayed],
    ["Temps moyen / session (sec)", s.avgPlaytimeSec],
    ["Temps moyen / utilisateur (min)", s.avgPlaytimeMinPerUser],
    ["Rétention J1 moyenne (%)", s.avgRetentionD1],
    ["Pic simultané max", s.maxPeakConcurrent],
    [],
    [
      "Date",
      "Joueurs uniques",
      "Sessions",
      "Temps moyen (sec)",
      "Temps moyen (min)",
      "Rétention J1 (%)",
      "Pic simultané",
      "Minutes jouées",
    ],
  ];

  const startRow = rows.length + 1;
  dataset.fortniteRows.forEach((r, idx) => {
    const sheetRow = startRow + idx;
    const avgMin = Number((r.avgPlaytimeSec / 60).toFixed(2));
    const minutesPlayed = Math.round((r.sessions * r.avgPlaytimeSec) / 60);
    rows.push([
      r.date,
      r.uniquePlayers,
      r.sessions,
      r.avgPlaytimeSec,
      forGoogleSheets ? `=ROUND(D${sheetRow}/60; 2)` : avgMin,
      r.retentionD1 ?? "",
      r.peakConcurrent,
      forGoogleSheets ? `=ROUND(C${sheetRow}*D${sheetRow}/60; 0)` : minutesPlayed,
    ]);
  });

  return rows;
}

function buildInfluenceParTalentValues(
  dataset: ConsolidatedDataset,
  forGoogleSheets: boolean
): unknown[][] {
  const rows: unknown[][] = [
    [
      "Talent",
      "Contenu",
      "Spark",
      "Vues",
      "Likes",
      "Coms",
      "Partages",
      "Repost",
      "Enregistrements",
      "Engagement",
      "Plateforme",
      "Date publication",
      "Interactions (hors Likes)",
    ],
  ];

  dataset.verifiedInfluence.forEach((m, idx) => {
    const r = idx + 2;
    const plat = normalizeInfluencePlatform(m.platform);
    const platLabel = plat ? PLATFORM_LABELS[plat] : m.platform;
    const interactions = computeInteractions(m);
    const engRate = computeEngagementRate(m);

    rows.push([
      m.talentName,
      m.contentUrl ?? "",
      m.sparkCode ?? "",
      m.views ?? "",
      m.likes ?? "",
      m.comments ?? "",
      m.shares ?? "",
      m.reposts ?? "",
      m.saves ?? "",
      forGoogleSheets
        ? `=IFERROR(IF(D${r}>0; SUM(E${r}:I${r})/D${r}; ""); "")`
        : Number((engRate / 100).toFixed(4)),
      platLabel,
      m.publishedAt ? m.publishedAt.toISOString().slice(0, 10) : "",
      forGoogleSheets ? `=SUM(F${r}:I${r})` : interactions,
    ]);
  });

  const lastDataRow = dataset.verifiedInfluence.length + 1;
  const t = dataset.totals;
  if (dataset.verifiedInfluence.length > 0) {
    const totalRowIdx = lastDataRow + 1;
    rows.push([
      "Total",
      "",
      "",
      forGoogleSheets ? `=SUM(D2:D${lastDataRow})` : t.views,
      forGoogleSheets ? `=SUM(E2:E${lastDataRow})` : t.likes,
      forGoogleSheets ? `=SUM(F2:F${lastDataRow})` : t.comments,
      forGoogleSheets ? `=SUM(G2:G${lastDataRow})` : t.shares,
      forGoogleSheets ? `=SUM(H2:H${lastDataRow})` : t.reposts,
      forGoogleSheets ? `=SUM(I2:I${lastDataRow})` : t.saves,
      forGoogleSheets
        ? `=IFERROR(IF(D${totalRowIdx}>0; SUM(E${totalRowIdx}:I${totalRowIdx})/D${totalRowIdx}; ""); "")`
        : Number((t.engagementRate / 100).toFixed(4)),
      "",
      "",
      forGoogleSheets ? `=SUM(M2:M${lastDataRow})` : t.interactions,
    ]);
  } else {
    rows.push(["Total", "", "", 0, 0, 0, 0, 0, 0, 0, "", "", 0]);
  }

  return rows;
}

function buildCumuleReseauxValues(
  dataset: ConsolidatedDataset,
  forGoogleSheets: boolean
): unknown[][] {
  const rows: unknown[][] = [
    [
      "Plateforme",
      "Nb Contenus",
      "Vues",
      "Likes",
      "Coms",
      "Partages",
      "Repost",
      "Enregistrements",
      "Interactions (hors Likes)",
      "Engagement %",
    ],
  ];

  const talentEndRow = Math.max(2, dataset.verifiedInfluence.length + 1);

  dataset.byPlatform.forEach((p, idx) => {
    const r = idx + 2;
    const useFormula = forGoogleSheets && dataset.verifiedInfluence.length > 0;
    rows.push([
      p.label,
      useFormula
        ? `=COUNTIF('Influence par Talent'!$K$2:$K$${talentEndRow}; A${r})`
        : p.contentCount,
      useFormula
        ? `=SUMIF('Influence par Talent'!$K$2:$K$${talentEndRow}; A${r}; 'Influence par Talent'!$D$2:$D$${talentEndRow})`
        : p.views,
      useFormula
        ? `=SUMIF('Influence par Talent'!$K$2:$K$${talentEndRow}; A${r}; 'Influence par Talent'!$E$2:$E$${talentEndRow})`
        : p.likes,
      useFormula
        ? `=SUMIF('Influence par Talent'!$K$2:$K$${talentEndRow}; A${r}; 'Influence par Talent'!$F$2:$F$${talentEndRow})`
        : p.comments,
      useFormula
        ? `=SUMIF('Influence par Talent'!$K$2:$K$${talentEndRow}; A${r}; 'Influence par Talent'!$G$2:$G$${talentEndRow})`
        : p.shares,
      useFormula
        ? `=SUMIF('Influence par Talent'!$K$2:$K$${talentEndRow}; A${r}; 'Influence par Talent'!$H$2:$H$${talentEndRow})`
        : p.reposts,
      useFormula
        ? `=SUMIF('Influence par Talent'!$K$2:$K$${talentEndRow}; A${r}; 'Influence par Talent'!$I$2:$I$${talentEndRow})`
        : p.saves,
      useFormula ? `=SUM(E${r}:H${r})` : p.interactions,
      useFormula
        ? `=IFERROR(IF(C${r}>0; SUM(D${r}:H${r})/C${r}; 0); 0)`
        : Number((p.engagementRate / 100).toFixed(4)),
    ]);
  });

  const t = dataset.totals;
  rows.push([
    "Total Général",
    forGoogleSheets ? "=SUM(B2:B5)" : t.contentCount,
    forGoogleSheets ? "=SUM(C2:C5)" : t.views,
    forGoogleSheets ? "=SUM(D2:D5)" : t.likes,
    forGoogleSheets ? "=SUM(E2:E5)" : t.comments,
    forGoogleSheets ? "=SUM(F2:F5)" : t.shares,
    forGoogleSheets ? "=SUM(G2:G5)" : t.reposts,
    forGoogleSheets ? "=SUM(H2:H5)" : t.saves,
    forGoogleSheets ? "=SUM(I2:I5)" : t.interactions,
    forGoogleSheets
      ? "=IFERROR(IF(C6>0; SUM(D6:H6)/C6; 0); 0)"
      : Number((t.engagementRate / 100).toFixed(4)),
  ]);

  return rows;
}

function buildVerbatimsValues(dataset: ConsolidatedDataset): unknown[][] {
  const rows: unknown[][] = [
    ["Auteur", "Plateforme", "Talent", "Citation", "Likes", "Sélectionné Slides"],
  ];

  for (const v of dataset.verbatims) {
    const plat = normalizeInfluencePlatform(v.platform);
    rows.push([
      v.authorHandle,
      plat ? PLATFORM_LABELS[plat] : v.platform,
      v.talentName ?? "",
      v.quote,
      v.likesCount,
      v.selectedForSlides ? "Oui" : "Non",
    ]);
  }

  return rows;
}

export async function consolidateReportingToSheets(
  prisma: PrismaClient,
  gateway: GoogleWorkspacePort,
  projectId: string
): Promise<{
  reportingSheetId: string;
  node0062Id: string;
  tabs: readonly string[];
  chartId: number | null;
  dataset: ConsolidatedDataset;
}> {
  const dataset = await buildConsolidatedDataset(prisma, projectId);
  const { reportingSheetId, node0062 } = await ensureReportingSheetInSandbox(
    prisma,
    gateway.drive,
    dataset.project
  );

  // Inspect existing tabs (never delete raw tabs)
  const spreadsheet = await gateway.sheets.getSpreadsheet({
    spreadsheetId: reportingSheetId,
  });

  const rawSheets = Array.isArray(
    (spreadsheet as { sheets?: unknown[] }).sheets
  )
    ? ((spreadsheet as { sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> }).sheets ?? [])
    : [];

  const sheetIdByTitle = new Map<string, number>();
  for (const s of rawSheets) {
    const title = s.properties?.title;
    const sheetId = s.properties?.sheetId;
    if (typeof title === "string" && typeof sheetId === "number") {
      sheetIdByTitle.set(title, sheetId);
    }
  }

  const missingTabs = REPORTING_TABS.filter((t) => !sheetIdByTitle.has(t));
  if (missingTabs.length > 0) {
    const addRes = await gateway.sheets.batchUpdate({
      spreadsheetId: reportingSheetId,
      requests: missingTabs.map((title) => ({
        addSheet: {
          properties: {
            title,
          },
        },
      })),
    });

    const replies = Array.isArray(
      (addRes as { replies?: unknown[] }).replies
    )
      ? ((addRes as { replies?: Array<{ addSheet?: { properties?: { sheetId?: number; title?: string } } }> }).replies ?? [])
      : [];

    for (const rep of replies) {
      const props = rep.addSheet?.properties;
      if (props?.title && typeof props.sheetId === "number") {
        sheetIdByTitle.set(props.title, props.sheetId);
      }
    }
  }

  // Clear existing contents idempotently on our 4 tabs when sheetIds are known
  const clearRequests: Record<string, unknown>[] = [];
  for (const tab of REPORTING_TABS) {
    const sid = sheetIdByTitle.get(tab);
    if (typeof sid === "number") {
      clearRequests.push({
        updateCells: {
          range: {
            sheetId: sid,
            startRowIndex: 0,
            endRowIndex: 500,
            startColumnIndex: 0,
            endColumnIndex: 20,
          },
          fields: "userEnteredValue",
        },
      });
    }
  }
  if (clearRequests.length > 0) {
    await gateway.sheets.batchUpdate({
      spreadsheetId: reportingSheetId,
      requests: clearRequests,
    });
  }

  // Write the 4 consolidated tabs
  await gateway.sheets.updateValues({
    spreadsheetId: reportingSheetId,
    range: `'${REPORTING_TABS[0]}'!A1`,
    values: buildSyntheseFortniteValues(dataset, true),
    valueInputOption: "USER_ENTERED",
  });

  await gateway.sheets.updateValues({
    spreadsheetId: reportingSheetId,
    range: `'${REPORTING_TABS[1]}'!A1`,
    values: buildInfluenceParTalentValues(dataset, true),
    valueInputOption: "USER_ENTERED",
  });

  await gateway.sheets.updateValues({
    spreadsheetId: reportingSheetId,
    range: `'${REPORTING_TABS[2]}'!A1`,
    values: buildCumuleReseauxValues(dataset, true),
    valueInputOption: "USER_ENTERED",
  });

  await gateway.sheets.updateValues({
    spreadsheetId: reportingSheetId,
    range: `'${REPORTING_TABS[3]}'!A1`,
    values: buildVerbatimsValues(dataset),
    valueInputOption: "USER_ENTERED",
  });

  // Add brand-styled chart on Synthèse Fortnite (dark navy #1E1A3F, neon yellow #EFF85D, blue #4C6CFF)
  let chartId: number | null = null;
  const fortniteSheetId = sheetIdByTitle.get(REPORTING_TABS[0]) ?? 0;
  try {
    const rowEnd = Math.max(12, 11 + dataset.fortniteRows.length);
    const chartRes = await gateway.sheets.addChart({
      spreadsheetId: reportingSheetId,
      spec: {
        spec: {
          title: `Fortnite — Joueurs & Sessions (${dataset.project.client})`,
          backgroundColor: { red: 0.118, green: 0.102, blue: 0.247 },
          basicChart: {
            chartType: "COLUMN",
            legendPosition: "BOTTOM_LEGEND",
            domains: [
              {
                domain: {
                  sourceRange: {
                    sources: [
                      {
                        sheetId: fortniteSheetId,
                        startRowIndex: 10,
                        endRowIndex: rowEnd,
                        startColumnIndex: 0,
                        endColumnIndex: 1,
                      },
                    ],
                  },
                },
              },
            ],
            series: [
              {
                series: {
                  sourceRange: {
                    sources: [
                      {
                        sheetId: fortniteSheetId,
                        startRowIndex: 10,
                        endRowIndex: rowEnd,
                        startColumnIndex: 1,
                        endColumnIndex: 2,
                      },
                    ],
                  },
                },
                color: { red: 0.937, green: 0.973, blue: 0.365 },
              },
              {
                series: {
                  sourceRange: {
                    sources: [
                      {
                        sheetId: fortniteSheetId,
                        startRowIndex: 10,
                        endRowIndex: rowEnd,
                        startColumnIndex: 2,
                        endColumnIndex: 3,
                      },
                    ],
                  },
                },
                color: { red: 0.298, green: 0.424, blue: 1.0 },
              },
            ],
          },
        },
        position: {
          overlayPosition: {
            anchorCell: {
              sheetId: fortniteSheetId,
              rowIndex: 0,
              columnIndex: 9,
            },
          },
        },
      },
    });
    chartId = chartRes.chartId;
  } catch {
    chartId = null;
  }

  await prisma.driveNode.update({
    where: { id: node0062.id },
    data: { internalModifiedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "REPORTING_CONSOLIDATED",
      targetType: "REPORTING_SHEET",
      targetId: reportingSheetId,
      detailsJson: JSON.stringify({
        tabs: REPORTING_TABS,
        fortniteDays: dataset.fortniteRows.length,
        verifiedInfluenceCount: dataset.verifiedInfluence.length,
        excludedUnverifiedCount: dataset.excludedUnverifiedCount,
        verbatimsCount: dataset.verbatims.length,
        chartId,
      }),
    },
  });

  return {
    reportingSheetId,
    node0062Id: node0062.id,
    tabs: REPORTING_TABS,
    chartId,
    dataset,
  };
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF141031" },
    };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });
}

function autoFitColumns(sheet: ExcelJS.Worksheet): void {
  sheet.columns.forEach((col) => {
    let maxLen = 12;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len + 2 > maxLen) maxLen = Math.min(len + 2, 48);
    });
    col.width = maxLen;
  });
}

export async function exportReportingWorkbookBuffer(
  dataset: ConsolidatedDataset
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GO Project Hub";
  workbook.created = new Date();

  // 1. Synthèse Fortnite
  const wsFortnite = workbook.addWorksheet(REPORTING_TABS[0]);
  const fortniteValues = buildSyntheseFortniteValues(dataset, false);
  fortniteValues.forEach((rowVals, idx) => {
    const row = wsFortnite.addRow(rowVals);
    if (idx === 0 || idx === 10) {
      styleHeaderRow(row);
    }
  });
  autoFitColumns(wsFortnite);

  // 2. Influence par Talent
  const wsTalent = workbook.addWorksheet(REPORTING_TABS[1]);
  const talentValues = buildInfluenceParTalentValues(dataset, false);
  talentValues.forEach((rowVals, idx) => {
    const row = wsTalent.addRow(rowVals);
    if (idx === 0) {
      styleHeaderRow(row);
    } else {
      const engCell = row.getCell(10);
      if (typeof engCell.value === "number") {
        engCell.numFmt = "0.0%";
      }
      if (idx === talentValues.length - 1) {
        row.font = { bold: true };
      }
    }
  });
  autoFitColumns(wsTalent);

  // 3. Cumulé Réseaux
  const wsNetwork = workbook.addWorksheet(REPORTING_TABS[2]);
  const networkValues = buildCumuleReseauxValues(dataset, false);
  networkValues.forEach((rowVals, idx) => {
    const row = wsNetwork.addRow(rowVals);
    if (idx === 0) {
      styleHeaderRow(row);
    } else {
      const engCell = row.getCell(10);
      if (typeof engCell.value === "number") {
        engCell.numFmt = "0.0%";
      }
      if (idx === networkValues.length - 1) {
        row.font = { bold: true };
      }
    }
  });
  autoFitColumns(wsNetwork);

  // 4. Verbatims
  const wsVerbatims = workbook.addWorksheet(REPORTING_TABS[3]);
  const verbatimValues = buildVerbatimsValues(dataset);
  verbatimValues.forEach((rowVals, idx) => {
    const row = wsVerbatims.addRow(rowVals);
    if (idx === 0) {
      styleHeaderRow(row);
    }
  });
  autoFitColumns(wsVerbatims);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
