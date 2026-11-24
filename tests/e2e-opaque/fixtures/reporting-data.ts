/**
 * Reporting Fixtures: Pure-JS PNG Generator, Fortnite Creator Portal CSV/XLSX,
 * 4-Platform WhatsApp Influence Screenshot Fixtures, Verbatims, 4-Tab & 12-Slide Constants.
 * Zero external dependencies (no src/, no prisma/, no exceljs).
 */

import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { buildXlsxWorkbook, crc32 } from "./budget-xlsx";
import {
  REPORTING_SLIDE_PATTERN,
  REPORTING_TABS,
  type InfluencePlatform,
} from "../helpers/constants";

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function buildMinimalPngBuffer(options?: {
  width?: number;
  height?: number;
  rgba?: readonly [number, number, number, number];
  commentText?: string;
}): Buffer {
  const width = options?.width ?? 8;
  const height = options?.height ?? 8;
  const [r, g, b, a] = options?.rgba ?? [30, 144, 255, 255];

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const scanlineSize = 1 + width * 4;
  const rawImage = Buffer.alloc(scanlineSize * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * scanlineSize;
    rawImage[rowStart] = 0; // filter type 0
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 4;
      rawImage[px] = r;
      rawImage[px + 1] = g;
      rawImage[px + 2] = b;
      rawImage[px + 3] = a;
    }
  }

  const chunks: Buffer[] = [signature, makePngChunk("IHDR", ihdr)];
  if (options?.commentText) {
    const commentBuf = Buffer.from(`Comment\0${options.commentText}`, "latin1");
    chunks.push(makePngChunk("tEXt", commentBuf));
  }
  chunks.push(makePngChunk("IDAT", deflateSync(rawImage)));
  chunks.push(makePngChunk("IEND", Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

export interface FortniteCsvRow {
  date: string;
  uniquePlayers: number;
  sessions: number;
  avgPlaytimeSec: number;
  retentionD1: number;
  peakConcurrent: number;
}

export const FORTNITE_CREATOR_ROWS: readonly FortniteCsvRow[] = [
  {
    date: "2026-09-01",
    uniquePlayers: 12400,
    sessions: 18500,
    avgPlaytimeSec: 1140,
    retentionD1: 24.5,
    peakConcurrent: 920,
  },
  {
    date: "2026-09-02",
    uniquePlayers: 15800,
    sessions: 23100,
    avgPlaytimeSec: 1260,
    retentionD1: 27.0,
    peakConcurrent: 1340,
  },
  {
    date: "2026-09-03",
    uniquePlayers: 11200,
    sessions: 16400,
    avgPlaytimeSec: 1080,
    retentionD1: 22.8,
    peakConcurrent: 840,
  },
  {
    date: "2026-09-04",
    uniquePlayers: 14100,
    sessions: 21000,
    avgPlaytimeSec: 1320,
    retentionD1: 26.1,
    peakConcurrent: 1180,
  },
];

export const FORTNITE_CREATOR_CSV_VALID: string = [
  "date,unique_players,sessions,avg_playtime_sec,retention_d1,peak_concurrent",
  ...FORTNITE_CREATOR_ROWS.map(
    (r) =>
      `${r.date},${r.uniquePlayers},${r.sessions},${r.avgPlaytimeSec},${r.retentionD1},${r.peakConcurrent}`
  ),
].join("\n");

export const FORTNITE_CREATOR_CSV_BUFFER: Buffer = Buffer.from(FORTNITE_CREATOR_CSV_VALID, "utf8");

export const FORTNITE_CREATOR_XLSX_BUFFER: Buffer = buildXlsxWorkbook([
  {
    name: "Fortnite Creator Portal",
    rows: [
      ["Date", "Unique Players", "Sessions", "Avg Playtime (s)", "Retention D1 (%)", "Peak Concurrent"],
      ...FORTNITE_CREATOR_ROWS.map((r) => [
        r.date,
        r.uniquePlayers,
        r.sessions,
        r.avgPlaytimeSec,
        r.retentionD1,
        r.peakConcurrent,
      ]),
    ],
  },
]);

export const FORTNITE_CREATOR_CSV_MALFORMED = "invalid_col_1,invalid_col_2\nnot_a_date,abc\n";

export const EXPECTED_FORTNITE_SUMMARY = {
  totalUniquePlayers: FORTNITE_CREATOR_ROWS.reduce((acc, r) => acc + r.uniquePlayers, 0),
  totalSessions: FORTNITE_CREATOR_ROWS.reduce((acc, r) => acc + r.sessions, 0),
  avgPlaytimeSec: Number(
    (
      FORTNITE_CREATOR_ROWS.reduce((acc, r) => acc + r.avgPlaytimeSec, 0) /
      FORTNITE_CREATOR_ROWS.length
    ).toFixed(2)
  ),
  avgRetentionD1: Number(
    (
      FORTNITE_CREATOR_ROWS.reduce((acc, r) => acc + r.retentionD1, 0) /
      FORTNITE_CREATOR_ROWS.length
    ).toFixed(2)
  ),
  maxPeakConcurrent: Math.max(...FORTNITE_CREATOR_ROWS.map((r) => r.peakConcurrent)),
};

export interface InfluenceScreenshotFixture {
  talentName: string;
  platform: InfluencePlatform;
  filename: string;
  mimeType: "image/png";
  buffer: Buffer;
  contentUrl: string;
  sparkCode?: string;
  expectedMetrics: {
    views: number;
    likes: number;
    comments: number | null;
    shares: number | null;
    reposts: number | null;
    saves: number | null;
    engagementRate: number;
  };
}

function calcEngagementRate(m: {
  views: number;
  likes: number;
  comments: number | null;
  shares: number | null;
  reposts: number | null;
  saves: number | null;
}): number {
  if (m.views <= 0) return 0;
  const interactions = (m.comments ?? 0) + (m.shares ?? 0) + (m.reposts ?? 0) + (m.saves ?? 0);
  return Number((((m.likes + interactions) / m.views) * 100).toFixed(2));
}

export const PILOT_INFLUENCE_SCREENSHOTS: readonly InfluenceScreenshotFixture[] = [
  {
    talentName: "Kalut",
    platform: "TIKTOK",
    filename: "kalut_tiktok_ce_fortnite.png",
    mimeType: "image/png",
    buffer: buildMinimalPngBuffer({
      rgba: [25, 25, 25, 255],
      commentText: "Kalut TikTok Vues=245000 Likes=18400 Coms=420 Partages=1150 Enreg=890",
    }),
    contentUrl: "https://www.tiktok.com/@kalut/video/7400000001",
    sparkCode: "#SPARK-KALUT-01",
    expectedMetrics: {
      views: 245000,
      likes: 18400,
      comments: 420,
      shares: 1150,
      reposts: null, // TikTok omits Reposts in PROD Reporting Caisse d'Epargne
      saves: 890,
      engagementRate: calcEngagementRate({
        views: 245000,
        likes: 18400,
        comments: 420,
        shares: 1150,
        reposts: null,
        saves: 890,
      }),
    },
  },
  {
    talentName: "Aksianka",
    platform: "YOUTUBE_SHORTS",
    filename: "aksianka_ytshorts_ce_fortnite.png",
    mimeType: "image/png",
    buffer: buildMinimalPngBuffer({
      rgba: [220, 38, 38, 255],
      commentText: "Aksianka YouTube Shorts Vues=132000 Likes=9100 Coms=210",
    }),
    contentUrl: "https://www.youtube.com/shorts/aksianka-ce-01",
    expectedMetrics: {
      views: 132000,
      likes: 9100,
      comments: 210,
      shares: null, // YouTube Shorts omits shares/reposts/saves in PROD sheet
      reposts: null,
      saves: null,
      engagementRate: calcEngagementRate({
        views: 132000,
        likes: 9100,
        comments: 210,
        shares: null,
        reposts: null,
        saves: null,
      }),
    },
  },
  {
    talentName: "Allyson",
    platform: "INSTAGRAM",
    filename: "allyson_instagram_ce_fortnite.png",
    mimeType: "image/png",
    buffer: buildMinimalPngBuffer({
      rgba: [192, 38, 211, 255],
      commentText: "Allyson Instagram Vues=98500 Likes=7300 Coms=185 Repost=95",
    }),
    contentUrl: "https://www.instagram.com/reel/allyson-ce-01",
    expectedMetrics: {
      views: 98500,
      likes: 7300,
      comments: 185,
      shares: null,
      reposts: 95,
      saves: null,
      engagementRate: calcEngagementRate({
        views: 98500,
        likes: 7300,
        comments: 185,
        shares: null,
        reposts: 95,
        saves: null,
      }),
    },
  },
  {
    talentName: "Wig",
    platform: "SNAPCHAT",
    filename: "wig_snapchat_ce_fortnite.png",
    mimeType: "image/png",
    buffer: buildMinimalPngBuffer({
      rgba: [250, 204, 21, 255],
      commentText: "Wig Snapchat Vues=76400 Likes=4200 Coms=64 Partages=310",
    }),
    contentUrl: "https://www.snapchat.com/spotlight/wig-ce-01",
    expectedMetrics: {
      views: 76400,
      likes: 4200,
      comments: 64,
      shares: 310,
      reposts: null,
      saves: null, // Snapchat omits saves in PROD sheet
      engagementRate: calcEngagementRate({
        views: 76400,
        likes: 4200,
        comments: 64,
        shares: 310,
        reposts: null,
        saves: null,
      }),
    },
  },
];

export const SCREENSHOT_MISSING_SHARES_YTSHORTS: InfluenceScreenshotFixture =
  PILOT_INFLUENCE_SCREENSHOTS[1];

export const SNAPSHOT_MISSING_SAVES_SNAPCHAT: InfluenceScreenshotFixture =
  PILOT_INFLUENCE_SCREENSHOTS[3];

export const PILOT_VERBATIMS: ReadonlyArray<{
  authorHandle: string;
  platform: InfluencePlatform;
  talentName: string;
  quote: string;
  likesCount: number;
  selectedForSlides: boolean;
}> = [
  {
    authorHandle: "@neox_fn",
    platform: "TIKTOK",
    talentName: "Kalut",
    quote: "La map Caisse d'Epargne sur Fortnite est vraiment propre, j'ai farm tout le weekend !",
    likesCount: 342,
    selectedForSlides: true,
  },
  {
    authorHandle: "@lulu_build",
    platform: "YOUTUBE_SHORTS",
    talentName: "Aksianka",
    quote: "Les défis avec le code créateur sont super fun entre potes.",
    likesCount: 128,
    selectedForSlides: true,
  },
  {
    authorHandle: "@enzo_rp",
    platform: "INSTAGRAM",
    talentName: "Allyson",
    quote: "Meilleure collab marque sur Fortnite cette saison.",
    likesCount: 94,
    selectedForSlides: true,
  },
  {
    authorHandle: "@snap_gamer75",
    platform: "SNAPCHAT",
    talentName: "Wig",
    quote: "Trop stylé le mini-jeu du coffre !",
    likesCount: 51,
    selectedForSlides: false,
  },
];

export const EXPECTED_REPORTING_TABS: readonly string[] = REPORTING_TABS;
export const EXPECTED_REPORTING_SLIDES_PATTERN: readonly string[] = REPORTING_SLIDE_PATTERN;

export const WEEKLY_VISUAL_PNG_BUFFER: Buffer = buildMinimalPngBuffer({
  width: 16,
  height: 9,
  rgba: [15, 23, 42, 255],
  commentText: "004.2 Jeu & Dev Capture Build Weekly",
});

export function computeExpectedInfluenceTotals(
  items: readonly InfluenceScreenshotFixture[]
): {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalReposts: number;
  totalSaves: number;
  byTalent: Record<string, { views: number; likes: number; interactions: number }>;
  byPlatform: Record<InfluencePlatform, { views: number; likes: number; interactions: number }>;
} {
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalReposts = 0;
  let totalSaves = 0;

  const byTalent: Record<string, { views: number; likes: number; interactions: number }> = {};
  const byPlatform: Record<InfluencePlatform, { views: number; likes: number; interactions: number }> = {
    TIKTOK: { views: 0, likes: 0, interactions: 0 },
    YOUTUBE_SHORTS: { views: 0, likes: 0, interactions: 0 },
    INSTAGRAM: { views: 0, likes: 0, interactions: 0 },
    SNAPCHAT: { views: 0, likes: 0, interactions: 0 },
  };

  for (const item of items) {
    const m = item.expectedMetrics;
    const comments = m.comments ?? 0;
    const shares = m.shares ?? 0;
    const reposts = m.reposts ?? 0;
    const saves = m.saves ?? 0;
    const interactions = comments + shares + reposts + saves;

    totalViews += m.views;
    totalLikes += m.likes;
    totalComments += comments;
    totalShares += shares;
    totalReposts += reposts;
    totalSaves += saves;

    const existingTalent = byTalent[item.talentName] ?? { views: 0, likes: 0, interactions: 0 };
    existingTalent.views += m.views;
    existingTalent.likes += m.likes;
    existingTalent.interactions += interactions;
    byTalent[item.talentName] = existingTalent;

    byPlatform[item.platform].views += m.views;
    byPlatform[item.platform].likes += m.likes;
    byPlatform[item.platform].interactions += interactions;
  }

  return {
    totalViews,
    totalLikes,
    totalComments,
    totalShares,
    totalReposts,
    totalSaves,
    byTalent,
    byPlatform,
  };
}
