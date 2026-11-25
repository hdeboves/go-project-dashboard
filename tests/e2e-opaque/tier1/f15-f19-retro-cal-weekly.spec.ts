/**
 * Tier 1 — Isolated Happy-Path Opaque-Box E2E Tests (E2E-M3: F15–F19)
 * Target count: 30 tests (6 per feature across F15, F16, F17, F18, F19).
 * Exercises /retroplanning, /calendar, /weeklys UI routes and M3 HTTP APIs
 * under TEST_BOUNDARY_HARNESS=1. Zero src/ or prisma/ imports.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  createApiClient,
  type ApiClient,
  type DriveNodeDto,
  type ProjectDto,
  type RetroTaskPayload,
} from "../helpers/api-client";
import {
  assertAuditLogged,
  assertProdUntouched,
  assertRetroplanningNeverAutoSyncedToExt,
} from "../helpers/assertions";
import {
  BASE_URL,
  CASCADE_OFFSETS,
  PILOT_PROJECT,
  PROD_IDS,
  PROD_IMMUTABLE_ID_SET,
  RETRO_COLUMNS,
  RETRO_SHEET_TAB,
  RETRO_SNAPSHOT_NAME_REGEX,
  uniqueTestCp,
} from "../helpers/constants";
import { WEEKLY_VISUAL_PNG_BUFFER } from "../fixtures/reporting-data";

// -----------------------------------------------------------------------------
// Spec-Local Helpers & Types (Opaque-Box, Strict TypeScript)
// -----------------------------------------------------------------------------

const WEEKLY_TITLE_REGEX = /^\d{4}-\d{2}-\d{2}\s*-\s*Weekly\s+.+/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  return [];
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
  if (isRecord(data.task)) return data.task;
  return data;
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

function shiftIsoDate(isoDate: string, offsetDays: number): string {
  const datePart = isoDate.slice(0, 10);
  const [y, m, d] = datePart.split("-").map((v) => Number.parseInt(v, 10));
  const utc = new Date(Date.UTC(y, m - 1, d + offsetDays, 12, 0, 0));
  return utc.toISOString().slice(0, 10);
}

function isoDatePrefix(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.slice(0, 10);
}

function findNodeByCode(nodes: DriveNodeDto[], code: string): DriveNodeDto | undefined {
  return nodes.find((n) => n.code === code || n.name.startsWith(code));
}

function attachBrowserErrorCollectors(page: Page): {
  pageErrors: string[];
  consoleErrors: string[];
} {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  return { pageErrors, consoleErrors };
}

function assertGmailDraftNotSent(calls: Record<string, unknown>[]): void {
  const sendCalls = calls.filter((c) => {
    const op = String(c.operation ?? c.method ?? "");
    return /gmail.*send|messages\.send|sendMessage/i.test(op);
  });
  expect(sendCalls, "Weekly generator must NEVER auto-send Gmail messages").toEqual([]);

  const draftCalls = calls.filter((c) => {
    const op = String(c.operation ?? c.method ?? "");
    return /draft|drafts\.create|createDraft/i.test(op);
  });
  expect(draftCalls.length, "Expected at least one Gmail drafts.create call").toBeGreaterThanOrEqual(
    1
  );
  for (const draftCall of draftCalls) {
    expect(draftCall.sent).not.toBe(true);
  }
}

async function createProvisionedProject(
  api: ApiClient,
  workerIndex: number,
  suffix = "M3",
  overrides: { client?: string; nomJeu?: string } = {}
): Promise<{ project: ProjectDto; nodes: DriveNodeDto[] }> {
  const cp = uniqueTestCp(workerIndex);
  const created = await api.createProject({
    codeProjet: cp,
    client: overrides.client ?? `Caisse d'Épargne ${suffix}`,
    nomJeu: overrides.nomJeu ?? `Fortnite ${suffix}`,
    isSandbox: true,
  });
  expect(created.status, `Failed creating project ${cp}: ${JSON.stringify(created.raw)}`).toBe(201);
  const project = created.data;
  expect(project.id).toBeTruthy();

  const provisioned = await api.provisionDriveTree(project.id);
  expect([200, 201]).toContain(provisioned.status);

  const treeRes = await api.getDriveTree(project.id);
  expect(treeRes.status).toBe(200);

  const listed = await api.listProjects();
  const refreshedProject =
    listed.ok && Array.isArray(listed.data)
      ? listed.data.find((p) => p.id === project.id) ?? project
      : project;

  return { project: refreshedProject, nodes: treeRes.data };
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
// Connected Harness Tests (beforeEach restores configured state)
// -----------------------------------------------------------------------------

test.describe("Tier 1 — Connected Harness Tests (E2E-M3: F15–F19)", () => {
  test.beforeEach(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.restoreConfigured();
  });

  // ===========================================================================
  // F15 — Bidirectional Gantt View (002.1 Rétroplanning Actif) (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F15: Bidirectional Gantt View (002.1 Rétroplanning Actif)", () => {
    test("T1-F15-01 Parse & display PHASES / ÉTAPES / TACHES / SEMAINES (Par semaine) on /retroplanning and API", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F15Gantt");

      await seedTask(api, project.id, {
        phase: "Phase 1 : Conception & Map",
        etape: "Mapping Fortnite",
        tache: "Création map Fortnite UEFN",
        owner: "Louis",
        startDate: "2026-09-01",
        endDate: "2026-09-07",
        status: "EN_COURS",
        isMilestone: true,
        milestoneType: "LANCEMENT_MAP",
      });
      await seedTask(api, project.id, {
        phase: "Phase 2 : Influence",
        etape: "Talents",
        tache: "Validation scripts Kalut",
        owner: "Paul",
        startDate: "2026-09-08",
        endDate: "2026-09-14",
        status: "A_FAIRE",
        isMilestone: true,
        milestoneType: "INFLUENCE",
      });

      const retroRes = await api.getRetroplanning(project.id);
      expect(retroRes.status).toBe(200);
      const tasks = extractRetroTasks(retroRes.data);
      expect(tasks.length).toBeGreaterThanOrEqual(2);
      expect(tasks.some((t) => t.tache === "Création map Fortnite UEFN")).toBe(true);
      expect(tasks.some((t) => t.tache === "Validation scripts Kalut")).toBe(true);

      if (typeof retroRes.data.sheetTab === "string") {
        expect(retroRes.data.sheetTab).toBe(RETRO_SHEET_TAB);
      }
      if (Array.isArray(retroRes.data.columns)) {
        for (const col of RETRO_COLUMNS) {
          expect(retroRes.data.columns).toContain(col);
        }
      }

      const { pageErrors, consoleErrors } = attachBrowserErrorCollectors(page);
      const pageRes = await page.goto(`${BASE_URL}/retroplanning?projectId=${project.id}`);
      expect(pageRes?.status()).toBe(200);

      await expect(page.locator("body")).toContainText("Création map Fortnite UEFN");
      await expect(page.locator("body")).toContainText("Validation scripts Kalut");
      await expect(page.locator("body")).toContainText(/Phase 1|Conception/i);
      await expect(page.locator("body")).toContainText(/SEMAINE|Semaine|S\d+/i);

      const calls = await api.harness.getCalls();
      assertProdUntouched(project);
      assertProdUntouched(calls.data);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });

    test("T1-F15-02 DB and UI task edits sync forward to sandbox Sheet 002.1 preserving headers", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F15FwdSync");

      const task = await seedTask(api, project.id, {
        phase: "Phase 1 : Production",
        etape: "Assets",
        tache: "Validation Key Art Fortnite",
        owner: "Hugo",
        startDate: "2026-09-02",
        endDate: "2026-09-06",
        status: "A_FAIRE",
      });
      const taskId = String(task.id);
      expect(taskId).toBeTruthy();

      const { pageErrors, consoleErrors } = attachBrowserErrorCollectors(page);
      await page.goto(`${BASE_URL}/retroplanning?projectId=${project.id}`);
      await expect(page.locator("body")).toContainText("Validation Key Art Fortnite");

      await api.harness.resetCalls();

      // Genuine UI task-edit interaction on /retroplanning
      const taskRow = page
        .locator("tr, [data-testid^='retro-task'], [data-task-id], li")
        .filter({ hasText: "Validation Key Art Fortnite" })
        .first();
      await expect(taskRow).toBeVisible();

      const editTrigger = taskRow
        .locator("button")
        .filter({ hasText: /Modifier|[ÉE]diter|Edit/i })
        .first();
      if (await editTrigger.isVisible()) {
        await editTrigger.click();
      }

      const editDialog = page.locator('[role="dialog"]').first();
      const taskForm = page
        .locator("form")
        .filter({ hasText: "Validation Key Art Fortnite" })
        .first();
      const editScope = (await editDialog.isVisible())
        ? editDialog
        : (await taskForm.count()) > 0
          ? taskForm
          : taskRow;

      const dateInput = editScope.locator('input[type="date"]').last();
      const statusSelect = editScope.locator("select").first();
      const saveBtn = editScope
        .locator("button")
        .filter({ hasText: /Enregistrer|Sauvegarder|Valider|Save/i })
        .first();

      await expect(statusSelect).toBeVisible();
      await expect(dateInput).toBeVisible();

      if (await saveBtn.isVisible()) {
        await dateInput.fill("2026-09-09");
        await statusSelect.selectOption("EN_COURS");
        await Promise.all([
          page.waitForResponse(
            (r) =>
              r.url().includes(`/api/projects/${project.id}/retroplanning`) &&
              r.request().method() === "PATCH" &&
              r.ok()
          ),
          saveBtn.click(),
        ]);
      } else {
        await Promise.all([
          page.waitForResponse(
            (r) =>
              r.url().includes(`/api/projects/${project.id}/retroplanning`) &&
              r.request().method() === "PATCH" &&
              r.ok()
          ),
          dateInput.fill("2026-09-09"),
        ]);
        await Promise.all([
          page.waitForResponse(
            (r) =>
              r.url().includes(`/api/projects/${project.id}/retroplanning`) &&
              r.request().method() === "PATCH" &&
              r.ok()
          ),
          statusSelect.selectOption("EN_COURS"),
        ]);
      }

      await page.reload();
      await expect(page.locator("body")).toContainText("Validation Key Art Fortnite");
      await expect(page.locator("body")).toContainText(/En cours|EN_COURS/i);
      await expect(page.locator("body")).toContainText(/2026-09-09|09\/09/);

      const retroAfter = await api.getRetroplanning(project.id);
      expect(retroAfter.status).toBe(200);
      const updatedTask = extractRetroTasks(retroAfter.data).find(
        (t) => String(t.id) === taskId
      );
      expect(updatedTask?.status).toBe("EN_COURS");
      expect(isoDatePrefix(updatedTask?.endDate)).toBe("2026-09-09");

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);

      const sheetWrites = calls.data.filter((c) => {
        const op = String(c.operation ?? c.method ?? "");
        return /sheets.*(update|append|write|batchUpdate)/i.test(op);
      });
      expect(sheetWrites.length).toBeGreaterThanOrEqual(1);

      for (const write of sheetWrites) {
        const targetId = String(write.targetId ?? write.spreadsheetId ?? "");
        expect(targetId.length).toBeGreaterThan(0);
        if (project.retroplanningSheetId) {
          expect(targetId).toBe(project.retroplanningSheetId);
        }
        expect(targetId).not.toBe(PROD_IDS.PROD_RETROPLANNING_SHEET);
        expect(PROD_IMMUTABLE_ID_SET.has(targetId)).toBe(false);

        const op = String(write.operation ?? write.method ?? "");
        expect(op).not.toMatch(/clear/i);

        const params = isRecord(write.params) ? write.params : {};
        const range = String(write.range ?? params.range ?? "");
        if (range) {
          expect(range).not.toMatch(/(?:^|!)[A-Z]*1:[A-Z]*1$/i);
        }
      }

      const serializedWrites = JSON.stringify(sheetWrites);
      expect(serializedWrites).toContain("EN_COURS");
      expect(serializedWrites).toContain("2026-09-09");
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });

    test("T1-F15-03 Bidirectional Sheet-to-DB sync imports external Sheet 002.1 edits into DB and UI", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F15BiDir");

      const task = await seedTask(api, project.id, {
        phase: "Phase 2 : Jeu",
        etape: "Builds",
        tache: "Build HUD v1",
        owner: "Vertigo",
        startDate: "2026-09-03",
        endDate: "2026-09-10",
        status: "A_FAIRE",
      });

      const sheetId = project.retroplanningSheetId ?? `sandbox-retro-${project.id}`;
      // Seed external Sheet 002.1 row edits via boundary harness state hook
      const stateRes = await api.requestJson("POST", "/api/test-harness/state", {
        data: {
          retroSheetOverrides: {
            [sheetId]: {
              tab: RETRO_SHEET_TAB,
              headers: [...RETRO_COLUMNS, "SEMAINE 1", "SEMAINE 2"],
              rows: [
                {
                  id: String(task.id),
                  phase: "Phase 2 : Jeu",
                  etape: "Builds",
                  tache: "Build HUD v1",
                  owner: "Vertigo",
                  startDate: "2026-09-03",
                  endDate: "2026-09-14",
                  status: "TERMINE",
                },
                {
                  phase: "Phase 2 : Jeu",
                  etape: "Builds",
                  tache: "Livraison HUD v2",
                  owner: "Vertigo",
                  startDate: "2026-09-15",
                  endDate: "2026-09-18",
                  status: "EN_COURS",
                },
              ],
            },
          },
        },
      });
      expect(stateRes.ok).toBe(true);

      // Trigger Sheet -> DB sync via GET ?syncFromSheet=1 (or POST action fallback)
      let syncRes = await api.requestJson<Record<string, unknown>>(
        "GET",
        `/api/projects/${project.id}/retroplanning?syncFromSheet=1`
      );
      if (!syncRes.ok) {
        syncRes = await api.requestJson<Record<string, unknown>>(
          "POST",
          `/api/projects/${project.id}/retroplanning`,
          { data: { action: "SYNC_FROM_SHEET" } }
        );
      }
      expect(syncRes.status).toBe(200);

      const afterRes = await api.getRetroplanning(project.id);
      expect(afterRes.status).toBe(200);
      const tasks = extractRetroTasks(afterRes.data);
      const updatedHud = tasks.find((t) => t.tache === "Build HUD v1");
      const newHud = tasks.find((t) => t.tache === "Livraison HUD v2");

      expect(updatedHud).toBeDefined();
      expect(updatedHud?.status).toBe("TERMINE");
      expect(isoDatePrefix(updatedHud?.endDate)).toBe("2026-09-14");
      expect(newHud).toBeDefined();

      await page.goto(`${BASE_URL}/retroplanning?projectId=${project.id}`);
      await expect(page.locator("body")).toContainText("Build HUD v1");
      await expect(page.locator("body")).toContainText("Livraison HUD v2");

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);
    });

    test("T1-F15-04 Sandbox copy initialization from PROD RETROPLANNING CAISSE EPARGNE never mutates PROD", async ({
      request,
    }) => {
      const api = createApiClient(request);
      await api.harness.resetCalls();

      const boot = await api.bootstrapSandbox({
        codeProjet: uniqueTestCp(15),
        client: PILOT_PROJECT.client,
        nomJeu: PILOT_PROJECT.nomJeu,
        isSandbox: true,
      });
      expect([200, 201]).toContain(boot.status);

      const project = boot.data;
      expect(project.retroplanningSheetId).toBeTruthy();
      expect(project.retroplanningSheetId).not.toBe(PROD_IDS.PROD_RETROPLANNING_SHEET);
      expect(PROD_IMMUTABLE_ID_SET.has(String(project.retroplanningSheetId))).toBe(false);

      const calls = await api.harness.getCalls();
      assertProdUntouched(project);
      assertProdUntouched(calls.data, { allowCopySource: true });

      const audit = await api.listAuditLogs(project.id);
      assertProdUntouched(audit.data);
    });

    test("T1-F15-05 Editing Gantt tasks and marking 002.1 VALIDE_CLIENT never triggers permanent [EXT] sync", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, nodes } = await createProvisionedProject(
        api,
        testInfo.workerIndex,
        "F15NoExtSync"
      );

      const task = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Cadrage",
        tache: "Rétroplanning interne validé",
        startDate: "2026-09-01",
        endDate: "2026-09-05",
        status: "EN_COURS",
      });

      const patchTask = await api.updateRetroTask(project.id, {
        id: String(task.id),
        status: "TERMINE",
      });
      expect(patchTask.status).toBe(200);

      const node0021 = findNodeByCode(nodes, "002.1");
      expect(node0021).toBeDefined();
      if (!node0021) {
        throw new Error("Expected 002.1 DriveNode to exist after provisioning");
      }
      const valRes = await api.updateDriveNode(project.id, node0021.id, {
        validationStatus: "VALIDE_CLIENT",
      });
      expect([200, 400, 403]).toContain(valRes.status);

      const syncRes = await api.syncDriveToExt(project.id);
      expect(syncRes.status).toBe(200);
      assertRetroplanningNeverAutoSyncedToExt(syncRes.data);

      const treeAfter = await api.getDriveTree(project.id);
      expect(treeAfter.status).toBe(200);
      assertRetroplanningNeverAutoSyncedToExt(treeAfter.data);

      await page.goto(`${BASE_URL}/retroplanning?projectId=${project.id}`);
      await expect(page.locator("body")).toContainText(
        /Strictement interne|Jamais synchronis|NO_PERMANENT_EXT_SYNC|non synchronis[ée].*\[EXT\]/i
      );
    });

    test("T1-F15-06 Gantt tasks and Sheet edits remain strictly scoped per projectId", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project: p1 } = await createProvisionedProject(api, testInfo.workerIndex, "ScopeA");
      const { project: p2 } = await createProvisionedProject(
        api,
        testInfo.workerIndex + 10,
        "ScopeB"
      );

      await seedTask(api, p1.id, {
        phase: "Phase A",
        etape: "Map",
        tache: "Tâche CE Fortnite Exclusif",
        startDate: "2026-09-01",
        endDate: "2026-09-04",
      });
      await seedTask(api, p2.id, {
        phase: "Phase B",
        etape: "Terrain",
        tache: "Tâche Event Collab Isolée",
        startDate: "2026-09-05",
        endDate: "2026-09-09",
      });

      const r1 = await api.getRetroplanning(p1.id);
      const r2 = await api.getRetroplanning(p2.id);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);

      const t1 = extractRetroTasks(r1.data);
      const t2 = extractRetroTasks(r2.data);
      expect(t1.some((t) => t.tache === "Tâche CE Fortnite Exclusif")).toBe(true);
      expect(t1.some((t) => t.tache === "Tâche Event Collab Isolée")).toBe(false);
      expect(t2.some((t) => t.tache === "Tâche Event Collab Isolée")).toBe(true);
      expect(t2.some((t) => t.tache === "Tâche CE Fortnite Exclusif")).toBe(false);

      await page.goto(`${BASE_URL}/retroplanning?projectId=${p1.id}`);
      await expect(page.locator("body")).toContainText("Tâche CE Fortnite Exclusif");
      await expect(page.locator("body")).not.toContainText("Tâche Event Collab Isolée");
    });
  });

  // ===========================================================================
  // F16 — AI Watch (Gmail & 004. Production) + 1-Click Proposals (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F16: AI Watch (Gmail & 004. Production) + 1-Click Proposals", () => {
    test("T1-F16-01 On-demand AI Veille scans Gmail & 004. Production and persists RetroProposal cards", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F16Veille");

      const logoTask = await seedTask(api, project.id, {
        phase: "Phase 1 : Créa",
        etape: "Logo",
        tache: "Validation Logo",
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        status: "A_FAIRE",
      });
      const hudTask = await seedTask(api, project.id, {
        phase: "Phase 2 : Dev",
        etape: "HUD",
        tache: "HUD Fortnite",
        startDate: "2026-09-05",
        endDate: "2026-09-12",
        status: "EN_COURS",
      });

      const veilleRes = await api.runRetroVeille(project.id, {
        includeDrive: true,
        emails: [
          {
            id: "msg-logo-ok",
            subject: `[CP ${project.codeProjet}] Validation Logo par Sébastien`,
            body: `Bonjour, le Logo pour CP ${project.codeProjet} est validé ce jour, on passe à Terminé.`,
          },
        ],
        driveFiles: [
          {
            id: "file-hud-delay",
            parentCode: "004.2",
            name: `${project.codeProjet}_HUD_v2_retard_7j.png`,
            note: `Retard +7 jours annoncé par Vertigo sur HUD Fortnite (${String(hudTask.id)})`,
          },
        ],
      });
      expect(veilleRes.status).toBe(200);

      const createdProposals = extractProposals(veilleRes.data);
      expect(createdProposals.length).toBeGreaterThanOrEqual(2);

      const retroAfter = await api.getRetroplanning(project.id);
      expect(retroAfter.status).toBe(200);
      const persistedProposals = extractProposals(retroAfter.data);
      expect(persistedProposals.length).toBeGreaterThanOrEqual(2);
      expect(persistedProposals.some((p) => p.sourceType === "GMAIL")).toBe(true);
      expect(persistedProposals.some((p) => p.sourceType === "DRIVE")).toBe(true);

      for (const prop of persistedProposals) {
        expect(["GMAIL", "DRIVE"]).toContain(String(prop.sourceType));
        expect(String(prop.summary ?? "").trim().length).toBeGreaterThan(0);
        expect(prop.status).toBe("PENDING");
        expect(typeof prop.confidence).toBe("number");
        const conf = prop.confidence as number;
        expect(conf).toBeGreaterThanOrEqual(0);
        expect(conf).toBeLessThanOrEqual(1);
        const hasProposedChange =
          (prop.proposedStatus !== undefined && prop.proposedStatus !== null) ||
          (prop.proposedEndDate !== undefined && prop.proposedEndDate !== null) ||
          (prop.deltaDays !== undefined && prop.deltaDays !== null);
        expect(hasProposedChange).toBe(true);
      }

      expect(logoTask.id).toBeTruthy();
      expect(
        persistedProposals.some(
          (p) =>
            p.retroTaskId === String(logoTask.id) ||
            p.retroTaskId === String(hudTask.id)
        )
      ).toBe(true);
      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit, { action: /VEILLE|RETRO_VEILLE/i });
      const calls = await api.harness.getCalls();
      expect(calls.status).toBe(200);
      assertProdUntouched(calls.data);
      assertProdUntouched(project);
    });

    test("T1-F16-02 1-click Apply updates RetroTask in DB, writes Sheet 002.1, and never auto-syncs to [EXT]", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F16Apply");

      const task = await seedTask(api, project.id, {
        phase: "Phase 1 : Créa",
        etape: "Identité",
        tache: "Logo Jeu Final",
        startDate: "2026-09-01",
        endDate: "2026-09-08",
        status: "EN_ATTENTE_CLIENT",
      });

      const veilleRes = await api.runRetroVeille(project.id, {
        includeDrive: true,
        emails: [
          {
            id: "msg-apply-01",
            subject: `CP ${project.codeProjet} - Logo Jeu Final validé`,
            body: `Logo Jeu Final validé par client, passer la tâche ${String(task.id)} à TERMINE.`,
          },
        ],
      });
      expect(veilleRes.status).toBe(200);
      const proposals = extractProposals(veilleRes.data);
      expect(proposals.length).toBeGreaterThanOrEqual(1);
      const proposalId = String(proposals[0].id);

      await api.harness.resetCalls();
      const applyRes = await api.applyRetroProposal(project.id, proposalId, { action: "APPLY" });
      expect(applyRes.status).toBe(200);

      const appliedProp = isRecord(applyRes.data.proposal) ? applyRes.data.proposal : applyRes.data;
      expect(appliedProp.status).toBe("APPLIED");

      const retroAfter = await api.getRetroplanning(project.id);
      const updatedTask = extractRetroTasks(retroAfter.data).find(
        (t) => String(t.id) === String(task.id)
      );
      expect(updatedTask).toBeDefined();
      expect(updatedTask?.status).toBe("TERMINE");

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);

      const sheetWrites = calls.data.filter((c) => {
        const op = String(c.operation ?? c.method ?? "");
        return /sheets.*(update|append|write|batchUpdate)/i.test(op);
      });
      expect(sheetWrites.length).toBeGreaterThanOrEqual(1);
      for (const write of sheetWrites) {
        const targetId = String(write.targetId ?? write.spreadsheetId ?? "");
        expect(targetId.length).toBeGreaterThan(0);
        if (project.retroplanningSheetId) {
          expect(targetId).toBe(project.retroplanningSheetId);
        }
        expect(targetId).not.toBe(PROD_IDS.PROD_RETROPLANNING_SHEET);
        expect(PROD_IMMUTABLE_ID_SET.has(targetId)).toBe(false);
      }

      const treeAfter = await api.getDriveTree(project.id);
      assertRetroplanningNeverAutoSyncedToExt(treeAfter.data);

      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit, { action: /PROPOSAL.*APPL/i });
    });

    test("T1-F16-03 1-click Apply of milestone date-shift proposal cascades in-place to Google Calendar", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F16Cascade");

      const calRes = await api.createCalendarResource(project.id, {
        summary: `[${project.codeProjet}] ${project.client} - ${project.nomJeu}`,
      });
      expect([200, 201]).toContain(calRes.status);

      const milestone = await seedTask(api, project.id, {
        phase: "Phase 3 : Influence",
        etape: "Publication",
        tache: "Publication Vidéo Kalut",
        startDate: "2026-12-15T12:00:00.000Z",
        endDate: "2026-12-15T12:00:00.000Z",
        status: "EN_COURS",
        isMilestone: true,
        milestoneType: "INFLUENCE",
      });

      const initialSync = await api.syncCalendarCascades(project.id, {
        retroTaskId: String(milestone.id),
      });
      expect(initialSync.status).toBe(200);

      const calBefore = await api.getCalendar(project.id);
      const eventsBefore = extractCalendarEvents(calBefore.data);
      expect(eventsBefore.length).toBe(4);
      const initialGoogleIds = eventsBefore
        .map((e) => String(e.googleEventId ?? ""))
        .filter(Boolean)
        .sort();
      expect(initialGoogleIds.length).toBe(4);

      const veilleRes = await api.runRetroVeille(project.id, {
        emails: [
          {
            id: "msg-shift-5d",
            subject: `CP ${project.codeProjet} - Décalage Publication Vidéo Kalut +5 jours`,
            body: `La publication (${String(milestone.id)}) est décalée de +5 jours au 2026-12-20.`,
          },
        ],
      });
      expect(veilleRes.status).toBe(200);
      const proposals = extractProposals(veilleRes.data);
      expect(proposals.length).toBeGreaterThanOrEqual(1);

      const applyRes = await api.requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${project.id}/retroplanning/proposals/${String(proposals[0].id)}/apply`,
        {
          data: {
            action: "APPLY",
            retroTaskId: String(milestone.id),
            proposedEndDate: "2026-12-20T12:00:00.000Z",
            proposedStartDate: "2026-12-20T12:00:00.000Z",
          },
        }
      );
      expect(applyRes.status).toBe(200);

      const calAfter = await api.getCalendar(project.id);
      const eventsAfter = extractCalendarEvents(calAfter.data);
      expect(eventsAfter.length).toBe(4);

      const afterGoogleIds = eventsAfter
        .map((e) => String(e.googleEventId ?? ""))
        .filter(Boolean)
        .sort();
      expect(afterGoogleIds).toEqual(initialGoogleIds);

      const expectedDates = CASCADE_OFFSETS.INFLUENCE.map((offset) =>
        shiftIsoDate("2026-12-20", offset)
      ).sort();
      const actualDates = eventsAfter.map((e) => isoDatePrefix(e.startAt)).sort();
      expect(actualDates).toEqual(expectedDates);
    });

    test("T1-F16-04 Dismiss proposal marks DISMISSED without mutating RetroTask, Sheet 002.1, or Calendar", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F16Dismiss");

      const task = await seedTask(api, project.id, {
        phase: "Phase 2",
        etape: "Site Web",
        tache: "Mise en ligne FAQ",
        startDate: "2026-12-01",
        endDate: "2026-12-10",
        status: "A_FAIRE",
      });

      const veilleRes = await api.runRetroVeille(project.id, {
        emails: [
          {
            id: "msg-dismiss-01",
            subject: `CP ${project.codeProjet} - Suggestion FAQ`,
            body: `Proposition pour tâche ${String(task.id)} -> TERMINE.`,
          },
        ],
      });
      expect(veilleRes.status).toBe(200);
      const proposalId = String(extractProposals(veilleRes.data)[0].id);

      await api.harness.resetCalls();
      const dismissRes = await api.applyRetroProposal(project.id, proposalId, {
        action: "DISMISS",
      });
      expect(dismissRes.status).toBe(200);
      const dismissedProp = isRecord(dismissRes.data.proposal)
        ? dismissRes.data.proposal
        : dismissRes.data;
      expect(dismissedProp.status).toBe("DISMISSED");

      const retroAfter = await api.getRetroplanning(project.id);
      const unchangedTask = extractRetroTasks(retroAfter.data).find(
        (t) => String(t.id) === String(task.id)
      );
      expect(unchangedTask?.status).toBe("A_FAIRE");
      expect(isoDatePrefix(unchangedTask?.endDate)).toBe("2026-12-10");

      const calls = await api.harness.getCalls();
      const sheetOrCalendarWrites = calls.data.filter((c) => {
        const op = String(c.operation ?? c.method ?? "");
        return /sheets.*(update|append|write)|calendar.*(insert|patch|delete)/i.test(op);
      });
      expect(sheetOrCalendarWrites).toEqual([]);

      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit, { action: /PROPOSAL.*DISMISS/i });
    });

    test("T1-F16-05 Edit-before-apply overrides Gemini suggestion with user status and date", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F16EditApply");

      const task = await seedTask(api, project.id, {
        phase: "Phase 2",
        etape: "Com",
        tache: "Livraison Kit Com",
        startDate: "2026-12-01",
        endDate: "2026-12-10",
        status: "EN_COURS",
      });

      const veilleRes = await api.runRetroVeille(project.id, {
        emails: [
          {
            id: "msg-edit-01",
            subject: `CP ${project.codeProjet} - Retour Kit Com`,
            body: `En attente client jusqu'au 2026-12-18 sur ${String(task.id)}.`,
          },
        ],
      });
      expect(veilleRes.status).toBe(200);
      const proposalId = String(extractProposals(veilleRes.data)[0].id);

      const overrideApply = await api.requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${project.id}/retroplanning/proposals/${proposalId}/apply`,
        {
          data: {
            action: "APPLY",
            retroTaskId: String(task.id),
            proposedStatus: "TERMINE",
            proposedEndDate: "2026-12-16",
          },
        }
      );
      expect(overrideApply.status).toBe(200);

      const retroAfter = await api.getRetroplanning(project.id);
      const persistedTask = extractRetroTasks(retroAfter.data).find(
        (t) => String(t.id) === String(task.id)
      );
      expect(persistedTask?.status).toBe("TERMINE");
      expect(isoDatePrefix(persistedTask?.endDate)).toBe("2026-12-16");
    });

    test("T1-F16-06 /retroplanning UI displays AI proposal cards and applies in 1 click across reload", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F16UI");

      const task = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Validation",
        tache: "Charte Graphique Approuvée",
        startDate: "2026-09-01",
        endDate: "2026-09-05",
        status: "EN_ATTENTE_CLIENT",
      });

      await api.runRetroVeille(project.id, {
        emails: [
          {
            id: "msg-ui-apply",
            subject: `CP ${project.codeProjet} - Charte Graphique OK`,
            body: `Charte Graphique Approuvée (${String(task.id)}) est validée -> TERMINE.`,
          },
        ],
      });

      const { pageErrors, consoleErrors } = attachBrowserErrorCollectors(page);
      await page.goto(`${BASE_URL}/retroplanning?projectId=${project.id}`);

      await expect(page.locator("body")).toContainText(/Charte Graphique|GMAIL|DRIVE|Proposition/i);
      const applyBtn = page.locator("button").filter({ hasText: /Appliquer/i }).first();
      await expect(applyBtn).toBeVisible();
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes("/proposals/") &&
            r.url().includes("/apply") &&
            r.request().method() === "POST" &&
            r.ok()
        ),
        applyBtn.click(),
      ]);

      await page.reload();

      const retroAfter = await api.getRetroplanning(project.id);
      expect(retroAfter.status).toBe(200);
      const persistedTask = extractRetroTasks(retroAfter.data).find(
        (t) => String(t.id) === String(task.id)
      );
      expect(persistedTask?.status).toBe("TERMINE");
      const proposalsAfter = extractProposals(retroAfter.data);
      expect(proposalsAfter.some((p) => p.status === "APPLIED")).toBe(true);

      await expect(page.locator("body")).toContainText("Charte Graphique Approuvée");
      const statusRegex =
        /(?<![\p{L}\p{N}_])Termin[ée]e?(?![\p{L}\p{N}_])|\bTERMINE\b/iu;
      const taskRow = page
        .locator("tr, [role='row'], [data-testid^='retro-task'], [data-task-id], li")
        .filter({ hasText: "Charte Graphique Approuvée" })
        .first();
      if ((await taskRow.count()) > 0) {
        const leafSelector = "span, [data-testid*='status'], td, [role='cell']";
        if ((await taskRow.locator(leafSelector).count()) > 0) {
          const statusBadge = taskRow
            .locator(leafSelector)
            .filter({ hasText: statusRegex })
            .last();
          await expect(statusBadge).toContainText(statusRegex);
        } else {
          await expect(taskRow).toContainText(statusRegex);
        }
      } else {
        const fallbackBadge = page
          .locator("main, body")
          .locator("span, [data-testid*='status'], td, [role='cell']")
          .filter({ hasText: statusRegex })
          .first();
        await expect(fallbackBadge).toContainText(statusRegex);
      }
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  });

  // ===========================================================================
  // F17 — 14-Day Automatic Snapshots & Visual Drift Comparator (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F17: 14-Day Snapshots & Visual Drift Comparator", () => {
    test("T1-F17-01 Manual snapshot archives 002.2 Sheet copy + JSON RetroSnapshot in DB", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, nodes } = await createProvisionedProject(
        api,
        testInfo.workerIndex,
        "F17Snap",
        {
          client: "Caisse d'Épargne",
          nomJeu: "Fortnite",
        }
      );
      const node0022 = findNodeByCode(nodes, "002.2");

      await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Mapping",
        tache: "Snapshot Tâche 1",
        startDate: "2026-09-01",
        endDate: "2026-09-05",
      });
      await seedTask(api, project.id, {
        phase: "Phase 2",
        etape: "Influence",
        tache: "Snapshot Tâche 2",
        startDate: "2026-09-06",
        endDate: "2026-09-12",
      });
      await seedTask(api, project.id, {
        phase: "Phase 3",
        etape: "Bilan",
        tache: "Snapshot Tâche 3",
        startDate: "2026-09-13",
        endDate: "2026-09-20",
      });

      await api.harness.resetCalls();
      const snapRes = await api.createRetroSnapshot(project.id, { snapshotDate: "2026-09-01" });
      expect([200, 201]).toContain(snapRes.status);

      const snap = isRecord(snapRes.data.snapshot) ? snapRes.data.snapshot : snapRes.data;
      expect(snap.id).toBeTruthy();
      expect(snap.driveFileId).toBeTruthy();
      expect(PROD_IMMUTABLE_ID_SET.has(String(snap.driveFileId))).toBe(false);

      const archivedTasks = parseJsonOrArray(snap.tasksJson ?? snap.tasks);
      expect(archivedTasks.length).toBe(3);

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);

      const copyCalls = calls.data.filter((c) => {
        const op = String(c.operation ?? c.method ?? "");
        return /drive.*copy|files\.copy/i.test(op);
      });
      expect(copyCalls.length).toBeGreaterThanOrEqual(1);
      for (const copyCall of copyCalls) {
        const destParent = String(
          copyCall.destinationParentId ?? copyCall.parentId ?? ""
        );
        if (destParent) {
          expect(PROD_IMMUTABLE_ID_SET.has(destParent)).toBe(false);
          if (node0022?.driveFileId) {
            expect(destParent).toBe(node0022.driveFileId);
          }
        }
        const targetId = String(copyCall.targetId ?? "");
        if (targetId) {
          expect(targetId).not.toBe(PROD_IDS.PROD_RETROPLANNING_SHEET);
          expect(PROD_IMMUTABLE_ID_SET.has(targetId)).toBe(false);
        }
      }

      const copiedNameFromCall = copyCalls
        .map((c) => String(c.name ?? c.fileName ?? ""))
        .find((n) => n.length > 0);
      const treeAfter = await api.getDriveTree(project.id);
      const snapNode = treeAfter.data.find(
        (n) => !n.isFolder && n.driveFileId === String(snap.driveFileId)
      );
      const resolvedName = String(
        snap.fileName ?? snap.name ?? copiedNameFromCall ?? snapNode?.name ?? ""
      );
      expect(resolvedName).toMatch(RETRO_SNAPSHOT_NAME_REGEX);

      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit, { action: /SNAPSHOT/i });
    });

    test("T1-F17-02 Automatic 14-day scheduler trigger creates snapshots for eligible projects", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F17Cron");

      await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Setup",
        tache: "Tâche éligible snapshot 14j",
        startDate: "2026-08-15",
        endDate: "2026-09-01",
      });

      const cronRes = await api.triggerSchedulerJob("RETRO_SNAPSHOT_14D", project.id);
      expect(cronRes.status).toBe(200);

      const listRes = await api.listRetroSnapshots(project.id);
      expect(listRes.status).toBe(200);
      const snapshots = extractSnapshots(listRes.data);
      expect(snapshots.length).toBe(1);
      expect(PROD_IMMUTABLE_ID_SET.has(String(snapshots[0].driveFileId ?? ""))).toBe(false);

      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit, { action: /SNAPSHOT|CRON|SCHEDULER/i });
    });

    test("T1-F17-03 2-date comparator computes +X jours slip, -X jours ahead, and 0 jours on-time", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F17Drift");

      const tSlip = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Dev",
        tache: "Validation HUD",
        startDate: "2026-09-01",
        endDate: "2026-09-10",
      });
      const tAhead = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Créa",
        tache: "Teaser DOOH",
        startDate: "2026-09-05",
        endDate: "2026-09-15",
      });
      await seedTask(api, project.id, {
        phase: "Phase 2",
        etape: "Influence",
        tache: "Brief Influence",
        startDate: "2026-09-02",
        endDate: "2026-09-08",
      });

      const snapA = await api.createRetroSnapshot(project.id, { snapshotDate: "2026-09-01" });
      expect([200, 201]).toContain(snapA.status);
      const snapAId = String((isRecord(snapA.data.snapshot) ? snapA.data.snapshot : snapA.data).id);

      await api.updateRetroTask(project.id, { id: String(tSlip.id), endDate: "2026-09-17" });
      await api.updateRetroTask(project.id, { id: String(tAhead.id), endDate: "2026-09-12" });

      const snapB = await api.createRetroSnapshot(project.id, { snapshotDate: "2026-09-15" });
      expect([200, 201]).toContain(snapB.status);
      const snapBId = String((isRecord(snapB.data.snapshot) ? snapB.data.snapshot : snapB.data).id);

      const cmpRes = await api.listRetroSnapshots(project.id, { fromId: snapAId, toId: snapBId });
      expect(cmpRes.status).toBe(200);

      const comparison = isRecord(cmpRes.data.comparison) ? cmpRes.data.comparison : cmpRes.data;
      const diffs = asArray(comparison.diffs ?? comparison.items);
      expect(diffs.length).toBeGreaterThanOrEqual(3);

      const slipDiff = diffs.find((d) => String(d.tache ?? "").includes("Validation HUD"));
      const aheadDiff = diffs.find((d) => String(d.tache ?? "").includes("Teaser DOOH"));
      const onTimeDiff = diffs.find((d) => String(d.tache ?? "").includes("Brief Influence"));

      expect(slipDiff?.deltaDays).toBe(7);
      expect(aheadDiff?.deltaDays).toBe(-3);
      expect(onTimeDiff?.deltaDays).toBe(0);
    });

    test("T1-F17-04 Comparator classifies added, removed, and completed tasks between two snapshots", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F17AddRem");

      const tCompleted = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Admin",
        tache: "Tâche Complétée",
        startDate: "2026-09-01",
        endDate: "2026-09-05",
        status: "A_FAIRE",
      });
      const tRemoved = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Option",
        tache: "Tâche Supprimée",
        startDate: "2026-09-02",
        endDate: "2026-09-06",
        status: "A_FAIRE",
      });

      const snapA = await api.createRetroSnapshot(project.id, { snapshotDate: "2026-09-01" });
      expect([200, 201]).toContain(snapA.status);
      const snapAId = String((isRecord(snapA.data.snapshot) ? snapA.data.snapshot : snapA.data).id);

      const patchCompleted = await api.updateRetroTask(project.id, {
        id: String(tCompleted.id),
        status: "TERMINE",
      });
      expect(patchCompleted.status).toBe(200);
      const delRes = await api.requestJson(
        "DELETE",
        `/api/projects/${project.id}/retroplanning?taskId=${String(tRemoved.id)}`
      );
      expect([200, 204]).toContain(delRes.status);
      await seedTask(api, project.id, {
        phase: "Phase 2",
        etape: "Bonus",
        tache: "Tâche Ajoutée",
        startDate: "2026-09-10",
        endDate: "2026-09-15",
        status: "A_FAIRE",
      });

      const snapB = await api.createRetroSnapshot(project.id, { snapshotDate: "2026-09-15" });
      expect([200, 201]).toContain(snapB.status);
      const snapBId = String((isRecord(snapB.data.snapshot) ? snapB.data.snapshot : snapB.data).id);

      const cmpRes = await api.listRetroSnapshots(project.id, { fromId: snapAId, toId: snapBId });
      expect(cmpRes.status).toBe(200);
      const comparison = isRecord(cmpRes.data.comparison) ? cmpRes.data.comparison : cmpRes.data;
      const diffs = asArray(comparison.diffs ?? comparison.items);

      const added = diffs.find((d) => String(d.tache ?? "").includes("Tâche Ajoutée"));
      expect(added).toBeDefined();
      expect(String(added?.classification ?? added?.changeType ?? "")).toMatch(/ADDED|AJOUT/i);

      const removedDiff = diffs.find((d) => String(d.tache ?? "").includes("Tâche Supprimée"));
      expect(removedDiff).toBeDefined();
      expect(
        String(removedDiff?.classification ?? removedDiff?.changeType ?? removedDiff?.status ?? "")
      ).toMatch(/REMOVED|DELETED|SUPPRIM/i);

      const completed = diffs.find((d) => String(d.tache ?? "").includes("Tâche Complétée"));
      expect(completed).toBeDefined();
      expect(
        String(completed?.toStatus ?? completed?.classification ?? "")
      ).toMatch(/TERMINE|COMPLETED/i);
    });

    test("T1-F17-05 /retroplanning visual drift comparator UI renders +7 jours, -3 jours, and 0 jours", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F17UI");

      const t1 = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Dev",
        tache: "QA Map UI",
        startDate: "2026-09-01",
        endDate: "2026-09-10",
      });
      const t2 = await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Créa",
        tache: "Banner UI",
        startDate: "2026-09-02",
        endDate: "2026-09-15",
      });
      await seedTask(api, project.id, {
        phase: "Phase 2",
        etape: "Sync",
        tache: "Kickoff UI",
        startDate: "2026-09-01",
        endDate: "2026-09-04",
      });

      const snapA = await api.createRetroSnapshot(project.id, { snapshotDate: "2026-09-01" });
      expect([200, 201]).toContain(snapA.status);
      const snapAId = String((isRecord(snapA.data.snapshot) ? snapA.data.snapshot : snapA.data).id);
      await api.updateRetroTask(project.id, { id: String(t1.id), endDate: "2026-09-17" });
      await api.updateRetroTask(project.id, { id: String(t2.id), endDate: "2026-09-12" });
      const snapB = await api.createRetroSnapshot(project.id, { snapshotDate: "2026-09-15" });
      expect([200, 201]).toContain(snapB.status);
      const snapBId = String((isRecord(snapB.data.snapshot) ? snapB.data.snapshot : snapB.data).id);

      const { pageErrors, consoleErrors } = attachBrowserErrorCollectors(page);
      await page.goto(`${BASE_URL}/retroplanning?projectId=${project.id}`);

      const comparatorControls = page.locator("select, [role='combobox']");
      await expect(comparatorControls.first()).toBeVisible();

      const snapSelects = page
        .locator("select")
        .filter({ has: page.locator(`option[value="${snapAId}"]`) });
      if ((await snapSelects.count()) >= 2) {
        await snapSelects.nth(0).selectOption(snapAId);
        await snapSelects.nth(1).selectOption(snapBId);
      }

      const compareBtn = page.locator("button").filter({ hasText: /Comparer/i }).first();
      await expect(compareBtn).toBeVisible();
      await compareBtn.click();

      const plus7Regex = /\+7\s*j(?:ours?)?(?![\p{L}])/iu;
      const minus3Regex = /-3\s*j(?:ours?)?(?![\p{L}])/iu;
      const zeroDriftRegex =
        /(?:^|[\s(>])\+?\s*0\s*j(?:ours?)?(?![\p{L}])|^(?:[+-]?\s*0\s*j(?:ours?)?|[ÀA]\s*l['’]heure)$|(?:^|[\s(>])(?<!\d\s+)[ÀA]\s*l['’]heure(?![\p{L}])/iu;
      const driftLeafSelector = "span, [data-testid*='delta'], td, [role='cell']";

      const assertTaskDriftLeaf = async (taskName: string, driftRegex: RegExp) => {
        const diffRow = page
          .locator("tr, [role='row'], li")
          .filter({ hasText: taskName })
          .filter({ has: page.locator(driftLeafSelector).filter({ hasText: driftRegex }) })
          .first();
        const driftLeaf = diffRow
          .locator(driftLeafSelector)
          .filter({ hasText: driftRegex })
          .last();
        await expect(driftLeaf).toContainText(driftRegex);
      };

      await assertTaskDriftLeaf("QA Map UI", plus7Regex);
      await assertTaskDriftLeaf("Banner UI", minus3Regex);
      await assertTaskDriftLeaf("Kickoff UI", zeroDriftRegex);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });

    test("T1-F17-06 002.2 Historique Rétroplanning snapshots stay INTERNAL_ONLY and scoped per projectId", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project: p1 } = await createProvisionedProject(api, testInfo.workerIndex, "F17Int1");
      const { project: p2 } = await createProvisionedProject(
        api,
        testInfo.workerIndex + 10,
        "F17Int2"
      );

      await seedTask(api, p1.id, {
        phase: "Phase 1",
        etape: "Interne",
        tache: "Tâche Confidentielle P1",
        startDate: "2026-09-01",
        endDate: "2026-09-05",
      });
      await api.createRetroSnapshot(p1.id, { snapshotDate: "2026-09-01" });

      const syncRes = await api.syncDriveToExt(p1.id);
      expect(syncRes.status).toBe(200);

      const treeP1 = await api.getDriveTree(p1.id);
      const node0022 = findNodeByCode(treeP1.data, "002.2");
      expect(node0022).toBeDefined();
      expect(node0022?.isExtEligible).not.toBe(true);
      expect(node0022?.extMirrorFileId ?? null).toBeFalsy();

      const snapsP2 = await api.listRetroSnapshots(p2.id);
      expect(snapsP2.status).toBe(200);
      expect(extractSnapshots(snapsP2.data)).toEqual([]);
    });
  });

  // ===========================================================================
  // F18 — Dedicated Project Google Calendar & Cascading Milestones (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F18: Dedicated Google Calendar & Cascading Milestones", () => {
    test("T1-F18-01 Auto-creation of dedicated secondary Calendar [<CP>] <Client> - <Jeu> and team sharing", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F18Cal", {
        client: "Caisse d'Épargne",
        nomJeu: "Fortnite",
      });

      const calRes = await api.createCalendarResource(project.id, {
        shareWithEmails: ["paul@gamersorigin.com", "souleimane@gamersorigin.com"],
        role: "writer",
      });
      expect([200, 201]).toContain(calRes.status);

      const calendarId = String(calRes.data.calendarId ?? "");
      expect(calendarId.length).toBeGreaterThan(0);
      expect(calendarId).not.toBe("primary");
      expect(PROD_IMMUTABLE_ID_SET.has(calendarId)).toBe(false);

      const summary = String(calRes.data.summary ?? calRes.data.calendarSummary ?? "");
      expect(summary).toMatch(new RegExp(`\\[(?:PILOTE\\s*-\\s*)?${project.codeProjet}\\]`, "i"));
      expect(summary).toContain("Caisse d'Épargne");
      expect(summary).toContain("Fortnite");

      const getCal = await api.getCalendar(project.id);
      expect(getCal.status).toBe(200);
      expect(getCal.data.calendarId).toBe(calendarId);

      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit, { action: /CALENDAR/i });
    });

    test("T1-F18-02 INFLUENCE (J) cascade creates exact 4 events (J-10, J-3, J, J+7)", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F18Inf");
      await api.createCalendarResource(project.id, {});

      const anchor = "2026-12-20";
      const milestone = await seedTask(api, project.id, {
        phase: "Phase 3 : Influence",
        etape: "Talents",
        tache: "Sortie TikTok Aksianka",
        startDate: `${anchor}T12:00:00.000Z`,
        endDate: `${anchor}T12:00:00.000Z`,
        isMilestone: true,
        milestoneType: "INFLUENCE",
      });

      const sync = await api.syncCalendarCascades(project.id, {
        retroTaskId: String(milestone.id),
      });
      expect(sync.status).toBe(200);

      const cal = await api.getCalendar(project.id);
      const events = extractCalendarEvents(cal.data);
      expect(events.length).toBe(4);

      const expectedDates = CASCADE_OFFSETS.INFLUENCE.map((d) => shiftIsoDate(anchor, d)).sort();
      const actualDates = events.map((e) => isoDatePrefix(e.startAt)).sort();
      expect(actualDates).toEqual(expectedDates);

      const titles = events.map((e) => String(e.title ?? "")).join(" | ");
      expect(titles).toMatch(/script|trame/i);
      expect(titles).toMatch(/vid[ée]o/i);
      expect(titles).toMatch(/publication|spark/i);
      expect(titles).toMatch(/relance|stats|screenshot/i);
    });

    test("T1-F18-03 LANCEMENT_MAP (J) cascade creates exact 4 events (J-14, J-5, J-2, J)", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F18Map");
      await api.createCalendarResource(project.id, {});

      const anchor = "2026-12-24";
      const milestone = await seedTask(api, project.id, {
        phase: "Phase 2 : Jeu",
        etape: "Lancement",
        tache: "Lancement Map Fortnite",
        startDate: `${anchor}T12:00:00.000Z`,
        endDate: `${anchor}T12:00:00.000Z`,
        isMilestone: true,
        milestoneType: "LANCEMENT_MAP",
      });

      const sync = await api.syncCalendarCascades(project.id, {
        retroTaskId: String(milestone.id),
      });
      expect(sync.status).toBe(200);

      const cal = await api.getCalendar(project.id);
      const events = extractCalendarEvents(cal.data);
      expect(events.length).toBe(4);

      const expectedDates = CASCADE_OFFSETS.LANCEMENT_MAP.map((d) => shiftIsoDate(anchor, d)).sort();
      const actualDates = events.map((e) => isoDatePrefix(e.startAt)).sort();
      expect(actualDates).toEqual(expectedDates);

      const titles = events.map((e) => String(e.title ?? "")).join(" | ");
      expect(titles).toMatch(/QA|Tests/i);
      expect(titles).toMatch(/Epic|mod[ée]ration/i);
      expect(titles).toMatch(/Validation.*client/i);
      expect(titles).toMatch(/Mise en ligne|Kit Com/i);
    });

    test("T1-F18-04 WEEKLY (J) cascade creates exact 2 events (J-1, J)", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F18Weekly");
      await api.createCalendarResource(project.id, {});

      const anchor = "2026-12-11";
      const milestone = await seedTask(api, project.id, {
        phase: "Phase 1 : Pilotage",
        etape: "Suivi",
        tache: "Weekly Client CE",
        startDate: `${anchor}T12:00:00.000Z`,
        endDate: `${anchor}T12:00:00.000Z`,
        isMilestone: true,
        milestoneType: "WEEKLY",
      });

      const sync = await api.syncCalendarCascades(project.id, {
        retroTaskId: String(milestone.id),
      });
      expect(sync.status).toBe(200);

      const cal = await api.getCalendar(project.id);
      const events = extractCalendarEvents(cal.data);
      expect(events.length).toBe(2);

      const expectedDates = CASCADE_OFFSETS.WEEKLY.map((d) => shiftIsoDate(anchor, d)).sort();
      const actualDates = events.map((e) => isoDatePrefix(e.startAt)).sort();
      expect(actualDates).toEqual(expectedDates);

      const sortedByDate = [...events].sort((a, b) =>
        isoDatePrefix(a.startAt).localeCompare(isoDatePrefix(b.startAt))
      );
      expect(isoDatePrefix(sortedByDate[0].startAt)).toBe("2026-12-10");
      expect(String(sortedByDate[0].title ?? "")).toMatch(/Pr[ée]paration/i);
      expect(isoDatePrefix(sortedByDate[1].startAt)).toBe("2026-12-11");
      expect(String(sortedByDate[1].title ?? "")).toMatch(/Weekly/i);
    });

    test("T1-F18-05 Rescheduling milestone +5 then -3 days updates googleEventIds in-place with zero duplicates", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F18Resched");
      await api.createCalendarResource(project.id, {});

      const milestone = await seedTask(api, project.id, {
        phase: "Phase 3 : Influence",
        etape: "Talents",
        tache: "Jalon Influence Wig",
        startDate: "2026-12-20T12:00:00.000Z",
        endDate: "2026-12-20T12:00:00.000Z",
        isMilestone: true,
        milestoneType: "INFLUENCE",
      });
      const milestoneId = String(milestone.id);

      await api.syncCalendarCascades(project.id, { retroTaskId: milestoneId });
      const cal1 = extractCalendarEvents((await api.getCalendar(project.id)).data);
      expect(cal1.length).toBe(4);
      const originalEventIds = cal1.map((e) => String(e.googleEventId ?? "")).sort();
      expect(originalEventIds.every((id) => id.length > 0)).toBe(true);

      // Shift +5 days -> 2026-12-25
      const patchPlus5 = await api.updateRetroTask(project.id, {
        id: milestoneId,
        startDate: "2026-12-25T12:00:00.000Z",
        endDate: "2026-12-25T12:00:00.000Z",
      });
      expect(patchPlus5.status).toBe(200);
      await api.syncCalendarCascades(project.id, { retroTaskId: milestoneId });

      // Shift -3 days -> 2026-12-22
      const patchMinus3 = await api.updateRetroTask(project.id, {
        id: milestoneId,
        startDate: "2026-12-22T12:00:00.000Z",
        endDate: "2026-12-22T12:00:00.000Z",
      });
      expect(patchMinus3.status).toBe(200);
      await api.syncCalendarCascades(project.id, { retroTaskId: milestoneId });

      // Re-running identical sync must remain idempotent
      await api.syncCalendarCascades(project.id, { retroTaskId: milestoneId });

      const calFinal = extractCalendarEvents((await api.getCalendar(project.id)).data);
      expect(calFinal.length).toBe(4);
      const finalEventIds = calFinal.map((e) => String(e.googleEventId ?? "")).sort();
      expect(finalEventIds).toEqual(originalEventIds);

      const expectedFinalDates = CASCADE_OFFSETS.INFLUENCE.map((d) =>
        shiftIsoDate("2026-12-22", d)
      ).sort();
      expect(calFinal.map((e) => isoDatePrefix(e.startAt)).sort()).toEqual(expectedFinalDates);
    });

    test("T1-F18-06 /calendar UI creates dedicated calendar, syncs cascades, and persists across reload", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F18UI");

      await seedTask(api, project.id, {
        phase: "Phase 3",
        etape: "Influence",
        tache: "Jalon Influence Allyson",
        startDate: "2026-12-20T12:00:00.000Z",
        endDate: "2026-12-20T12:00:00.000Z",
        isMilestone: true,
        milestoneType: "INFLUENCE",
      });

      const { pageErrors, consoleErrors } = attachBrowserErrorCollectors(page);
      await page.goto(`${BASE_URL}/calendar?projectId=${project.id}`);

      const createBtn = page
        .locator("button")
        .filter({ hasText: /Cr[ée]er.*calendrier|Initialiser/i })
        .first();
      await expect(createBtn).toBeVisible();
      const [createCalRes] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes(`/api/projects/${project.id}/calendar`) &&
            !r.url().includes("sync-cascades") &&
            r.request().method() === "POST" &&
            r.ok()
        ),
        createBtn.click(),
      ]);
      const createCalJson = (await createCalRes.json()) as Record<string, unknown>;
      const createdCalData = isRecord(createCalJson.data) ? createCalJson.data : createCalJson;
      const createdCalId = String(createdCalData.calendarId ?? "");
      expect(createdCalId.length).toBeGreaterThan(0);

      await expect(page.locator("main")).toContainText(
        new RegExp(`\\[(?:PILOTE\\s*-\\s*)?${project.codeProjet}\\]|${createdCalId}`, "i")
      );

      const syncBtn = page
        .locator("button")
        .filter({ hasText: /Synchroniser.*cascades|Recalculer/i })
        .first();
      await expect(syncBtn).toBeVisible();
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes(`/api/projects/${project.id}/calendar/sync-cascades`) &&
            r.request().method() === "POST" &&
            r.ok()
        ),
        syncBtn.click(),
      ]);

      await page.reload();
      await expect(page.locator("body")).toContainText(/2026-12-10|10\/12|script|trame/i);
      await expect(page.locator("body")).toContainText(/2026-12-27|27\/12|stats|screenshot/i);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  });

  // ===========================================================================
  // F19 — 1-Click Weekly Client Generator (Slides + Gmail Draft) (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F19: 1-Click Weekly Client Generator (Slides + Gmail Draft)", () => {
    test("T1-F19-01 /weeklys UI renders J-7 -> J digest, 004. visual picker, and 2-column Prochaines étapes", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F19UI");

      const { pageErrors, consoleErrors } = attachBrowserErrorCollectors(page);
      const res = await page.goto(`${BASE_URL}/weeklys?projectId=${project.id}`);
      expect(res?.status()).toBe(200);

      await expect(page.locator("body")).toContainText(/J-7|7\s*jours|p[ée]riode|semaine/i);
      await expect(page.locator("body")).toContainText(/004\.|Visuels|Captures/i);
      await expect(page.locator("body")).toContainText(/C[ôo]t[ée] Client/i);
      await expect(page.locator("body")).toContainText(/C[ôo]t[ée] GO/i);
      await expect(page.locator("body")).toContainText(/Prochaines [ée]tapes/i);
      await expect(
        page.locator("button").filter({ hasText: /G[ée]n[ée]rer.*Weekly|Cr[ée]er.*Weekly/i }).first()
      ).toBeVisible();
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });

    test("T1-F19-02 1-click Weekly generation collects J-7 -> J RetroTasks and excludes out-of-window tasks", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F19Digest", {
        client: "Caisse d'Épargne",
        nomJeu: "Fortnite",
      });

      await seedTask(api, project.id, {
        phase: "Phase 2",
        etape: "Dev",
        tache: "Build Map v3 validé (In-Window)",
        startDate: "2026-09-05",
        endDate: "2026-09-09",
        status: "TERMINE",
      });
      await seedTask(api, project.id, {
        phase: "Phase 2",
        etape: "Créa",
        tache: "Kit Com DOOH (In-Window)",
        startDate: "2026-09-06",
        endDate: "2026-09-11",
        status: "EN_COURS",
      });
      await seedTask(api, project.id, {
        phase: "Phase 1",
        etape: "Cadrage",
        tache: "Ancienne tâche J-30 (Out-Of-Window)",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        status: "TERMINE",
      });

      const genRes = await api.generateWeekly(project.id, {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
        nextStepsClient: ["Valider la bande-annonce v2"],
        nextStepsGo: ["Finaliser soumission modération Epic"],
      });
      expect([200, 201]).toContain(genRes.status);

      const weekly = isRecord(genRes.data.weekly) ? genRes.data.weekly : genRes.data;
      expect(String(weekly.title ?? "")).toMatch(WEEKLY_TITLE_REGEX);
      expect(String(weekly.title ?? "")).toContain("Caisse d'Épargne");

      const collected = parseJsonOrArray(
        weekly.collectedTasksJson ?? weekly.collectedTasks
      );
      const collectedSerialized = JSON.stringify(collected);
      expect(collectedSerialized).toContain("Build Map v3 validé (In-Window)");
      expect(collectedSerialized).toContain("Kit Com DOOH (In-Window)");
      expect(collectedSerialized).not.toContain("Ancienne tâche J-30 (Out-Of-Window)");
    });

    test("T1-F19-03 Weekly duplicates template into 003.2, inserts latest PNG from 004., and leaves PROD Slides untouched", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, nodes } = await createProvisionedProject(
        api,
        testInfo.workerIndex,
        "F19Visuals",
        {
          client: "Caisse d'Épargne",
          nomJeu: "Fortnite",
        }
      );
      const node0032 = findNodeByCode(nodes, "003.2");

      const pngNode = await api.harness.seedDriveNode({
        projectId: project.id,
        parentCode: "004.2",
        name: "capture-build-weekly.png",
        mimeType: "image/png",
        validationStatus: "BROUILLON_INTERNE",
        isFolder: false,
      });
      expect([200, 201]).toContain(pngNode.status);
      expect(pngNode.data.id).toBeTruthy();
      expect(WEEKLY_VISUAL_PNG_BUFFER.byteLength).toBeGreaterThan(8);

      await api.harness.resetCalls();

      // Omit visualDriveIds to exercise automatic discovery of 004. PNG visuals
      const genRes = await api.generateWeekly(project.id, {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
        nextStepsClient: ["Retour maquette site web"],
        nextStepsGo: ["Tournage teaser influence"],
      });
      expect([200, 201]).toContain(genRes.status);

      const weekly = isRecord(genRes.data.weekly) ? genRes.data.weekly : genRes.data;
      const slidesFileId = String(weekly.slidesFileId ?? "");
      expect(slidesFileId.length).toBeGreaterThan(0);
      expect(slidesFileId).not.toBe(PROD_IDS.PROD_WEEKLY_SLIDES);
      expect(PROD_IMMUTABLE_ID_SET.has(slidesFileId)).toBe(false);

      const visuals = parseJsonOrArray(weekly.visualsDriveIdsJson ?? weekly.visualsDriveIds);
      expect(JSON.stringify(visuals)).toContain(pngNode.data.id);

      const treeAfter = await api.getDriveTree(project.id);
      expect(treeAfter.status).toBe(200);
      const weeklySlideNode = treeAfter.data.find(
        (n) => !n.isFolder && n.driveFileId === slidesFileId && n.code.startsWith("003.2")
      );
      expect(weeklySlideNode).toBeDefined();
      expect(String(weeklySlideNode?.name ?? "")).toMatch(WEEKLY_TITLE_REGEX);

      const clientSteps = parseJsonOrArray(weekly.nextStepsClientJson ?? weekly.nextStepsClient);
      const goSteps = parseJsonOrArray(weekly.nextStepsGoJson ?? weekly.nextStepsGo);
      expect(JSON.stringify(clientSteps)).toContain("Retour maquette site web");
      expect(JSON.stringify(goSteps)).toContain("Tournage teaser influence");

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);

      const copyCalls = calls.data.filter((c) => {
        const op = String(c.operation ?? c.method ?? "");
        return /drive.*copy|files\.copy/i.test(op);
      });
      expect(copyCalls.length).toBeGreaterThanOrEqual(1);
      for (const copyCall of copyCalls) {
        const destParent = String(copyCall.destinationParentId ?? copyCall.parentId ?? "");
        if (destParent) {
          expect(PROD_IMMUTABLE_ID_SET.has(destParent)).toBe(false);
          if (node0032?.driveFileId) {
            expect(destParent).toBe(node0032.driveFileId);
          }
        }
      }

      const imageCalls = calls.data.filter((c) => {
        const op = String(c.operation ?? c.method ?? "");
        return /slides.*(replaceAllShapesWithImage|createImage|batchUpdate)/i.test(op);
      });
      expect(imageCalls.length).toBeGreaterThanOrEqual(1);
      for (const ic of imageCalls) {
        const targetId = String(ic.targetId ?? ic.presentationId ?? "");
        if (targetId) {
          expect(targetId).toBe(slidesFileId);
          expect(PROD_IMMUTABLE_ID_SET.has(targetId)).toBe(false);
        }
      }
    });

    test("T1-F19-04 Weekly creates Gmail Draft ONLY (drafts.create, zero messages.send) and logs AuditLog", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F19Draft");

      await api.harness.resetCalls();

      const genRes = await api.generateWeekly(project.id, {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
        nextStepsClient: ["Validation finale wording"],
        nextStepsGo: ["Envoi brief talents"],
      });
      expect([200, 201]).toContain(genRes.status);

      const weekly = isRecord(genRes.data.weekly) ? genRes.data.weekly : genRes.data;
      expect(String(weekly.gmailDraftId ?? "").length).toBeGreaterThan(0);

      const calls = await api.harness.getCalls();
      assertGmailDraftNotSent(calls.data);
      assertProdUntouched(calls.data);

      const draftCalls = calls.data.filter((c) =>
        /draft|drafts\.create|createDraft/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(draftCalls.length).toBeGreaterThanOrEqual(1);
      const draftSerialized = JSON.stringify(draftCalls);
      expect(draftSerialized).toMatch(/Weekly/i);
      // 003.2 node is still BROUILLON_INTERNE so draft must exclude [EXT] mirror link
      expect(draftSerialized).not.toMatch(/\[EXT\s*-/i);

      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit, { action: /WEEKLY/i });
    });

    test("T1-F19-05 /weeklys UI 1-click generation persists WeeklyReport across reload and isolates per projectId", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project: p1 } = await createProvisionedProject(api, testInfo.workerIndex, "F19UI1");
      const { project: p2 } = await createProvisionedProject(
        api,
        testInfo.workerIndex + 10,
        "F19UI2"
      );

      await page.goto(`${BASE_URL}/weeklys?projectId=${p1.id}`);
      const genBtn = page
        .locator("button")
        .filter({ hasText: /G[ée]n[ée]rer.*Weekly|Cr[ée]er.*Weekly/i })
        .first();
      await expect(genBtn).toBeVisible();
      const [genUiRes] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes(`/api/projects/${p1.id}/weeklys`) &&
            r.request().method() === "POST" &&
            r.ok()
        ),
        genBtn.click(),
      ]);
      const genUiJson = (await genUiRes.json()) as Record<string, unknown>;
      const genData = isRecord(genUiJson.data) ? genUiJson.data : genUiJson;
      const genWeekly = isRecord(genData.weekly) ? genData.weekly : genData;
      const generatedTitle = String(genWeekly.title ?? "");
      expect(generatedTitle).toMatch(WEEKLY_TITLE_REGEX);

      await expect(page.locator("body")).toContainText(generatedTitle);
      await page.reload();
      await expect(page.locator("body")).toContainText(generatedTitle);

      const p1List = await api.listWeeklys(p1.id);
      const p2List = await api.listWeeklys(p2.id);
      expect(p1List.status).toBe(200);
      expect(p2List.status).toBe(200);
      expect(p1List.data.length).toBeGreaterThanOrEqual(1);
      expect(p2List.data).toEqual([]);
    });

    test("T1-F19-06 003.2 [EXT] sync gating keeps BROUILLON_INTERNE internal and syncs VALIDE_CLIENT to [EXT]", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedProject(api, testInfo.workerIndex, "F19ExtGate");

      const genRes = await api.generateWeekly(project.id, {
        weekStart: "2026-09-04",
        weekEnd: "2026-09-11",
        nextStepsClient: ["Relecture Weekly"],
        nextStepsGo: ["Publication après accord"],
      });
      expect([200, 201]).toContain(genRes.status);

      const treeBefore = await api.getDriveTree(project.id);
      const weeklyNode = treeBefore.data.find(
        (n) =>
          !n.isFolder &&
          (n.code.startsWith("003.2") || /Weekly/i.test(n.name))
      );
      expect(weeklyNode).toBeDefined();
      if (!weeklyNode) {
        throw new Error("Expected generated Weekly DriveNode in 003.2");
      }

      await api.syncDriveToExt(project.id);
      const treeDraft = await api.getDriveTree(project.id);
      const stillDraft = treeDraft.data.find((n) => n.id === weeklyNode.id);
      expect(stillDraft?.extMirrorFileId ?? null).toBeFalsy();

      await api.harness.resetCalls();
      const validateRes = await api.updateDriveNode(project.id, weeklyNode.id, {
        validationStatus: "VALIDE_CLIENT",
      });
      expect(validateRes.status).toBe(200);

      const syncValidated = await api.syncDriveToExt(project.id);
      expect(syncValidated.status).toBe(200);

      const treeValidated = await api.getDriveTree(project.id);
      const mirrored = treeValidated.data.find((n) => n.id === weeklyNode.id);
      expect(mirrored?.extMirrorFileId).toBeTruthy();
      expect(PROD_IMMUTABLE_ID_SET.has(String(mirrored?.extMirrorFileId ?? ""))).toBe(false);

      const extCalls = await api.harness.getCalls();
      assertProdUntouched(extCalls.data);
      const updatedDraftCalls = extCalls.data.filter((c) =>
        /draft|drafts\.(create|update)|updateDraft/i.test(String(c.operation ?? c.method ?? ""))
      );
      if (updatedDraftCalls.length > 0) {
        const draftText = JSON.stringify(updatedDraftCalls);
        expect(draftText).toMatch(
          new RegExp(`${String(mirrored?.extMirrorFileId)}|\\[EXT|drive\\.google\\.com`, "i")
        );
        for (const dc of updatedDraftCalls) {
          expect(dc.sent).not.toBe(true);
        }
      }
    });
  });
});
