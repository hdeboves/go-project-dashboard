import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { syncProjectToExternal, updateDriveNodeStatus } from "@/lib/drive/sync-service";
import { provisionProjectTree } from "@/lib/drive/tree-service";
import { PROD_IMMUTABLE_IDS } from "@/lib/google/sandbox-guard";
import type { GoogleWorkspacePort } from "@/lib/ports";
import { runRetroSnapshot14dJob, runRetroVeilleJob } from "@/lib/retroplanning/jobs";
import { createRetroTask } from "@/lib/retroplanning/retro-service";
import { runWeeklyPrepJob } from "@/lib/weeklys/jobs";
import { generateWeeklyReport } from "@/lib/weeklys/weekly-service";
import {
  createInMemoryGeminiDouble,
  createInMemoryGoogleDouble,
} from "../doubles/in-memory-google";

describe("M3 F19 & F24 — Weekly Client Generator, 003.2 [EXT] Gating & Job Runners", () => {
  let tempDir: string;
  let prisma: PrismaClient;
  const origHarness = process.env.TEST_BOUNDARY_HARNESS;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-m3-weeklys-"));
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

  afterEach(() => {
    process.env.TEST_BOUNDARY_HARNESS = origHarness;
    globalThis.__GO_TEST_BOUNDARY__ = undefined;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("collects J-7->J tasks, filters 004. visuals, splits Slide 32 2-col Prochaines étapes, creates Draft only, and gates 003.2 [EXT]", async () => {
    const baseDouble = createInMemoryGoogleDouble();
    const batchUpdates: Record<string, unknown>[][] = [];
    const draftsCreated: Array<{ subject: string; textBody: string }> = [];

    const gateway: GoogleWorkspacePort = {
      ...baseDouble,
      slides: {
        ...baseDouble.slides,
        async getPresentation() {
          return {
            slides: [
              {
                objectId: "g3faa55c2181_35_5",
                pageElements: [{ objectId: "g3faa55c2181_35_7" }],
              },
            ],
          };
        },
        async batchUpdate(params) {
          batchUpdates.push(params.requests);
          return {};
        },
        async replaceShapesWithDriveImage() {
          return { applied: false, warning: "DOMAIN_SHARING_BLOCKED" };
        },
      },
      gmail: {
        ...baseDouble.gmail,
        async createDraft(params) {
          draftsCreated.push({
            subject: params.subject,
            textBody: params.textBody,
          });
          return { draftId: "draft_weekly_1", messageId: "msg_weekly_1" };
        },
      },
    };

    const project = await prisma.project.create({
      data: {
        codeProjet: "326950",
        client: "Caisse d'Épargne",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });
    const foreignProject = await prisma.project.create({
      data: {
        codeProjet: "326951",
        client: "Foreign",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    await provisionProjectTree(prisma, gateway.drive, project.id);
    await provisionProjectTree(prisma, gateway.drive, foreignProject.id);

    // Seed tasks: 2 in-window, 1 out-of-window
    await createRetroTask(prisma, project.id, {
      phase: "Phase 2",
      etape: "Dev",
      tache: "Build Map v3 (In-Window)",
      startDate: "2026-09-05",
      endDate: "2026-09-09",
      status: "TERMINE",
    });
    await createRetroTask(prisma, project.id, {
      phase: "Phase 1",
      etape: "Cadrage",
      tache: "Ancienne tâche J-30 (Out-Of-Window)",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      status: "TERMINE",
    });

    // Seed 004. visuals: 1 PNG + 1 PDF + 1 foreign PNG
    const folder0042 = await prisma.driveNode.findFirstOrThrow({
      where: { projectId: project.id, code: "004.2" },
    });
    const pngFile = await gateway.drive.createFile({
      name: "capture.png",
      parentId: folder0042.driveFileId!,
      mimeType: "image/png",
      body: Buffer.from("pngdata"),
    });
    const pngNode = await prisma.driveNode.create({
      data: {
        projectId: project.id,
        code: "004.2.capture",
        name: "capture.png",
        driveFileId: pngFile.id,
        parentNodeId: folder0042.id,
        isFolder: false,
        mimeType: "image/png",
      },
    });
    const pdfNode = await prisma.driveNode.create({
      data: {
        projectId: project.id,
        code: "004.2.spec",
        name: "spec.pdf",
        driveFileId: "sbx_pdf_1",
        parentNodeId: folder0042.id,
        isFolder: false,
        mimeType: "application/pdf",
      },
    });
    const foreignNode = await prisma.driveNode.create({
      data: {
        projectId: foreignProject.id,
        code: "004.2.foreign",
        name: "foreign.png",
        driveFileId: "sbx_foreign_1",
        isFolder: false,
        mimeType: "image/png",
      },
    });

    // Reject inverted date window (400)
    await expect(
      generateWeeklyReport(prisma, project.id, async () => gateway, {
        weekStart: "2026-09-18",
        weekEnd: "2026-09-11",
      })
    ).rejects.toMatchObject({ httpStatus: 400 });

    // Reject cross-project visual injection (403)
    await expect(
      generateWeeklyReport(prisma, project.id, async () => gateway, {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
        visualDriveIds: [foreignNode.id],
      })
    ).rejects.toMatchObject({ httpStatus: 403 });

    const res = await generateWeeklyReport(
      prisma,
      project.id,
      async () => gateway,
      {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
        nextStepsClient: ["Valider trailer v2"],
        nextStepsGo: ["Soumettre modération Epic"],
      }
    );

    expect(res.weekly.title).toBe("2026-09-11 - Weekly Caisse d'Épargne");
    expect(PROD_IMMUTABLE_IDS.has(res.weekly.slidesFileId!)).toBe(false);
    expect(res.weekly.gmailDraftId).toBe("draft_weekly_1");
    expect(res.warnings).toEqual(["capture.png: DOMAIN_SHARING_BLOCKED"]);

    // Verify task overlap & non-image exclusion
    expect(res.weekly.collectedTasksJson).toContain("Build Map v3 (In-Window)");
    expect(res.weekly.collectedTasksJson).not.toContain("Ancienne tâche J-30");
    expect(res.weekly.visualsDriveIdsJson).toContain(pngNode.id);
    expect(res.weekly.visualsDriveIdsJson).not.toContain(pdfNode.id);

    // Verify PROD Slide 32 2-column split (Côté Client vs Côté GO)
    const serializedSlidesBatch = JSON.stringify(batchUpdates);
    expect(serializedSlidesBatch).toContain("g3faa55c2181_35_7");
    expect(serializedSlidesBatch).toContain("Côté Client");
    expect(serializedSlidesBatch).toContain("Côté GO");

    // Verify Gmail Draft only (no [EXT - link while BROUILLON_INTERNE)
    expect(draftsCreated).toHaveLength(1);
    expect(draftsCreated[0].textBody).not.toContain("[EXT -");

    // Verify 003.2 [EXT] gating: BROUILLON_INTERNE stays internal; VALIDE_CLIENT syncs
    const weeklyDriveNode = await prisma.driveNode.findFirstOrThrow({
      where: { projectId: project.id, driveFileId: res.weekly.slidesFileId },
    });
    const draftSync = await syncProjectToExternal(prisma, gateway.drive, project.id);
    expect(draftSync.syncedNodes.some((n) => n.nodeId === weeklyDriveNode.id)).toBe(false);

    await updateDriveNodeStatus(prisma, {
      projectId: project.id,
      nodeId: weeklyDriveNode.id,
      validationStatus: "VALIDE_CLIENT",
    });
    const validatedSync = await syncProjectToExternal(
      prisma,
      gateway.drive,
      project.id
    );
    expect(validatedSync.syncedNodes.some((n) => n.nodeId === weeklyDriveNode.id)).toBe(true);
  });

  it("executes F24 job runners (veille, snapshot 14d, weekly prep) and writes AuditLog entries", async () => {
    const gateway = createInMemoryGoogleDouble();
    const gemini = createInMemoryGeminiDouble();
    process.env.TEST_BOUNDARY_HARNESS = "1";
    globalThis.__GO_TEST_BOUNDARY__ = {
      respectCredentials: false,
      googleGateway: gateway,
      geminiClient: gemini,
    };

    const project = await prisma.project.create({
      data: {
        codeProjet: "326960",
        client: "F24 Jobs",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });
    await provisionProjectTree(prisma, gateway.drive, project.id);

    const veilleJob = await runRetroVeilleJob(prisma, project.id);
    expect(veilleJob.processedProjects).toBe(1);
    expect(veilleJob.errors).toEqual([]);

    const snapJob1 = await runRetroSnapshot14dJob(prisma, project.id);
    expect(snapJob1.createdCount).toBe(1);
    const snapJob2 = await runRetroSnapshot14dJob(prisma, project.id);
    expect(snapJob2.createdCount).toBe(0);
    expect(snapJob2.skippedCount).toBe(1);

    const weeklyJob = await runWeeklyPrepJob(prisma, project.id);
    expect(weeklyJob.generatedCount).toBe(1);
    expect(weeklyJob.skippedCount).toBe(0);

    // Same-day / same-window dedupe skips duplicate generation on repeated run
    const weeklyJobDup = await runWeeklyPrepJob(prisma, project.id);
    expect(weeklyJobDup.generatedCount).toBe(0);
    expect(weeklyJobDup.skippedCount).toBe(1);

    // Explicit force option overrides deduplication
    const weeklyJobForced = await runWeeklyPrepJob(prisma, project.id, {
      force: true,
    });
    expect(weeklyJobForced.generatedCount).toBe(1);
    expect(weeklyJobForced.skippedCount).toBe(0);

    const jobLogs = await prisma.auditLog.findMany({
      where: {
        projectId: project.id,
        action: {
          in: [
            "RETRO_VEILLE_JOB_RUN",
            "RETRO_SNAPSHOT_14D_JOB_RUN",
            "WEEKLY_PREP_JOB_RUN",
          ],
        },
      },
    });
    expect(jobLogs).toHaveLength(6);
    expect(new Set(jobLogs.map((l) => l.action))).toEqual(
      new Set([
        "RETRO_VEILLE_JOB_RUN",
        "RETRO_SNAPSHOT_14D_JOB_RUN",
        "WEEKLY_PREP_JOB_RUN",
      ])
    );
  });

  it("leaves zero orphan WeeklyReport, DriveNode, or SyncStatus rows when Gmail createDraft fails", async () => {
    const baseDouble = createInMemoryGoogleDouble();
    const failingGmailGateway: GoogleWorkspacePort = {
      ...baseDouble,
      gmail: {
        ...baseDouble.gmail,
        async createDraft() {
          throw new Error("Simulated Gmail 500 error");
        },
      },
    };

    const project = await prisma.project.create({
      data: {
        codeProjet: "326961",
        client: "Atomic Weekly",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });
    await provisionProjectTree(prisma, failingGmailGateway.drive, project.id);

    const reportsBefore = await prisma.weeklyReport.count({
      where: { projectId: project.id },
    });
    const nodesBefore = await prisma.driveNode.count({
      where: { projectId: project.id, code: { startsWith: "003.2.weekly." } },
    });
    const syncsBefore = await prisma.syncStatus.count({
      where: { projectId: project.id },
    });

    await expect(
      generateWeeklyReport(prisma, project.id, async () => failingGmailGateway, {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
      })
    ).rejects.toThrow("Simulated Gmail 500 error");

    expect(
      await prisma.weeklyReport.count({ where: { projectId: project.id } })
    ).toBe(reportsBefore);
    expect(
      await prisma.driveNode.count({
        where: { projectId: project.id, code: { startsWith: "003.2.weekly." } },
      })
    ).toBe(nodesBefore);
    expect(
      await prisma.syncStatus.count({ where: { projectId: project.id } })
    ).toBe(syncsBefore);
  });
});
