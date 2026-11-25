import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PreconditionError } from "@/lib/container";
import { PILOT_SANDBOX_CONFIG, provisionProjectTree, provisionTalentFolders } from "@/lib/drive/tree-service";
import { CpConflictError } from "@/lib/isolation/cp-guard";
import type { GeminiPort } from "@/lib/ports";
import {
  buildConsolidatedDataset,
  consolidateReportingToSheets,
  exportReportingWorkbookBuffer,
} from "@/lib/reporting/consolidator";
import {
  detectImageMagicMime,
  extractPngTextChunks,
  ingestInfluenceScreenshot,
  verifyInfluenceMetric,
} from "@/lib/reporting/influence-service";
import { REPORTING_TABS, computeEngagementRate } from "@/lib/reporting/types";
import {
  createInMemoryGeminiDouble,
  createInMemoryGoogleDouble,
} from "../doubles/in-memory-google";

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); // simplified CRC for unit test parsing
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function buildTestPng(commentText?: string): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunks = [sig, makePngChunk("IHDR", ihdr)];
  if (commentText) {
    chunks.push(
      makePngChunk("tEXt", Buffer.from(`Comment\0${commentText}`, "latin1"))
    );
  }
  chunks.push(makePngChunk("IDAT", deflateSync(Buffer.alloc(4 * (1 + 4 * 4)))));
  chunks.push(makePngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

describe("M4 Influence Service, CP-Conflict Guard, 4-Tab Consolidator & .xlsx Export", () => {
  let tempDir: string;
  let prisma: PrismaClient;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-m4-inf-test-"));
    const dbPath = path.join(tempDir, "test.db");
    const baseDb = path.join(process.cwd(), "prisma", "dev.db");
    if (fs.existsSync(baseDb)) {
      fs.copyFileSync(baseDb, dbPath);
    } else {
      execFileSync("npx.cmd", ["prisma", "db", "push", "--skip-generate"], {
        env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      });
    }
    prisma = new PrismaClient({
      datasources: { db: { url: `file:${dbPath}` } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("validates image magic bytes and extracts PNG tEXt metadata chunks", () => {
    const png = buildTestPng("CP 326018 Cristaline");
    expect(detectImageMagicMime(png)).toBe("image/png");
    expect(extractPngTextChunks(png).join(" ")).toContain("326018");
    expect(detectImageMagicMime(Buffer.from("CORRUPT_PNG"))).toBeNull();
  });

  it("checks 404 project existence before 412 preconditions and blocks CP conflict 326018 in 326027", async () => {
    const google = createInMemoryGoogleDouble();
    const gemini = createInMemoryGeminiDouble();

    await expect(
      ingestInfluenceScreenshot(
        {
          prisma,
          getGoogleGateway: async () => {
            throw new PreconditionError("GOOGLE_NOT_CONNECTED", "Missing");
          },
          getGeminiClient: async () => gemini,
        },
        "missing-project-id",
        {
          fileBuffer: buildTestPng(),
          filename: "test.png",
          declaredMimeType: "image/png",
          talentName: "Kalut",
          platform: "TIKTOK",
        }
      )
    ).rejects.toMatchObject({ httpStatus: 404 });

    const project = await prisma.project.create({
      data: {
        codeProjet: "326027",
        client: "Caisse d'Épargne Test M4",
        nomJeu: "Fortnite Test M4",
        isSandbox: true,
      },
    });
    await provisionProjectTree(prisma, google.drive, project.id);

    // CP conflict embedded in PNG tEXt chunk must throw 409 CpConflictError with 0 stored metrics
    await expect(
      ingestInfluenceScreenshot(
        {
          prisma,
          getGoogleGateway: async () => google,
          getGeminiClient: async () => gemini,
        },
        project.id,
        {
          fileBuffer: buildTestPng("Facture CP 326018 Cristaline"),
          filename: "clean_name.png",
          declaredMimeType: "image/png",
          talentName: "Kalut",
          platform: "TIKTOK",
        }
      )
    ).rejects.toBeInstanceOf(CpConflictError);

    const count = await prisma.influenceMetric.count({
      where: { projectId: project.id },
    });
    expect(count).toBe(0);
  });

  it("preserves nullable platform fields, verifies human edits without mutating Drive, blocks cross-project IDOR, and handles views === 0", async () => {
    const google = createInMemoryGoogleDouble();
    const customGemini: GeminiPort = {
      ...createInMemoryGeminiDouble(),
      async extractInfluenceMetricsFromImage() {
        return {
          detectedPlatform: "YOUTUBE_SHORTS",
          views: 132000,
          likes: 9100,
          comments: 210,
          shares: null,
          reposts: null,
          saves: null,
          engagementRate: 7.05,
          detectedHandleOrCaption: "@aksianka",
          fieldConfidence: { views: 0.96, likes: 0.72 },
          extractionNotes: [],
        };
      },
    };

    const projA = await prisma.project.create({
      data: {
        codeProjet: "326091",
        client: "Client A",
        nomJeu: "Fortnite A",
        isSandbox: true,
      },
    });
    const projB = await prisma.project.create({
      data: {
        codeProjet: "326092",
        client: "Client B",
        nomJeu: "Fortnite B",
        isSandbox: true,
      },
    });
    await provisionProjectTree(prisma, google.drive, projA.id);
    await provisionTalentFolders(prisma, google.drive, projA.id, "Aksianka");

    const { metric, rawFile } = await ingestInfluenceScreenshot(
      {
        prisma,
        getGoogleGateway: async () => google,
        getGeminiClient: async () => customGemini,
      },
      projA.id,
      {
        fileBuffer: buildTestPng("Aksianka YouTube Shorts"),
        filename: "aksianka_yt.png",
        declaredMimeType: "image/png",
        talentName: "Aksianka",
        platform: "YOUTUBE_SHORTS",
        contentUrl: "https://youtube.com/shorts/1",
        sparkCode: "SPARK-YT-1",
      }
    );

    expect(metric.verifiedByHuman).toBe(false);
    expect(metric.shares).toBeNull();
    expect(metric.reposts).toBeNull();
    expect(metric.saves).toBeNull();
    expect(rawFile.localPreviewPath).toBeTruthy();

    // Cross-project IDOR blocked
    await expect(
      verifyInfluenceMetric(prisma, projB.id, metric.id, {
        views: 99999,
        verifiedByHuman: true,
      })
    ).rejects.toMatchObject({ httpStatus: 404 });

    // Negative metric blocked
    await expect(
      verifyInfluenceMetric(prisma, projA.id, metric.id, {
        views: -1,
        verifiedByHuman: true,
      })
    ).rejects.toMatchObject({ httpStatus: 400 });

    // views === 0 yields deterministic finite 0 engagementRate
    const zeroed = await verifyInfluenceMetric(prisma, projA.id, metric.id, {
      views: 0,
      likes: 50,
      verifiedByHuman: true,
    });
    expect(zeroed.engagementRate).toBe(0);
    expect(Number.isFinite(zeroed.engagementRate)).toBe(true);
    expect(google.drive.updateCalls).toEqual([]);

    // Valid edit recomputes engagementRate accurately
    const verified = await verifyInfluenceMetric(prisma, projA.id, metric.id, {
      views: 100000,
      likes: 7000,
      comments: 200,
      shares: null,
      reposts: null,
      saves: 300,
      verifiedByHuman: true,
    });
    expect(verified.verifiedByHuman).toBe(true);
    expect(verified.engagementRate).toBe(
      computeEngagementRate({
        views: 100000,
        likes: 7000,
        comments: 200,
        saves: 300,
      })
    );
  });

  it("consolidates only verified metrics into 4 exact tabs, reconciles totals 1:1, preserves XML/Unicode/emoji, and leaves PROD untouched", async () => {
    const google = createInMemoryGoogleDouble();
    const project = await prisma.project.create({
      data: {
        codeProjet: "326093",
        client: "Client Recon",
        nomJeu: "Fortnite Recon",
        isSandbox: true,
      },
    });
    await provisionProjectTree(prisma, google.drive, project.id);

    await prisma.fortniteMetric.create({
      data: {
        projectId: project.id,
        date: "2026-09-01",
        uniquePlayers: 12000,
        sessions: 18000,
        avgPlaytimeSec: 1200,
        retentionD1: 25,
        peakConcurrent: 900,
      },
    });

    await prisma.influenceMetric.createMany({
      data: [
        {
          projectId: project.id,
          talentName: "Kalut",
          platform: "TIKTOK",
          views: 200000,
          likes: 15000,
          comments: 300,
          shares: 900,
          saves: 500,
          engagementRate: 8.35,
          verifiedByHuman: true,
        },
        {
          projectId: project.id,
          talentName: "UnverifiedGhost",
          platform: "INSTAGRAM",
          views: 999999,
          likes: 88888,
          verifiedByHuman: false,
        },
      ],
    });

    await prisma.verbatim.create({
      data: {
        projectId: project.id,
        authorHandle: "@xml_&_émoji",
        platform: "TIKTOK",
        talentName: "Kalut",
        quote: 'Super map & GO <Fortnite> "Top 1" 🔥 éèêàç',
        likesCount: 42,
        selectedForSlides: true,
      },
    });

    const res = await consolidateReportingToSheets(prisma, google, project.id);
    expect(res.reportingSheetId).not.toBe(
      PILOT_SANDBOX_CONFIG.prodTemplates.reportingSheetId
    );
    expect(res.dataset.excludedUnverifiedCount).toBe(1);
    expect(res.dataset.totals.views).toBe(200000);
    expect(res.dataset.totals.interactions).toBe(1700);

    // Reconciliation: byTalent sums === byPlatform sums === totals
    const sumTalentViews = res.dataset.byTalent.reduce((s, t) => s + t.views, 0);
    const sumPlatformViews = res.dataset.byPlatform.reduce((s, p) => s + p.views, 0);
    expect(sumTalentViews).toBe(res.dataset.totals.views);
    expect(sumPlatformViews).toBe(res.dataset.totals.views);

    // .xlsx export round-trip via exceljs
    const xlsxBuf = await exportReportingWorkbookBuffer(res.dataset);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxBuf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([...REPORTING_TABS]);

    const verbatimSheet = wb.getWorksheet("Verbatims")!;
    const verbText = verbatimSheet
      .getSheetValues()
      .flat()
      .map((v) => String(v ?? ""))
      .join(" ");
    expect(verbText).toContain("& GO <Fortnite>");
    expect(verbText).toContain("🔥");
    expect(verbText).toContain("éèêàç");

    const talentText = wb
      .getWorksheet("Influence par Talent")!
      .getSheetValues()
      .flat()
      .map((v) => String(v ?? ""))
      .join(" ");
    expect(talentText).not.toContain("UnverifiedGhost");
    expect(talentText).not.toContain("999999");

    // Empty project dataset must not produce NaN or throw
    const emptyProj = await prisma.project.create({
      data: {
        codeProjet: "326094",
        client: "Empty",
        nomJeu: "Fortnite Empty",
        isSandbox: true,
      },
    });
    const emptyDataset = await buildConsolidatedDataset(prisma, emptyProj.id);
    const emptyBuf = await exportReportingWorkbookBuffer(emptyDataset);
    expect(emptyBuf.length).toBeGreaterThan(100);
  });
});
