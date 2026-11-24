/**
 * Tier 2 — Boundary, Corner Case & Negative Opaque-Box E2E Tests (E2E-M3: F15–F19)
 * Target count: 30 tests (6 per feature across F15, F16, F17, F18, F19).
 * Connected boundary tests run under TEST_BOUNDARY_HARNESS=1; 412 unconfigured tests
 * run in an isolated sibling test.describe.serial block with afterEach restoreConfigured.
 * Zero src/ or prisma/ imports.
 */

import { expect, test } from "@playwright/test";
import {
  createApiClient,
  type ApiClient,
  type DriveNodeDto,
  type ProjectDto,
  type RetroTaskPayload,
} from "../helpers/api-client";
import {
  assertAuditLogged,
  assertCpConflictBlocked,
  assertPreconditionMissing,
  assertProdUntouched,
  assertSetupPreconditionBanner,
} from "../helpers/assertions";
import {
  BASE_URL,
  CONFLICT_CP_CRISTALINE,
  PROD_IDS,
  PROD_IMMUTABLE_ID_SET,
  uniqueTestCp,
} from "../helpers/constants";

// -----------------------------------------------------------------------------
// Spec-Local Helpers (Opaque-Box, Strict TypeScript)
// -----------------------------------------------------------------------------

const WEEKLY_TITLE_REGEX = /^\d{4}-\d{2}-\d{2}\s*-\s*Weekly\s+.+/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function parseJsonOrArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function extractRetroTasks(data: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(data.tasks)) return asArray(data.tasks);
  if (Array.isArray(data.retroTasks)) return asArray(data.retroTasks);
  if (Array.isArray(data.items)) return asArray(data.items);
  return [];
}

function extractSingleTask(data: Record<string, unknown>): Record<string, unknown> {
  return isRecord(data.task) ? data.task : data;
}

function extractProposals(data: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(data.proposals)) return asArray(data.proposals);
  if (Array.isArray(data.items)) return asArray(data.items);
  return [];
}

function extractSnapshots(data: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(data.snapshots)) return asArray(data.snapshots);
  if (Array.isArray(data.items)) return asArray(data.items);
  return [];
}

function extractCalendarEvents(data: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(data.events)) return asArray(data.events);
  if (Array.isArray(data.calendarEvents)) return asArray(data.calendarEvents);
  return [];
}

