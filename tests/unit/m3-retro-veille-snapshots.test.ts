import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { provisionProjectCalendar } from "@/lib/calendar/calendar-service";
import { PreconditionError, getServices } from "@/lib/container";
import { provisionProjectTree } from "@/lib/drive/tree-service";
import { CpConflictError } from "@/lib/isolation/cp-guard";
import type { GeminiPort } from "@/lib/ports";
import { applyOrDismissProposal } from "@/lib/retroplanning/proposal-service";
import { createRetroTask, updateRetroTask } from "@/lib/retroplanning/retro-service";
import {
  computeSnapshotDiff,
  createRetroSnapshot,
  listAndCompareSnapshots,
} from "@/lib/retroplanning/snapshot-service";
import { runRetroVeille } from "@/lib/retroplanning/veille-service";
import {
  createInMemoryGeminiDouble,
  createInMemoryGoogleDouble,
} from "../doubles/in-memory-google";

describe("M3 F16 & F17 — AI Veille (CP Guard), 1-Click Proposals & 14-Day Snapshots", () => {
  let tempDir: string;
  let prisma: PrismaClient;
  const origHarness = process.env.TEST_BOUNDARY_HARNESS;
  const origGeminiKey = process.env.GEMINI_API_KEY;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-m3-veille-snap-"));
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
    if (origGeminiKey !== undefined) {
      process.env.GEMINI_API_KEY = origGeminiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    globalThis.__GO_TEST_BOUNDARY__ = undefined;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("enforces 412 preconditions on missing Google/Gemini and handles empty veille input", async () => {
    delete process.env.TEST_BOUNDARY_HARNESS;
    delete process.env.GEMINI_API_KEY;
    await prisma.googleConnection.deleteMany({});
    await prisma.appSetting.deleteMany({ where: { key: "GEMINI_API_KEY" } });
    const services = getServices(prisma);

    await expect(services.getGoogleGateway()).rejects.toThrow(PreconditionError);
    await expect(services.getGeminiClient()).rejects.toThrow(PreconditionError);

    const gateway = createInMemoryGoogleDouble();
    const gemini = createInMemoryGeminiDouble();
    const project = await prisma.project.create({
      data: {
        codeProjet: "326801",
        client: "Veille Empty",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    const empty = await runRetroVeille(prisma, gateway, gemini, project.id, {
      includeDrive: true,
      emails: [],
      driveFiles: [],
    });
    expect(empty.proposals).toEqual([]);
    expect(empty.blockedConflicts).toEqual([]);
  });

  it("blocks foreign CP (326018 in 326027) on veille with AuditLog CP_CONFLICT_BLOCKED", async () => {
    const gateway = createInMemoryGoogleDouble();
    const gemini = createInMemoryGeminiDouble();
    const project = await prisma.project.create({
      data: {
        codeProjet: "326027",
        client: "Caisse d'Épargne Veille",
        nomJeu: "Fortnite Veille Test",
        isSandbox: true,
      },
    });

    await expect(
      runRetroVeille(prisma, gateway, gemini, project.id, {
        emails: [
          {
            id: "msg-326018",
            subject: "Cristaline CP 326018 - Validation",
            body: "Passage à TERMINE pour le projet CP 326018.",
          },
        ],
      })
    ).rejects.toThrow(CpConflictError);

    const conflictLog = await prisma.auditLog.findFirst({
      where: { projectId: project.id, action: "CP_CONFLICT_BLOCKED" },
    });
    expect(conflictLog).not.toBeNull();
    expect(conflictLog!.detailsJson).toContain("326018");
  });

  it("applies proposal with overrides, syncs Sheet + Calendar cascade, and rejects repeat/cross-project apply", async () => {
    let calendarPatchCount = 0;
    const baseDouble = createInMemoryGoogleDouble();
    const gateway = {
      ...baseDouble,
      calendar: {
        ...baseDouble.calendar,
        async createSecondaryCalendar(params: { summary: string }) {
          return { calendarId: "cal_sbx_1", summary: params.summary };
        },
        async insertEvent() {
          return { eventId: `evt_${Math.random().toString(36).slice(2, 8)}` };
        },
        async patchEvent(params: { eventId: string }) {
          calendarPatchCount++;
          return { eventId: params.eventId };
        },
      },
    };

    const project = await prisma.project.create({
      data: {
        codeProjet: "326802",
        client: "Veille Apply",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });
    const otherProject = await prisma.project.create({
      data: {
        codeProjet: "326803",
        client: "Other",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    await provisionProjectTree(prisma, gateway.drive, project.id);
    await provisionProjectCalendar(prisma, gateway.calendar, project.id);

    const { task: milestone } = await createRetroTask(
      prisma,
      project.id,
      {
        phase: "Phase 3",
        etape: "Influence",
        tache: "Publication Vidéo Kalut",
        startDate: "2026-12-15",
        endDate: "2026-12-15",
        status: "EN_COURS",
        isMilestone: true,
        milestoneType: "INFLUENCE",
      },
      gateway
    );

    const { task: dismissTask } = await createRetroTask(
      prisma,
      project.id,
      {
        phase: "Phase 2",
        etape: "Site",
        tache: "FAQ",
        startDate: "2026-12-01",
        endDate: "2026-12-05",
        status: "A_FAIRE",
      },
      gateway
    );

    const customGemini: GeminiPort = {
      ...createInMemoryGeminiDouble(),
      async analyzeRetroplanningVeille() {
        return {
          proposals: [
            {
              retroTaskId: milestone.id,
              taskTitle: milestone.tache,
              proposedStatus: "EN_COURS",
              proposedStartDate: "2026-12-20",
              proposedEndDate: "2026-12-20",
              deltaDays: 5,
              sourceType: "GMAIL",
              sourceRef: "msg-shift",
              summary: "Décalage Publication +5j",
              detectedCodeProjet: "326802",
              confidence: 0.92,
            },
            {
              retroTaskId: dismissTask.id,
              taskTitle: dismissTask.tache,
              proposedStatus: "TERMINE",
              proposedStartDate: null,
              proposedEndDate: null,
              deltaDays: 0,
              sourceType: "DRIVE",
              sourceRef: "file-faq",
              summary: "FAQ terminée",
              detectedCodeProjet: "326802",
              confidence: 0.85,
            },
          ],
        };
      },
    };

    const veille = await runRetroVeille(prisma, gateway, customGemini, project.id, {
      emails: [
        {
          id: "msg-shift",
          subject: "CP 326802 Décalage Kalut",
          body: "Publication décalée au 2026-12-20.",
        },
      ],
      driveFiles: [
        { id: "file-faq", name: "326802_FAQ_v1.png", parentCode: "004.5" },
      ],
    });
    expect(veille.proposals).toHaveLength(2);

    const shiftProp = veille.proposals[0];
    const dismissProp = veille.proposals[1];

    // Cross-project IDOR rejected
    await expect(
      applyOrDismissProposal(
        prisma,
        otherProject.id,
        shiftProp.id,
        { action: "APPLY" },
        async () => gateway
      )
    ).rejects.toMatchObject({ httpStatus: 404 });

    // Apply shift proposal
    const applied = await applyOrDismissProposal(
      prisma,
      project.id,
      shiftProp.id,
      { action: "APPLY" },
      async () => gateway
    );
    expect(applied.proposal.status).toBe("APPLIED");
    expect(applied.calendarSynced).toBe(true);
    expect(applied.task?.endDate?.toISOString().slice(0, 10)).toBe("2026-12-20");

    // Verify idempotent rejection on second apply
    await expect(
      applyOrDismissProposal(
        prisma,
        project.id,
        shiftProp.id,
        { action: "APPLY" },
        async () => gateway
      )
    ).rejects.toMatchObject({ httpStatus: 409 });

    // Dismiss second proposal without Sheet/Calendar mutations
    const patchBeforeDismiss = calendarPatchCount;
    const dismissed = await applyOrDismissProposal(
      prisma,
      project.id,
      dismissProp.id,
      { action: "DISMISS" },
      async () => gateway
    );
    expect(dismissed.proposal.status).toBe("DISMISSED");
    expect(calendarPatchCount).toBe(patchBeforeDismiss);
  });

  it("validates snapshot dates, enforces 14-day AUTO dedupe, keeps 002.2 INTERNAL_ONLY, and computes +7/-3/0/ADDED/REMOVED diffs", async () => {
    const gateway = createInMemoryGoogleDouble();
    const project = await prisma.project.create({
      data: {
        codeProjet: "326804",
        client: "Caisse d'Épargne",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });
    const foreignProject = await prisma.project.create({
      data: {
        codeProjet: "326805",
        client: "Foreign",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    await provisionProjectTree(prisma, gateway.drive, project.id);
    await provisionProjectTree(prisma, gateway.drive, foreignProject.id);

    // Invalid calendar date rejected with 400 and zero Drive copies
    const copiesBefore = gateway.drive.copyCalls.length;
    await expect(
      createRetroSnapshot(prisma, project.id, async () => gateway, {
        snapshotDate: "2026-02-30",
      })
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(gateway.drive.copyCalls.length).toBe(copiesBefore);

    const { task: tSlip } = await createRetroTask(
      prisma,
      project.id,
      {
        phase: "P1",
        etape: "Dev",
        tache: "Validation HUD",
        startDate: "2026-09-01",
        endDate: "2026-09-10",
      },
      gateway
    );
    const { task: tAhead } = await createRetroTask(
      prisma,
      project.id,
      {
        phase: "P1",
        etape: "Créa",
        tache: "Teaser DOOH",
        startDate: "2026-09-05",
        endDate: "2026-09-15",
      },
      gateway
    );
    const { task: tRemoved } = await createRetroTask(
      prisma,
      project.id,
      {
        phase: "P1",
        etape: "Opt",
        tache: "Tâche Supprimée",
        startDate: "2026-09-01",
        endDate: "2026-09-04",
      },
      gateway
    );

    const snap1 = await createRetroSnapshot(
      prisma,
      project.id,
      async () => gateway,
      { snapshotDate: "2026-09-01", mode: "AUTO_14D" }
    );
    expect(snap1.skipped).toBe(false);
    expect(snap1.fileName).toMatch(/^2026-09-01_Retroplanning_/);

    // Same-day AUTO_14D dedupe skips Drive copy
    const copiesAfter1 = gateway.drive.copyCalls.length;
    const snap1AutoDup = await createRetroSnapshot(
      prisma,
      project.id,
      async () => gateway,
      { snapshotDate: "2026-09-01", mode: "AUTO_14D" }
    );
    expect(snap1AutoDup.skipped).toBe(true);
    expect(gateway.drive.copyCalls.length).toBe(copiesAfter1);

    // Mutate tasks for snap2 (14 days later)
    await updateRetroTask(
      prisma,
      project.id,
      { id: tSlip.id, endDate: "2026-09-17", status: "TERMINE" },
      gateway
    );
    await updateRetroTask(
      prisma,
      project.id,
      { id: tAhead.id, endDate: "2026-09-12" },
      gateway
    );
    await prisma.retroTask.delete({ where: { id: tRemoved.id } });
    await createRetroTask(
      prisma,
      project.id,
      {
        phase: "P2",
        etape: "Bonus",
        tache: "Tâche Ajoutée",
        startDate: "2026-09-10",
        endDate: "2026-09-16",
      },
      gateway
    );

    const snap2 = await createRetroSnapshot(
      prisma,
      project.id,
      async () => gateway,
      { snapshotDate: "2026-09-15", mode: "AUTO_14D" }
    );
    expect(snap2.skipped).toBe(false);

    const diffRes = computeSnapshotDiff(snap1.snapshot, snap2.snapshot);
    const dSlip = diffRes.diffs.find((d) => d.tache === "Validation HUD");
    const dAhead = diffRes.diffs.find((d) => d.tache === "Teaser DOOH");
    const dAdded = diffRes.diffs.find((d) => d.tache === "Tâche Ajoutée");
    const dRemoved = diffRes.diffs.find((d) => d.tache === "Tâche Supprimée");

    expect(dSlip?.deltaDays).toBe(7);
    expect(dSlip?.completed).toBe(true);
    expect(dAhead?.deltaDays).toBe(-3);
    expect(dAdded?.classification).toBe("ADDED");
    expect(dRemoved?.classification).toBe("REMOVED");

    // Foreign snapshot comparison rejected with 404
    const foreignSnap = await createRetroSnapshot(
      prisma,
      foreignProject.id,
      async () => gateway,
      { snapshotDate: "2026-09-01" }
    );
    await expect(
      listAndCompareSnapshots(prisma, project.id, {
        fromId: snap1.snapshot.id,
        toId: foreignSnap.snapshot.id,
      })
    ).rejects.toMatchObject({ httpStatus: 404 });

    // 002.2 snapshot node remains non-EXT-eligible
    const snapNode = await prisma.driveNode.findFirstOrThrow({
      where: { projectId: project.id, driveFileId: snap1.snapshot.driveFileId },
    });
    expect(snapNode.isExtEligible).toBe(false);
  });

  it("blocks foreign CP in live Gmail attachment filenames, deduplicates PENDING proposals, and applies dateless milestones atomically", async () => {
    const baseDouble = createInMemoryGoogleDouble();
    const project = await prisma.project.create({
      data: {
        codeProjet: "326027",
        client: "Caisse d'Épargne Reg",
        nomJeu: "Fortnite Reg",
        isSandbox: true,
      },
    });
    await provisionProjectTree(prisma, baseDouble.drive, project.id);
    await provisionProjectCalendar(prisma, baseDouble.calendar, project.id);

    // 1. Live Gmail veille with foreign CP only in attachments[].filename
    const gatewayWithForeignAtt = {
      ...baseDouble,
      gmail: {
        ...baseDouble.gmail,
        async listMessages() {
          return { messages: [{ id: "msg-att-foreign" }] };
        },
        async getMessage() {
          return {
            id: "msg-att-foreign",
            subject: "Mise à jour planning",
            from: "client@example.com",
            to: "hugo@gamersorigin.com",
            date: new Date().toISOString(),
            snippet: "Bonjour, voici le document en pièce jointe.",
            textBody: "Bonjour, voici le document en pièce jointe.",
            htmlBody: "",
            labelIds: [],
            attachments: [
              {
                attachmentId: "att-1",
                filename: "Facture_CP_326018_Cristaline.pdf",
                mimeType: "application/pdf",
                size: 1024,
              },
            ],
          };
        },
      },
    };

    await expect(
      runRetroVeille(
        prisma,
        gatewayWithForeignAtt,
        createInMemoryGeminiDouble(),
        project.id,
        { includeDrive: false }
      )
    ).rejects.toThrow(CpConflictError);

    const pendingAfterConflict = await prisma.retroProposal.count({
      where: { projectId: project.id, status: "PENDING" },
    });
    expect(pendingAfterConflict).toBe(0);

    const conflictLog = await prisma.auditLog.findFirst({
      where: {
        projectId: project.id,
        action: "CP_CONFLICT_BLOCKED",
        targetId: "msg-att-foreign",
      },
    });
    expect(conflictLog).not.toBeNull();
    expect(conflictLog!.detailsJson).toContain("326018");

    // 2. Deduplicate PENDING proposals across repeated veille runs on identical messages
    const { task: datelessMilestone } = await createRetroTask(
      prisma,
      project.id,
      {
        phase: "Phase 3",
        etape: "Influence",
        tache: "Jalon sans date",
        status: "A_FAIRE",
        isMilestone: true,
        milestoneType: "INFLUENCE",
      },
      baseDouble
    );

    const dedupeGemini: GeminiPort = {
      ...createInMemoryGeminiDouble(),
      async analyzeRetroplanningVeille() {
        return {
          proposals: [
            {
              retroTaskId: datelessMilestone.id,
              taskTitle: datelessMilestone.tache,
              proposedStatus: "EN_COURS",
              proposedStartDate: null,
              proposedEndDate: null,
              deltaDays: 0,
              sourceType: "GMAIL",
              sourceRef: "msg-clean-dedupe",
              summary: "Démarrage jalon sans date",
              detectedCodeProjet: "326027",
              confidence: 0.9,
            },
          ],
        };
      },
    };

    const run1 = await runRetroVeille(
      prisma,
      baseDouble,
      dedupeGemini,
      project.id,
      {
        includeDrive: false,
        emails: [
          {
            id: "msg-clean-dedupe",
            subject: "CP 326027 validation démarrage",
            body: "On démarre la tâche.",
          },
        ],
      }
    );
    expect(run1.proposals).toHaveLength(1);

    const run2 = await runRetroVeille(
      prisma,
      baseDouble,
      dedupeGemini,
      project.id,
      {
        includeDrive: false,
        emails: [
          {
            id: "msg-clean-dedupe",
            subject: "CP 326027 validation démarrage",
            body: "On démarre la tâche.",
          },
        ],
      }
    );
    expect(run2.proposals).toHaveLength(0);

    const pendingTotal = await prisma.retroProposal.count({
      where: {
        projectId: project.id,
        sourceRef: "msg-clean-dedupe",
        status: "PENDING",
      },
    });
    expect(pendingTotal).toBe(1);

    // 3. APPLY on dateless milestone when project.calendarId is set stays atomic (APPLIED, calendarSynced: false)
    const applied = await applyOrDismissProposal(
      prisma,
      project.id,
      run1.proposals[0].id,
      { action: "APPLY" },
      async () => baseDouble
    );
    expect(applied.proposal.status).toBe("APPLIED");
    expect(applied.task?.status).toBe("EN_COURS");
    expect(applied.calendarSynced).toBe(false);
  });
});