function isoDatePrefix(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

async function createProvisionedProject(
  api: ApiClient,
  workerIndex: number,
  suffix = "BVA",
  overrides: { codeProjet?: string; client?: string; nomJeu?: string } = {}
): Promise<{ project: ProjectDto; nodes: DriveNodeDto[] }> {
  const cp = overrides.codeProjet ?? uniqueTestCp(workerIndex);
  const created = await api.createProject({
    codeProjet: cp,
    client: overrides.client ?? `Client ${suffix} ${cp}`,
    nomJeu: overrides.nomJeu ?? `Fortnite ${suffix}`,
    isSandbox: true,
  });
  expect(created.status, `Failed creating project ${cp}: ${JSON.stringify(created.raw)}`).toBe(201);
  const provisioned = await api.provisionDriveTree(created.data.id);
  expect([200, 201]).toContain(provisioned.status);
  const tree = await api.getDriveTree(created.data.id);
  expect(tree.status).toBe(200);
  return { project: created.data, nodes: tree.data };
}

async function seedTask(
  api: ApiClient,
  projectId: string,
  payload: RetroTaskPayload
): Promise<Record<string, unknown>> {
  const res = await api.createRetroTask(projectId, payload);
  expect([200, 201]).toContain(res.status);
  return extractSingleTask(res.data);
}

// -----------------------------------------------------------------------------
// Connected Harness Boundary & Negative Tests (25 tests)
// -----------------------------------------------------------------------------

test.describe("Tier 2 — Connected Harness Tests (E2E-M3: F15–F19)", () => {
  test.beforeEach(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.restoreConfigured();
  });

  // ===========================================================================
  // F15 Boundaries — Bidirectional Gantt View (5 connected + 1 serial 412)
  // ===========================================================================
  test.describe("Tier 2 — F15 Boundaries: Bidirectional Gantt View", () => {
    test("T2-F15-01 Invalid date range (endDate < startDate) and malformed dates rejected with 400", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F15BadDate");

      const valid = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Map",
        tache: "Tâche Valide",
        startDate: "2026-09-10",
        endDate: "2026-09-15",
      });

      await api.harness.resetCalls();

      const inverted = await api.createRetroTask(project.id, {
        phase: "Phase 1",
        etape: "Map",
        tache: "Tâche Inversée",
        startDate: "2026-09-20",
        endDate: "2026-09-10",
      });
      expect(inverted.status).toBe(400);
      expect(inverted.ok).toBe(false);

      const malformed = await api.createRetroTask(project.id, {
        phase: "Phase 1",
        etape: "Map",
        tache: "Date Malformée",
        startDate: "not-a-date",
        endDate: "2026-09-10",
      });
      expect(malformed.status).toBe(400);
      expect(malformed.ok).toBe(false);

      const badPatch = await api.updateRetroTask(project.id, {
        id: String(valid.id),
        endDate: "2020-01-01",
      });
      expect(badPatch.status).toBe(400);

      const retroAfter = await api.getRetroplanning(project.id);
      const tasks = extractRetroTasks(retroAfter.data);
      expect(tasks.length).toBe(1);
      expect(isoDatePrefix(tasks[0].endDate)).toBe("2026-09-15");

      const calls = await api.harness.getCalls();
      const sheetWrites = calls.data.filter((c) =>
        /sheets.*(update|append|write)/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(sheetWrites).toEqual([]);
    });

    test("T2-F15-02 Empty/whitespace phase, etape, tache and invalid status/milestoneType enums return 400", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F15Enums");

      const emptyPhase = await api.createRetroTask(project.id, {
        phase: "   ",
        etape: "Map",
        tache: "Test",
        startDate: "2026-09-01",
        endDate: "2026-09-02",
      });
      expect(emptyPhase.status).toBe(400);

      const emptyEtape = await api.createRetroTask(project.id, {
        phase: "Phase 1",
        etape: "",
        tache: "Test",
        startDate: "2026-09-01",
        endDate: "2026-09-02",
      });
      expect(emptyEtape.status).toBe(400);

      const emptyTache = await api.createRetroTask(project.id, {
        phase: "Phase 1",
        etape: "Map",
        tache: "   ",
        startDate: "2026-09-01",
        endDate: "2026-09-02",
      });
      expect(emptyTache.status).toBe(400);

      const badStatus = await api.createRetroTask(project.id, {
        phase: "Phase 1",
        etape: "Map",
        tache: "Bad Enum",
        startDate: "2026-09-01",
        endDate: "2026-09-02",
        status: "INVALID_STATUS",
      });
      expect(badStatus.status).toBe(400);

      const retro = await api.getRetroplanning(project.id);
      expect(extractRetroTasks(retro.data)).toEqual([]);
    });

    test("T2-F15-03 Concurrent edit / stale version conflict returns 409 without clobbering Sheet 002.1", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F15Conflict");

      const task = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Dev",
        tache: "Tâche Concurrence",
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        status: "A_FAIRE",
      });
      const taskId = String(task.id);
      const staleUpdatedAt =
        typeof task.updatedAt === "string" ? task.updatedAt : "2026-01-01T00:00:00.000Z";
      const staleVersion = typeof task.version === "number" ? task.version : 1;

      const firstCommit = await api.updateRetroTask(project.id, {
        id: taskId,
        endDate: "2026-09-15",
        status: "EN_COURS",
      });
      expect(firstCommit.status).toBe(200);

      await api.harness.resetCalls();

      const stalePatch = await api.requestJson<Record<string, unknown>>(
        "PATCH",
        `/api/projects/${project.id}/retroplanning`,
        {
          data: {
            id: taskId,
            endDate: "2026-09-12",
            expectedUpdatedAt: staleUpdatedAt,
            version: staleVersion,
          },
        }
      );
      expect(stalePatch.status).toBe(409);
      expect(stalePatch.ok).toBe(false);

      const calls = await api.harness.getCalls();
      const sheetWrites = calls.data.filter((c) => {
        const op = String(c.operation ?? c.method ?? "");
        return /sheets.*(update|append|write|batchUpdate|clear)/i.test(op);
      });
      expect(sheetWrites).toEqual([]);

      const retroAfter = await api.getRetroplanning(project.id);
      const persisted = extractRetroTasks(retroAfter.data).find((t) => String(t.id) === taskId);
      expect(isoDatePrefix(persisted?.endDate)).toBe("2026-09-15");
      expect(persisted?.status).toBe("EN_COURS");
    });

    test("T2-F15-04 Cross-project RetroTask IDOR mutation and unknown projectId rejected (403/404)", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project: p1 } = await createProvisionedProject(api, testInfo.workerIndex, "F15Idor1");
      const { project: p2 } = await createProvisionedProject(
        api,
        testInfo.workerIndex + 10,
        "F15Idor2"
      );

      const taskP2 = await seedTask(api, p2.id, {
        phase: "Phase 1",
        etape: "Sec",
        tache: "Tâche Protégée P2",
        startDate: "2026-09-01",
        endDate: "2026-09-05",
        status: "A_FAIRE",
      });

      const idorRes = await api.updateRetroTask(p1.id, {
        id: String(taskP2.id),
        status: "TERMINE",
      });
      expect([403, 404]).toContain(idorRes.status);
      expect(idorRes.ok).toBe(false);

      const p2After = await api.getRetroplanning(p2.id);
      const unchanged = extractRetroTasks(p2After.data).find(
        (t) => String(t.id) === String(taskP2.id)
      );
      expect(unchanged?.status).toBe("A_FAIRE");

      const missingProj = await api.getRetroplanning("nonexistent-project-id-999");
      expect(missingProj.status).toBe(404);
    });

    test("T2-F15-05 Direct write/attach targeting PROD RETROPLANNING CAISSE EPARGNE (1ZG9mRIy...) blocked with 403 + AuditLog", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      await api.harness.resetCalls();

      const createWithProd = await api.createProject({
        codeProjet: uniqueTestCp(testInfo.workerIndex),
        client: "Attaque PROD Retro",
        nomJeu: "Fortnite",
        isSandbox: true,
        retroplanningSheetId: PROD_IDS.PROD_RETROPLANNING_SHEET,
      });
      expect([400, 403]).toContain(createWithProd.status);
      expect(createWithProd.ok).toBe(false);

      const probeRes = await api.harness.probeSandboxWrite({
        operation: "update",
        targetId: PROD_IDS.PROD_RETROPLANNING_SHEET,
      });
      expect(probeRes.status).toBe(403);
      expect(probeRes.ok).toBe(false);

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);

      const audit = await api.listAuditLogs();
      assertAuditLogged(audit, {
        action: /SANDBOX_VIOLATION/i,
        targetId: PROD_IDS.PROD_RETROPLANNING_SHEET,
      });
    });
  });

  // ===========================================================================
  // F16 Boundaries — AI Watch & Proposals (5 connected + 1 serial 412)
  // ===========================================================================
  test.describe("Tier 2 — F16 Boundaries: AI Watch & 1-Click Proposals", () => {
    test("T2-F16-02 Zero-Mix CP conflict guardrail blocks proposal referencing foreign CP 326018", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F16CpGuard");

      const task = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Production",
        tache: "Validation Asset",
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        status: "A_FAIRE",
      });

      const veilleRes = await api.runRetroVeille(project.id, {
        includeDrive: true,
        emails: [
          {
            id: "msg-foreign-cp-326018",
            subject: `Retour ${CONFLICT_CP_CRISTALINE.client} CP ${CONFLICT_CP_CRISTALINE.codeProjet}`,
            body: `Validé pour CP ${CONFLICT_CP_CRISTALINE.codeProjet} ${CONFLICT_CP_CRISTALINE.client} — passer à TERMINE.`,
          },
        ],
      });

      if (!veilleRes.ok) {
        assertCpConflictBlocked(
          veilleRes,
          CONFLICT_CP_CRISTALINE.codeProjet,
          project.codeProjet
        );
      } else {
        const proposals = extractProposals(veilleRes.data);
        const pendingForeign = proposals.filter(
          (p) =>
            p.status === "PENDING" &&
            JSON.stringify(p).includes(CONFLICT_CP_CRISTALINE.codeProjet)
        );
        expect(pendingForeign).toEqual([]);

        const blocked = asArray(veilleRes.data.blockedConflicts);
        const quarantined = proposals.find((p) =>
          /CONFLICT_BLOCKED|QUARANTINED|CP_CONFLICT/i.test(String(p.status ?? ""))
        );
        expect(blocked.length > 0 || quarantined !== undefined).toBe(true);

        if (quarantined?.id) {
          const tryApply = await api.applyRetroProposal(project.id, String(quarantined.id), {
            action: "APPLY",
          });
          assertCpConflictBlocked(tryApply, CONFLICT_CP_CRISTALINE.codeProjet, project.codeProjet);
        }
      }

      const retroAfter = await api.getRetroplanning(project.id);
      const persistedTask = extractRetroTasks(retroAfter.data).find(
        (t) => String(t.id) === String(task.id)
      );
      expect(persistedTask?.status).toBe("A_FAIRE");

      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit, {
        action: /CP_CONFLICT/i,
        detailsContain: CONFLICT_CP_CRISTALINE.codeProjet,
      });
    });

    test("T2-F16-03 Re-applying or dismissing an already APPLIED proposal is rejected idempotently", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F16Idemp");

      const task = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Créa",
        tache: "Bannière Twitch",
        startDate: "2026-09-01",
        endDate: "2026-09-08",
        status: "A_FAIRE",
      });

      const veilleRes = await api.runRetroVeille(project.id, {
        emails: [
          {
            id: "msg-idemp-1",
            subject: `CP ${project.codeProjet} - Bannière Twitch OK`,
            body: `Tâche ${String(task.id)} validée -> TERMINE.`,
          },
        ],
      });
      expect(veilleRes.status).toBe(200);
      const proposalId = String(extractProposals(veilleRes.data)[0].id);

      const firstApply = await api.applyRetroProposal(project.id, proposalId, { action: "APPLY" });
      expect(firstApply.status).toBe(200);

      const secondApply = await api.applyRetroProposal(project.id, proposalId, { action: "APPLY" });
      expect([400, 409]).toContain(secondApply.status);
      expect(secondApply.ok).toBe(false);

      const dismissAfterApply = await api.applyRetroProposal(project.id, proposalId, {
        action: "DISMISS",
      });
      expect([400, 409]).toContain(dismissAfterApply.status);
    });

    test("T2-F16-04 Cross-project proposal isolation prevents Project B from applying Project A proposal", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project: pA } = await createProvisionedProject(api, testInfo.workerIndex, "F16IsoA");
      const { project: pB } = await createProvisionedProject(
        api,
        testInfo.workerIndex + 10,
        "F16IsoB"
      );

      const taskA = await seedTask(api, pA.id, {
        phase: "Phase 1",
        etape: "Map",
        tache: "Tâche Projet A",
        startDate: "2026-09-01",
        endDate: "2026-09-05",
      });

      const veilleA = await api.runRetroVeille(pA.id, {
        emails: [
          {
            id: "msg-iso-a",
            subject: `CP ${pA.codeProjet} - Retour Map`,
            body: `Passer ${String(taskA.id)} à TERMINE.`,
          },
        ],
      });
      expect(veilleA.status).toBe(200);
      const proposalAId = String(extractProposals(veilleA.data)[0].id);

      const crossApply = await api.applyRetroProposal(pB.id, proposalAId, { action: "APPLY" });
      expect([403, 404]).toContain(crossApply.status);
      expect(crossApply.ok).toBe(false);

      const retroA = await api.getRetroplanning(pA.id);
      const propA = extractProposals(retroA.data).find((p) => String(p.id) === proposalAId);
      expect(propA?.status).toBe("PENDING");
    });

    test("T2-F16-05 Invalid action, malformed proposedEndDate, or invalid proposedStatus on apply returns 400", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F16BadApply");

      const task = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Créa",
        tache: "Teaser Social",
        startDate: "2026-09-01",
        endDate: "2026-09-08",
        status: "A_FAIRE",
      });

      const veilleRes = await api.runRetroVeille(project.id, {
        emails: [
          {
            id: "msg-bad-apply",
            subject: `CP ${project.codeProjet} - Teaser Social`,
            body: `Mise à jour sur ${String(task.id)}.`,
          },
        ],
      });
      expect(veilleRes.status).toBe(200);
      const proposalId = String(extractProposals(veilleRes.data)[0].id);

      const badAction = await api.requestJson(
        "POST",
        `/api/projects/${project.id}/retroplanning/proposals/${proposalId}/apply`,
        { data: { action: "DELETE_ALL" } }
      );
      expect(badAction.status).toBe(400);

      const badDate = await api.requestJson(
        "POST",
        `/api/projects/${project.id}/retroplanning/proposals/${proposalId}/apply`,
        { data: { action: "APPLY", proposedEndDate: "not-a-valid-date" } }
      );
      expect(badDate.status).toBe(400);

      const badStatus = await api.requestJson(
        "POST",
        `/api/projects/${project.id}/retroplanning/proposals/${proposalId}/apply`,
        { data: { action: "APPLY", proposedStatus: "UNKNOWN_STATUS" } }
      );
      expect(badStatus.status).toBe(400);

      const retroAfter = await api.getRetroplanning(project.id);
      const prop = extractProposals(retroAfter.data).find((p) => String(p.id) === proposalId);
      expect(prop?.status).toBe("PENDING");
    });

    test("T2-F16-06 Empty veille input returns empty proposals without dummy invention & cron rejects invalid secret", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F16Empty");

      const emptyVeille = await api.runRetroVeille(project.id, {
        includeDrive: true,
        emails: [],
        driveFiles: [],
      });
      expect(emptyVeille.status).toBe(200);
      expect(extractProposals(emptyVeille.data)).toEqual([]);

      await api.harness.setState({ cronSecret: "strict-m3-cron-secret" });
      const unauthorizedCron = await api.triggerSchedulerJob("RETRO_VEILLE", project.id, {
        "x-cron-secret": "wrong-secret",
      });
      expect([401, 403]).toContain(unauthorizedCron.status);
    });
  });

  // ===========================================================================
  // F17 Boundaries — 14-Day Snapshots & Drift Comparator (5 connected + 1 serial 412)
  // ===========================================================================
  test.describe("Tier 2 — F17 Boundaries: 14-Day Snapshots & Drift Comparator", () => {
    test("T2-F17-01 Same-day and <14-day automatic scheduler deduplication guard prevents duplicate snapshots", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F17Dedupe");

      await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Setup",
        tache: "Tâche Dedupe",
        startDate: "2026-09-01",
        endDate: "2026-09-10",
      });

      await api.harness.resetCalls();
      const run1 = await api.triggerSchedulerJob("RETRO_SNAPSHOT_14D", project.id);
      expect(run1.status).toBe(200);

      const run2 = await api.triggerSchedulerJob("RETRO_SNAPSHOT_14D", project.id);
      expect(run2.status).toBe(200);

      const listRes = await api.listRetroSnapshots(project.id);
      expect(listRes.status).toBe(200);
      expect(extractSnapshots(listRes.data).length).toBe(1);

      const calls = await api.harness.getCalls();
      const copyCalls = calls.data.filter((c) =>
        /copy/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(copyCalls.length).toBe(1);

      // Verify < 14 days elapsed interval deduplication (3 days ago -> skipped)
      const { project: pRecent } = await createProvisionedProject(
        api,
        testInfo.workerIndex + 10,
        "F17Recent"
      );
      await seedTask(api, pRecent.id, {
        phase: "Phase 1",
        etape: "Setup",
        tache: "Tâche Récente 3j",
        startDate: "2026-09-01",
        endDate: "2026-09-10",
      });
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const seedRecent = await api.createRetroSnapshot(pRecent.id, {
        snapshotDate: threeDaysAgo,
      });
      expect([200, 201]).toContain(seedRecent.status);

      await api.harness.resetCalls();
      const runRecent = await api.triggerSchedulerJob("RETRO_SNAPSHOT_14D", pRecent.id);
      expect(runRecent.status).toBe(200);

      const recentList = await api.listRetroSnapshots(pRecent.id);
      expect(recentList.status).toBe(200);
      expect(extractSnapshots(recentList.data).length).toBe(1);

      const recentCalls = await api.harness.getCalls();
      const recentCopies = recentCalls.data.filter((c) =>
        /copy/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(recentCopies.length).toBe(0);
    });

    test("T2-F17-02 Explicit manual snapshot succeeds even when automatic snapshot already exists today", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F17Manual");

      const task = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Dev",
        tache: "Tâche Evolutive",
        startDate: "2026-09-01",
        endDate: "2026-09-10",
      });

      const autoRun = await api.triggerSchedulerJob("RETRO_SNAPSHOT_14D", project.id);
      expect(autoRun.status).toBe(200);

      await api.updateRetroTask(project.id, { id: String(task.id), endDate: "2026-09-14" });
      const manualSnap = await api.createRetroSnapshot(project.id, {});
      expect([200, 201]).toContain(manualSnap.status);

      const listRes = await api.listRetroSnapshots(project.id);
      expect(extractSnapshots(listRes.data).length).toBe(2);
    });

    test("T2-F17-03 Empty (0 snapshots) and single-snapshot (1 snapshot) boundaries render cleanly without NaN or 500", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project: pEmpty } = await createProvisionedProject(
        api,
        testInfo.workerIndex,
        "F17Zero"
      );
      const { project: pOne } = await createProvisionedProject(
        api,
        testInfo.workerIndex + 10,
        "F17One"
      );

      await seedTask(api, pOne.id, {
        phase: "Phase 1",
        etape: "Init",
        tache: "Seule tâche",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      });
      await api.createRetroSnapshot(pOne.id, { snapshotDate: "2026-09-01" });

      const res0 = await api.listRetroSnapshots(pEmpty.id);
      const res1 = await api.listRetroSnapshots(pOne.id);
      expect(res0.status).toBe(200);
      expect(res1.status).toBe(200);
      expect(extractSnapshots(res0.data)).toEqual([]);
      expect(extractSnapshots(res1.data).length).toBe(1);

      const ui0 = await page.goto(`${BASE_URL}/retroplanning?projectId=${pEmpty.id}`);
      expect(ui0?.status()).toBe(200);
      await expect(page.locator("body")).not.toContainText("NaN");

      const ui1 = await page.goto(`${BASE_URL}/retroplanning?projectId=${pOne.id}`);
      expect(ui1?.status()).toBe(200);
      await expect(page.locator("body")).not.toContainText("NaN");
    });

    test("T2-F17-04 Invalid, cross-project IDOR, and same-ID snapshot comparisons handled safely", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project: p1 } = await createProvisionedProject(api, testInfo.workerIndex, "F17Cmp1");
      const { project: p2 } = await createProvisionedProject(
        api,
        testInfo.workerIndex + 10,
        "F17Cmp2"
      );

      await seedTask(api, p1.id, {
        phase: "P1",
        etape: "E1",
        tache: "T1",
        startDate: "2026-09-01",
        endDate: "2026-09-05",
      });
      await seedTask(api, p2.id, {
        phase: "P2",
        etape: "E2",
        tache: "Secret P2 Task",
        startDate: "2026-09-01",
        endDate: "2026-09-05",
      });

      const s1 = await api.createRetroSnapshot(p1.id, { snapshotDate: "2026-09-01" });
      expect([200, 201]).toContain(s1.status);
      const s2 = await api.createRetroSnapshot(p2.id, { snapshotDate: "2026-09-01" });
      expect([200, 201]).toContain(s2.status);
      const s1Obj = isRecord(s1.data.snapshot) ? s1.data.snapshot : s1.data;
      const s2Obj = isRecord(s2.data.snapshot) ? s2.data.snapshot : s2.data;
      expect(s1Obj.id).toBeTruthy();
      expect(s2Obj.id).toBeTruthy();
      const s1Id = String(s1Obj.id);
      const s2Id = String(s2Obj.id);

      const missingCmp = await api.listRetroSnapshots(p1.id, {
        fromId: "nonexistent-snap-999",
        toId: s1Id,
      });
      expect([400, 404]).toContain(missingCmp.status);

      const idorCmp = await api.listRetroSnapshots(p1.id, { fromId: s1Id, toId: s2Id });
      expect([403, 404]).toContain(idorCmp.status);
      expect(JSON.stringify(idorCmp.raw)).not.toContain("Secret P2 Task");

      const sameCmp = await api.listRetroSnapshots(p1.id, { fromId: s1Id, toId: s1Id });
      expect([200, 400]).toContain(sameCmp.status);
      if (sameCmp.status === 200) {
        const cmpObj = isRecord(sameCmp.data.comparison) ? sameCmp.data.comparison : sameCmp.data;
        const diffs = asArray(cmpObj.diffs ?? cmpObj.items);
        for (const d of diffs) {
          expect(d.deltaDays).toBe(0);
        }
      }
    });

    test("T2-F17-05 Invalid snapshotDate format rejected with 400 without Drive copy side effects", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F17BadDate");
      await api.harness.resetCalls();

      const bad1 = await api.createRetroSnapshot(project.id, { snapshotDate: "99-99-not-a-date" });
      expect(bad1.status).toBe(400);

      const bad2 = await api.createRetroSnapshot(project.id, { snapshotDate: "2026-02-30" });
      expect(bad2.status).toBe(400);

      const listRes = await api.listRetroSnapshots(project.id);
      expect(extractSnapshots(listRes.data)).toEqual([]);

      const calls = await api.harness.getCalls();
      const copyCalls = calls.data.filter((c) =>
        /copy/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(copyCalls).toEqual([]);
    });
  });

  // ===========================================================================
  // F18 Boundaries — Dedicated Calendar & Cascades (5 connected + 1 serial 412)
  // ===========================================================================
  test.describe("Tier 2 — F18 Boundaries: Dedicated Calendar & Cascading Milestones", () => {
    test("T2-F18-02 Primary calendar and unregistered foreign calendarId blocked with 403 SANDBOX_VIOLATION", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F18Primary");
      const foreignCalendarId = "foreign-cal-999@group.calendar.google.com";

      const primaryAttempt = await api.createCalendarResource(project.id, {
        calendarId: "primary",
        targetCalendarId: "primary",
      });
      if (!primaryAttempt.ok) {
        expect([400, 403]).toContain(primaryAttempt.status);
      } else {
        expect(primaryAttempt.data.calendarId).not.toBe("primary");
      }

      const foreignAttempt = await api.createCalendarResource(project.id, {
        calendarId: foreignCalendarId,
        targetCalendarId: foreignCalendarId,
      });
      if (!foreignAttempt.ok) {
        expect([400, 403]).toContain(foreignAttempt.status);
      } else {
        expect(foreignAttempt.data.calendarId).not.toBe(foreignCalendarId);
      }

      const probePrimary = await api.harness.probeSandboxWrite({
        operation: "create",
        targetId: "primary",
        projectId: project.id,
      });
      expect(probePrimary.status).toBe(403);
      expect(String(probePrimary.error?.code ?? "")).toMatch(/SANDBOX_VIOLATION/i);

      const probeForeign = await api.harness.probeSandboxWrite({
        operation: "update",
        targetId: foreignCalendarId,
        projectId: project.id,
      });
      expect(probeForeign.status).toBe(403);
      expect(String(probeForeign.error?.code ?? "")).toMatch(/SANDBOX_VIOLATION/i);

      const calAfter = await api.getCalendar(project.id);
      expect(calAfter.data.calendarId).not.toBe("primary");
      expect(calAfter.data.calendarId).not.toBe(foreignCalendarId);

      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit.data, { action: /SANDBOX_VIOLATION/i });
    });

    test("T2-F18-03 Invalid milestoneType, invalid anchorDate, and null-date milestone handled safely", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F18BadCal");
      await api.createCalendarResource(project.id, {});

      const badType = await api.syncCalendarCascades(project.id, {
        milestoneType: "INVALID_TYPE",
        anchorDate: "2026-12-20",
      });
      expect(badType.status).toBe(400);

      const badDate = await api.syncCalendarCascades(project.id, {
        milestoneType: "INFLUENCE",
        anchorDate: "2026-99-99",
      });
      expect(badDate.status).toBe(400);
      expect(JSON.stringify(badDate.raw)).not.toMatch(/Invalid Date/i);

      const missingAnchor = await api.syncCalendarCascades(project.id, {
        milestoneType: "INFLUENCE",
      });
      expect(missingAnchor.status).toBe(400);
      expect(JSON.stringify(missingAnchor.raw)).not.toMatch(/Invalid Date/i);

      const nullDateTaskRes = await api.requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${project.id}/retroplanning`,
        {
          data: {
            phase: "P3",
            etape: "Inf",
            tache: "Jalon Sans Date",
            startDate: null,
            endDate: null,
            isMilestone: true,
            milestoneType: "INFLUENCE",
          },
        }
      );
      expect(nullDateTaskRes.status).not.toBe(500);
      if (nullDateTaskRes.ok) {
        const nullTask = extractSingleTask(nullDateTaskRes.data);
        expect(nullTask.id).toBeTruthy();
        const nullSync = await api.syncCalendarCascades(project.id, {
          retroTaskId: String(nullTask.id),
        });
        expect(nullSync.status).not.toBe(500);
        expect([200, 400]).toContain(nullSync.status);
        expect(JSON.stringify(nullSync.raw)).not.toMatch(/Invalid Date/i);
      } else {
        expect(nullDateTaskRes.status).toBe(400);
      }

      const calAfter = await api.getCalendar(project.id);
      expect(extractCalendarEvents(calAfter.data)).toEqual([]);
    });

    test("T2-F18-04 Cross-project calendar & cascade isolation prevents foreign retroTaskId sync", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project: pA } = await createProvisionedProject(api, testInfo.workerIndex, "F18IsoA");
      const { project: pB } = await createProvisionedProject(
        api,
        testInfo.workerIndex + 10,
        "F18IsoB"
      );

      await api.createCalendarResource(pA.id, {});
      await api.createCalendarResource(pB.id, {});

      const mA = await seedTask(api, pA.id, {
        phase: "P3",
        etape: "Inf",
        tache: "Jalon Influence P-A",
        startDate: "2026-12-20T12:00:00.000Z",
        endDate: "2026-12-20T12:00:00.000Z",
        isMilestone: true,
        milestoneType: "INFLUENCE",
      });
      const mB = await seedTask(api, pB.id, {
        phase: "P1",
        etape: "W",
        tache: "Jalon Weekly P-B",
        startDate: "2026-12-11T12:00:00.000Z",
        endDate: "2026-12-11T12:00:00.000Z",
        isMilestone: true,
        milestoneType: "WEEKLY",
      });

      await api.syncCalendarCascades(pA.id, { retroTaskId: String(mA.id) });
      await api.syncCalendarCascades(pB.id, { retroTaskId: String(mB.id) });

      const crossSync = await api.syncCalendarCascades(pB.id, {
        retroTaskId: String(mA.id),
      });
      expect([403, 404]).toContain(crossSync.status);

      const calB = extractCalendarEvents((await api.getCalendar(pB.id)).data);
      expect(calB.length).toBe(2);
      expect(JSON.stringify(calB)).not.toContain("Jalon Influence P-A");
    });

    test("T2-F18-05 Un-marking or cancelling a milestone cleans up or cancels linked CalendarEvents", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F18Cancel");
      await api.createCalendarResource(project.id, {});

      const milestone = await seedTask(api, project.id, {
        phase: "P3",
        etape: "Inf",
        tache: "Jalon Annulable",
        startDate: "2026-12-20T12:00:00.000Z",
        endDate: "2026-12-20T12:00:00.000Z",
        isMilestone: true,
        milestoneType: "INFLUENCE",
      });
      const milestoneId = String(milestone.id);

      await api.syncCalendarCascades(project.id, { retroTaskId: milestoneId });
      expect(extractCalendarEvents((await api.getCalendar(project.id)).data).length).toBe(4);

      const unmark = await api.updateRetroTask(project.id, {
        id: milestoneId,
        isMilestone: false,
      });
      expect(unmark.status).toBe(200);

      await api.syncCalendarCascades(project.id, { retroTaskId: milestoneId });
      const remaining = extractCalendarEvents((await api.getCalendar(project.id)).data);
      const activeScheduled = remaining.filter((e) => e.status !== "CANCELLED");
      expect(activeScheduled.length).toBe(0);
    });

    test("T2-F18-06 Missing calendarId fails cleanly (400/412) and year-boundary rollover computes exact dates", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F18Rollover");

      const milestone = await seedTask(api, project.id, {
        phase: "P2",
        etape: "Lancement",
        tache: "Lancement Map Nouvel An",
        startDate: "2027-01-02T12:00:00.000Z",
        endDate: "2027-01-02T12:00:00.000Z",
        isMilestone: true,
        milestoneType: "LANCEMENT_MAP",
      });

      const noCalSync = await api.syncCalendarCascades(project.id, {
        retroTaskId: String(milestone.id),
      });
      expect([400, 412]).toContain(noCalSync.status);
      expect(noCalSync.ok).toBe(false);

      const createdCal = await api.createCalendarResource(project.id, {});
      expect([200, 201]).toContain(createdCal.status);

      const rolloverSync = await api.syncCalendarCascades(project.id, {
        retroTaskId: String(milestone.id),
      });
      expect(rolloverSync.status).toBe(200);

      const events = extractCalendarEvents((await api.getCalendar(project.id)).data);
      const dates = events.map((e) => isoDatePrefix(e.startAt)).sort();
      expect(dates).toEqual(["2026-12-19", "2026-12-28", "2026-12-31", "2027-01-02"]);
    });
  });

  // ===========================================================================
  // F19 Boundaries — Weekly Generator (5 connected + 1 serial 412)
  // ===========================================================================
  test.describe("Tier 2 — F19 Boundaries: Weekly Client Generator", () => {
    test("T2-F19-01 Graceful handling when 004. Production has zero PNG/JPG visuals", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F19NoImg");

      const genRes = await api.generateWeekly(project.id, {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
        nextStepsClient: ["Validation planning"],
        nextStepsGo: ["Suite production"],
      });
      expect([200, 201]).toContain(genRes.status);

      const weekly = isRecord(genRes.data.weekly) ? genRes.data.weekly : genRes.data;
      expect(String(weekly.slidesFileId ?? "").length).toBeGreaterThan(0);
      expect(String(weekly.gmailDraftId ?? "").length).toBeGreaterThan(0);
      expect(parseJsonOrArray(weekly.visualsDriveIdsJson ?? weekly.visualsDriveIds)).toEqual([]);
    });

    test("T2-F19-02 Graceful handling when J-7 -> J window has zero tasks and empty next steps", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F19EmptyWin", {
        client: "Caisse d'Épargne",
        nomJeu: "Fortnite",
      });

      const genRes = await api.generateWeekly(project.id, {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
        nextStepsClient: [],
        nextStepsGo: [],
      });
      expect([200, 201]).toContain(genRes.status);

      const weekly = isRecord(genRes.data.weekly) ? genRes.data.weekly : genRes.data;
      expect(String(weekly.title ?? "")).toMatch(WEEKLY_TITLE_REGEX);
      expect(parseJsonOrArray(weekly.collectedTasksJson ?? weekly.collectedTasks)).toEqual([]);
      expect(JSON.stringify(weekly)).not.toContain("NaN");
    });

    test("T2-F19-03 Invalid date window (weekEnd < weekStart) and malformed dates rejected without side effects", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F19BadDates");
      await api.harness.resetCalls();

      const inverted = await api.generateWeekly(project.id, {
        weekStart: "2026-09-18",
        weekEnd: "2026-09-11",
      });
      expect([400, 422]).toContain(inverted.status);
      expect(inverted.ok).toBe(false);

      const malformed = await api.generateWeekly(project.id, {
        weekStart: "invalid-date",
        weekEnd: "2026-09-11",
      });
      expect([400, 422]).toContain(malformed.status);

      const calls = await api.harness.getCalls();
      const mutations = calls.data.filter((c) =>
        /slides|gmail|draft|copy/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(mutations).toEqual([]);
      expect((await api.listWeeklys(project.id)).data).toEqual([]);
    });

    test("T2-F19-05 Cross-project visual injection rejected/stripped and PROD Weekly Slides untouched", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project: p1 } = await createProvisionedProject(api, testInfo.workerIndex, "F19Vis1");
      const { project: p2 } = await createProvisionedProject(
        api,
        testInfo.workerIndex + 10,
        "F19Vis2"
      );

      const foreignVisual = await api.harness.seedDriveNode({
        projectId: p2.id,
        parentCode: "004.2",
        name: "foreign-p2-secret.png",
        mimeType: "image/png",
        validationStatus: "BROUILLON_INTERNE",
        isFolder: false,
      });
      expect([200, 201]).toContain(foreignVisual.status);
      expect(foreignVisual.data.id).toBeTruthy();

      await api.harness.resetCalls();
      const res = await api.generateWeekly(p1.id, {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
        visualDriveIds: [foreignVisual.data.id],
      });

      if (!res.ok) {
        expect([400, 403, 404]).toContain(res.status);
      } else {
        const weekly = isRecord(res.data.weekly) ? res.data.weekly : res.data;
        const visuals = parseJsonOrArray(weekly.visualsDriveIdsJson ?? weekly.visualsDriveIds);
        expect(JSON.stringify(visuals)).not.toContain(foreignVisual.data.id);
      }

      const probeProd = await api.harness.probeSandboxWrite({
        operation: "update",
        targetId: PROD_IDS.PROD_WEEKLY_SLIDES,
      });
      expect(probeProd.status).toBe(403);

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);
      expect(PROD_IMMUTABLE_ID_SET.has(PROD_IDS.PROD_WEEKLY_SLIDES)).toBe(true);
    });

    test("T2-F19-06 Non-image files (.pdf, .mp4) in 004. excluded from visuals and unknown projectId returns 404", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F19NonImg");

      const pdfNode = await api.harness.seedDriveNode({
        projectId: project.id,
        parentCode: "004.2",
        name: "spec-technique.pdf",
        mimeType: "application/pdf",
        isFolder: false,
      });
      expect([200, 201]).toContain(pdfNode.status);
      expect(pdfNode.data.id).toBeTruthy();
      const mp4Node = await api.harness.seedDriveNode({
        projectId: project.id,
        parentCode: "004.4",
        name: "teaser-video.mp4",
        mimeType: "video/mp4",
        isFolder: false,
      });
      expect([200, 201]).toContain(mp4Node.status);
      expect(mp4Node.data.id).toBeTruthy();

      const genRes = await api.generateWeekly(project.id, {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
      });
      expect([200, 201]).toContain(genRes.status);

      const weekly = isRecord(genRes.data.weekly) ? genRes.data.weekly : genRes.data;
      const visualsStr = JSON.stringify(
        parseJsonOrArray(weekly.visualsDriveIdsJson ?? weekly.visualsDriveIds)
      );
      expect(visualsStr).not.toContain(pdfNode.data.id);
      expect(visualsStr).not.toContain(mp4Node.data.id);

      const missingProj = await api.generateWeekly("nonexistent-project-id-999", {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
      });
      expect(missingProj.status).toBe(404);
    });
  });
});

// -----------------------------------------------------------------------------
// Unconfigured 412 Precondition Tests (5 tests — 1 per feature F15–F19)
// Isolated serial block so restoreConfigured from Connected block never overrides.
// -----------------------------------------------------------------------------

test.describe.serial("Tier 2 — Unconfigured 412 Precondition Tests (E2E-M3: F15–F19)", () => {
  test.beforeEach(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.setUnconfigured({ google: true, gemini: true });
  });

  test.afterEach(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.restoreConfigured();
  });

  test("T2-F15-06 Missing Google OAuth2 returns 412 GOOGLE_NOT_CONNECTED on Sheet sync/export with zero dummy tasks", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const proj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "F15 Unconfigured",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    expect(proj.status).toBe(201);

    const syncRes = await api.requestJson(
      "GET",
      `/api/projects/${proj.data.id}/retroplanning?syncFromSheet=1`
    );
    assertPreconditionMissing(syncRes, "GOOGLE_NOT_CONNECTED");

    const exportRes = await api.exportRetroplanningOnce(proj.data.id, {
      explicitManualExportConfirm: true,
    });
    assertPreconditionMissing(exportRes, "GOOGLE_NOT_CONNECTED");

    await page.goto(`${BASE_URL}/retroplanning?projectId=${proj.data.id}`);
    await assertSetupPreconditionBanner(page);
    await expect(page.locator("body")).not.toContainText("DUMMY");
  });

  test("T2-F16-01 Missing Google OAuth2 or Gemini API key returns 412 on veille with /settings banner", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const proj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "F16 Unconfigured",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    expect(proj.status).toBe(201);

    const noGoogle = await api.runRetroVeille(proj.data.id);
    assertPreconditionMissing(noGoogle, "GOOGLE_NOT_CONNECTED");

    await api.harness.setState({
      googleConnected: true,
      googleClientConfigured: true,
      geminiConfigured: false,
    });
    const noGemini = await api.runRetroVeille(proj.data.id);
    assertPreconditionMissing(noGemini, "GEMINI_KEY_MISSING");

    const retro = await api.getRetroplanning(proj.data.id);
    expect(extractProposals(retro.data)).toEqual([]);

    await page.goto(`${BASE_URL}/retroplanning?projectId=${proj.data.id}`);
    const veilleBtn = page.locator("button").filter({ hasText: /Veille/i }).first();
    if (await veilleBtn.isVisible()) {
      await veilleBtn.click();
    }
    await assertSetupPreconditionBanner(page);
  });

  test("T2-F17-06 Missing Google OAuth2 returns 412 GOOGLE_NOT_CONNECTED on snapshot creation with zero orphan DB rows", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const proj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "F17 Unconfigured",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    expect(proj.status).toBe(201);

    const snapRes = await api.createRetroSnapshot(proj.data.id, { snapshotDate: "2026-09-01" });
    assertPreconditionMissing(snapRes, "GOOGLE_NOT_CONNECTED");

    const listRes = await api.listRetroSnapshots(proj.data.id);
    expect(listRes.status).toBe(200);
    expect(extractSnapshots(listRes.data)).toEqual([]);
  });

  test("T2-F18-01 Missing Google Calendar OAuth2 returns 412 GOOGLE_NOT_CONNECTED and keeps calendarId null", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const proj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "F18 Unconfigured",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    expect(proj.status).toBe(201);

    const calCreate = await api.createCalendarResource(proj.data.id, {});
    assertPreconditionMissing(calCreate, "GOOGLE_NOT_CONNECTED");

    const calSync = await api.syncCalendarCascades(proj.data.id, {});
    assertPreconditionMissing(calSync, "GOOGLE_NOT_CONNECTED");

    const calGet = await api.getCalendar(proj.data.id);
    expect(calGet.data.calendarId ?? null).toBeNull();
    expect(extractCalendarEvents(calGet.data)).toEqual([]);

    await page.goto(`${BASE_URL}/calendar?projectId=${proj.data.id}`);
    const createBtn = page
      .locator("button")
      .filter({ hasText: /Cr[ée]er.*calendrier|Initialiser/i })
      .first();
    if (await createBtn.isVisible()) {
      await createBtn.click();
    }
    await assertSetupPreconditionBanner(page);
  });

  test("T2-F19-04 Missing Google OAuth2 returns 412 GOOGLE_NOT_CONNECTED on Weekly generation and /weeklys UI", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const proj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "F19 Unconfigured",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    expect(proj.status).toBe(201);

    const genRes = await api.generateWeekly(proj.data.id, {
      weekStart: "2026-09-04",
      weekEnd: "2026-09-11",
    });
    assertPreconditionMissing(genRes, "GOOGLE_NOT_CONNECTED");

    const listRes = await api.listWeeklys(proj.data.id);
    expect(listRes.status).toBe(200);
    expect(listRes.data).toEqual([]);

    await page.goto(`${BASE_URL}/weeklys?projectId=${proj.data.id}`);
    const genBtn = page
      .locator("button")
      .filter({ hasText: /G[ée]n[ée]rer.*Weekly|Cr[ée]er.*Weekly/i })
      .first();
    if (await genBtn.isVisible()) {
      await genBtn.click();
    }
    await assertSetupPreconditionBanner(page);
  });
});
