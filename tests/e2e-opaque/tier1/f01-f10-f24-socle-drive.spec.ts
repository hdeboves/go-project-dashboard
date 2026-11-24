/**
 * Tier 1 — Isolated Happy-Path Opaque-Box E2E Tests (F1–F10, F24)
 * Target count: 60 tests (>=5 per feature across 11 features).
 * Progressive testability: Exercises ONLY M1 UI pages (/, /settings, /projects, /drive)
 * and M1 HTTP APIs + TEST_BOUNDARY_HARNESS=1 boundary ports. Zero src/ or prisma/ imports.
 */

import { expect, test } from "@playwright/test";
import { createApiClient, type DriveNodeDto, type ProjectDto } from "../helpers/api-client";
import {
  assertAuditLogged,
  assertCpConflictBlocked,
  assertDriveTreeComplete,
  assertExtDriftBadgeVisible,
  assertProdUntouched,
  assertRedAlertBanner,
  assertRetroplanningNeverAutoSyncedToExt,
  assertSandboxBadgeVisible,
} from "../helpers/assertions";
import {
  BASE_URL,
  CONFLICT_CP_CRISTALINE,
  EXT_MIRROR_FOLDERS,
  EXT_PRODUCTION_SUBFOLDERS,
  INFLUENCE_PLATFORM_FOLDER_LABELS,
  INTERNAL_004_4_LEAF_SUBFOLDERS,
  INTERNAL_FOLDER_SPECS,
  INTERNAL_NESTED_SUBFOLDERS,
  INTERNAL_TOP_LEVEL_FOLDERS,
  IS_LIVE_SANDBOX,
  M1_UI_ROUTES,
  OAUTH_REQUIRED_SCOPE_TOKENS,
  PENNYLANE_EMAIL,
  PILOT_PROJECT,
  PROD_IDS,
  PROD_IMMUTABLE_IDS,
  TALENT_SUBFOLDERS_004_3,
  uniqueTestCp,
} from "../helpers/constants";

function findNodeByCode(nodes: DriveNodeDto[], code: string): DriveNodeDto | undefined {
  return nodes.find((n) => n.code === code || n.name.startsWith(code));
}

async function createProvisionedProject(
  api: ReturnType<typeof createApiClient>,
  workerIndex: number,
  suffix = "Test"
): Promise<{ project: ProjectDto; nodes: DriveNodeDto[] }> {
  const cp = uniqueTestCp(workerIndex);
  const created = await api.createProject({
    codeProjet: cp,
    client: `Client ${suffix} ${cp}`,
    nomJeu: `Fortnite ${suffix}`,
    isSandbox: true,
  });
  expect(created.status, `Failed creating project ${cp}: ${JSON.stringify(created.raw)}`).toBe(201);
  const project = created.data;
  expect(project.id).toBeTruthy();

  const provisioned = await api.provisionDriveTree(project.id);
  expect([200, 201]).toContain(provisioned.status);

  const treeRes = await api.getDriveTree(project.id);
  expect(treeRes.status).toBe(200);
  return { project, nodes: treeRes.data };
}

test.describe("Tier 1 — Connected Harness Tests", () => {
  test.beforeEach(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.restoreConfigured();
  });

// =============================================================================
// F1 — Local-first Next.js Web App + SQLite/Prisma (5 tests)
// =============================================================================
test.describe("Tier 1 — F1: Local-first Next.js Web App + SQLite/Prisma", () => {
  test("T1-F01-01 Command Center / renders AppShell with zero console or page errors", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const response = await page.goto(`${BASE_URL}/`);
    expect(response?.status()).toBe(200);

    for (const route of M1_UI_ROUTES) {
      await expect(page.locator(`a[href="${route}"]`).first()).toBeVisible();
    }
    await expect(page.locator("body")).toContainText(/GamersOrigin|GO Project Hub|Pilotage/i);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("T1-F01-02 All M1 UI routes render with HTTP 200 and non-empty workspace headings", async ({
    page,
  }) => {
    const expectedPatterns: Record<string, RegExp> = {
      "/": /Command Center|Vue d'ensemble|Tableau de bord|Projets/i,
      "/settings": /Param[èe]tres|Configuration|OAuth2|Gemini/i,
      "/projects": /Projets|Nouveau projet|Bac [àa] sable/i,
      "/drive": /Drive|Arborescence|001\.|Miroir/i,
    };

    for (const route of M1_UI_ROUTES) {
      const res = await page.goto(`${BASE_URL}${route}`);
      expect(res?.status(), `Expected 200 on ${route}`).toBe(200);
      await expect(page.locator("main").first()).toBeVisible();
      await expect(page.locator("body")).toContainText(expectedPatterns[route]);
    }
  });

  test("T1-F01-03 Created project persists in SQLite across full browser reload", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const cp = uniqueTestCp(testInfo.workerIndex);
    const created = await api.createProject({
      codeProjet: cp,
      client: "Client Persistance",
      nomJeu: "Map Persistence",
      isSandbox: true,
    });
    expect(created.status).toBe(201);

    await page.goto(`${BASE_URL}/projects`);
    await expect(page.locator("body")).toContainText(cp);
    await expect(page.locator("body")).toContainText("Client Persistance");

    await page.reload();
    await expect(page.locator("body")).toContainText(cp);
    await expect(page.locator("body")).toContainText("Map Persistence");

    const listed = await api.listProjects();
    expect(listed.status).toBe(200);
    expect(listed.data.some((p) => p.codeProjet === cp)).toBe(true);
  });

  test("T1-F01-04 Core API read endpoints return structured JSON schemas", async ({ request }) => {
    const api = createApiClient(request);
    const settingsRes = await api.getSettings();
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.headers["content-type"]).toContain("application/json");
    expect(typeof settingsRes.data).toBe("object");

    const projectsRes = await api.listProjects();
    expect(projectsRes.status).toBe(200);
    expect(projectsRes.headers["content-type"]).toContain("application/json");
    expect(Array.isArray(projectsRes.data)).toBe(true);
  });

  test("T1-F01-05 AppShell navigation preserves active project selection across routes", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const cp1 = uniqueTestCp(testInfo.workerIndex);
    const cp2 = uniqueTestCp(testInfo.workerIndex + 10);

    const p1 = await api.createProject({
      codeProjet: cp1,
      client: "Client Un",
      nomJeu: "Jeu Un",
      isSandbox: true,
    });
    const p2 = await api.createProject({
      codeProjet: cp2,
      client: "Client Deux",
      nomJeu: "Jeu Deux",
      isSandbox: true,
    });
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);

    await page.goto(`${BASE_URL}/?projectId=${p2.data.id}`);
    await expect(page.locator("body")).toContainText(cp2);

    await page.locator('a[href*="/drive"]').first().click();
    await expect(page).toHaveURL(/\/drive/);
    await expect(page.locator("body")).toContainText(cp2);

    await page.locator('a[href*="/projects"]').first().click();
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.locator("body")).toContainText(cp2);
  });
});

// =============================================================================
// F2 — OAuth2 Google Workspace + Gemini Config & Guided Setup (6 tests)
// =============================================================================
test.describe("Tier 1 — F2: OAuth2 Google Workspace + Gemini Config & Guided Setup", () => {
  test("T1-F02-01 /settings renders guided GCP OAuth2 & AI Studio wizard with env status badges", async ({
    page,
  }) => {
    const res = await page.goto(`${BASE_URL}/settings`);
    expect(res?.status()).toBe(200);

    await expect(page.locator("body")).toContainText(/GOOGLE_CLIENT_ID/i);
    await expect(page.locator("body")).toContainText(/GOOGLE_CLIENT_SECRET/i);
    await expect(page.locator("body")).toContainText(/GEMINI_API_KEY/i);
    await expect(page.locator("body")).toContainText(/Google Cloud|AI Studio|OAuth2/i);
    await expect(
      page
        .locator('a, button')
        .filter({ hasText: /Connecter.*Google|Se connecter avec Google|OAuth/i })
        .first()
    ).toBeVisible();
  });

  test("T1-F02-02 GET /api/settings returns configuration flags and sandbox policy without raw secrets", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const res = await api.getSettings();
    expect(res.status).toBe(200);

    const s = res.data;
    expect(s.sandboxModeEnabled ?? s.sandboxMode).toBe(true);
    expect(Array.isArray(s.prodBlockedIds)).toBe(true);
    expect(JSON.stringify(res.raw)).not.toContain("AIzaSy");
    expect(s.googleClientSecret).toBeUndefined();
    expect(s.geminiApiKey).toBeUndefined();
  });

  test("T1-F02-03 POST /api/settings saves Gemini override and Pennylane/CC defaults", async ({
    page,
    request,
  }) => {
    const api = createApiClient(request);
    const updateRes = await api.updateSettings({
      pennylaneEmail: PENNYLANE_EMAIL,
      defaultCcEmails: [
        "souleimane@gamersorigin.com",
        "louis@gamersorigin.com",
        "paul@gamersorigin.com",
      ],
      geminiApiKey: "AIza-test-harness-override-key",
    });
    expect(updateRes.status).toBe(200);

    const after = await api.getSettings();
    expect(after.status).toBe(200);
    expect(after.data.pennylaneEmail).toBe(PENNYLANE_EMAIL);
    expect(JSON.stringify(after.data)).toContain("souleimane@gamersorigin.com");

    await page.goto(`${BASE_URL}/settings`);
    await expect(page.locator("body")).toContainText(PENNYLANE_EMAIL);
  });

  test("T1-F02-04 GET /api/auth/google/start generates OAuth2 consent URL with all 5 Workspace scopes", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const res = await api.startGoogleAuth();
    expect([200, 302, 307]).toContain(res.status);

    const locationOrUrl =
      res.headers.location ??
      (typeof res.data?.authUrl === "string" ? res.data.authUrl : undefined) ??
      (typeof res.data?.url === "string" ? res.data.url : "");

    expect(locationOrUrl).toContain("accounts.google.com");
    expect(locationOrUrl).toContain("access_type=offline");
    for (const scopeToken of OAUTH_REQUIRED_SCOPE_TOKENS) {
      expect(locationOrUrl.toLowerCase()).toContain(scopeToken);
    }
  });

  test("T1-F02-05 GET /api/auth/google/callback exchanges code, encrypts tokens, and shows connected user", async ({
    page,
    request,
  }) => {
    const api = createApiClient(request);
    const startRes = await api.startGoogleAuth();
    const authUrl = startRes.headers.location ?? String(startRes.data?.authUrl ?? "");
    const parsed = new URL(authUrl);
    const state = parsed.searchParams.get("state") ?? "harness-valid-state";

    const cbRes = await api.callbackGoogleAuth({
      code: "harness-valid-oauth-code",
      state,
    });
    expect([200, 302, 307]).toContain(cbRes.status);

    const settingsRes = await api.getSettings();
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.data.googleConnected).toBe(true);
    expect(String(settingsRes.data.userEmail ?? "")).toContain("@");

    await page.goto(`${BASE_URL}/settings`);
    await expect(page.locator("body")).toContainText(/Connect[ée]|Connected/i);
  });

  test("T1-F02-06 POST /api/settings/test-gemini verifies Gemini connectivity via boundary port", async ({
    page,
    request,
  }) => {
    const api = createApiClient(request);
    const res = await api.testGemini();
    expect(res.status).toBe(200);
    expect(res.data.ok ?? res.ok).toBe(true);

    await page.goto(`${BASE_URL}/settings`);
    const testBtn = page.locator("button").filter({ hasText: /Tester Gemini|Gemini/i }).first();
    if (await testBtn.isVisible()) {
      await testBtn.click();
      await expect(page.locator("body")).toContainText(/gemini|OK|Connect[ée]|Op[ée]rationnel/i);
    }
  });
});

// =============================================================================
// F3 — Multi-Project Identity & Strict Scoping (6 tests)
// =============================================================================
test.describe("Tier 1 — F3: Multi-Project Identity & Strict Scoping", () => {
  test("T1-F03-01 POST /api/projects creates project with (codeProjet, client, nomJeu) identity", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const cp = uniqueTestCp(testInfo.workerIndex);
    const res = await api.createProject({
      codeProjet: cp,
      client: "Caisse d'Épargne",
      nomJeu: PILOT_PROJECT.fullGameName,
      isSandbox: true,
    });

    expect(res.status).toBe(201);
    expect(res.data.id).toBeTruthy();
    expect(res.data.codeProjet).toBe(cp);
    expect(res.data.client).toBe("Caisse d'Épargne");
    expect(res.data.nomJeu).toBe(PILOT_PROJECT.fullGameName);
    expect(res.data.isSandbox).toBe(true);
    assertProdUntouched(res.data);
  });

  test("T1-F03-02 Same client supports multiple distinct projects without collision", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const cp1 = uniqueTestCp(testInfo.workerIndex);
    const cp2 = uniqueTestCp(testInfo.workerIndex + 20);

    const p1 = await api.createProject({
      codeProjet: cp1,
      client: "Caisse d'Épargne",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    const p2 = await api.createProject({
      codeProjet: cp2,
      client: "Caisse d'Épargne",
      nomJeu: "Event Collaborateurs",
      isSandbox: true,
    });

    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
    expect(p1.data.id).not.toBe(p2.data.id);

    const list = await api.listProjects();
    expect(list.status).toBe(200);
    expect(list.data.some((p) => p.id === p1.data.id)).toBe(true);
    expect(list.data.some((p) => p.id === p2.data.id)).toBe(true);
  });

  test("T1-F03-03 /projects UI creates a project and displays CP | Client | Jeu identity", async ({
    page,
  }, testInfo) => {
    const cp = uniqueTestCp(testInfo.workerIndex);
    await page.goto(`${BASE_URL}/projects`);

    const cpInput = page
      .locator('input[name="codeProjet"], input[placeholder*="326027"], input[id*="codeProjet"]')
      .first();
    const clientInput = page
      .locator('input[name="client"], input[placeholder*="Caisse"], input[id*="client"]')
      .first();
    const jeuInput = page
      .locator('input[name="nomJeu"], input[placeholder*="Fortnite"], input[id*="nomJeu"]')
      .first();

    await cpInput.fill(cp);
    await clientInput.fill("Client UI Test");
    await jeuInput.fill("Jeu UI Fortnite");

    await page
      .locator('button[type="submit"], button')
      .filter({ hasText: /Cr[ée]er|Ajouter|Enregistrer/i })
      .first()
      .click();

    await expect(page.locator("body")).toContainText(cp);
    await expect(page.locator("body")).toContainText("Client UI Test");
    await expect(page.locator("body")).toContainText("Jeu UI Fortnite");
  });

  test("T1-F03-04 Project Drive nodes and anchors remain strictly scoped per projectId", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project: projA, nodes: nodesA } = await createProvisionedProject(
      api,
      testInfo.workerIndex,
      "ScopeA"
    );
    const projB = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex + 30),
      client: "Client Scope B",
      nomJeu: "Fortnite Scope B",
      isSandbox: true,
    });
    expect(projB.status).toBe(201);
    expect(nodesA.length).toBeGreaterThan(10);

    const driveB = await api.getDriveTree(projB.data.id);
    expect(driveB.status).toBe(200);
    expect(driveB.data).toEqual([]);
    expect(nodesA.every((n) => n.projectId === projA.id)).toBe(true);
  });

  test("T1-F03-05 POST /api/projects/bootstrap-sandbox initializes [PILOTE - 326027] idempotently", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const first = await api.bootstrapSandbox();
    expect([200, 201]).toContain(first.status);
    expect(first.data.codeProjet).toBe(PILOT_PROJECT.codeProjet);
    expect(first.data.isSandbox).toBe(true);
    expect(first.data.driveInternalRootId).toBeTruthy();
    expect(first.data.driveExternalRootId).toBeTruthy();
    assertProdUntouched(first.data);

    const second = await api.bootstrapSandbox();
    expect([200, 201]).toContain(second.status);
    expect(second.data.id).toBe(first.data.id);

    const projects = await api.listProjects();
    const matchingPilot = projects.data.filter(
      (p) =>
        p.codeProjet === PILOT_PROJECT.codeProjet &&
        p.client === PILOT_PROJECT.client &&
        p.nomJeu === PILOT_PROJECT.nomJeu
    );
    expect(matchingPilot.length).toBe(1);
  });

  test("T1-F03-06 Command Center / reflects metrics exclusively for active project", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project: projA } = await createProvisionedProject(api, testInfo.workerIndex, "HubA");
    await api.addTalent(projA.id, { talentName: "Kalut" });

    const projB = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex + 40),
      client: "Client HubB",
      nomJeu: "Empty Game B",
      isSandbox: true,
    });
    expect(projB.status).toBe(201);

    await page.goto(`${BASE_URL}/?projectId=${projA.id}`);
    await expect(page.locator("body")).toContainText(projA.codeProjet);

    await page.goto(`${BASE_URL}/?projectId=${projB.data.id}`);
    await expect(page.locator("body")).toContainText(projB.data.codeProjet);
    await expect(page.locator("body")).not.toContainText(projA.codeProjet);
  });
});

// =============================================================================
// F4 — Code Projet Conflict Guardrail ("Zéro Mélange") (5 tests)
// =============================================================================
test.describe("Tier 1 — F4: Code Projet Conflict Guardrail (Zéro Mélange)", () => {
  test("T1-F04-01 Matching CP passes isolation guardrail check", async ({ request }, testInfo) => {
    const api = createApiClient(request);
    const cp = uniqueTestCp(testInfo.workerIndex);
    const proj = await api.createProject({
      codeProjet: cp,
      client: "Caisse d'Épargne",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    expect(proj.status).toBe(201);

    const check = await api.checkCpConflict(proj.data.id, {
      filename: `2026-09-01_${cp}_Vertigo_2500EUR.pdf`,
      extractedCp: cp,
      rawText: `Facture mission Fortnite CP ${cp} Caisse d'Épargne`,
    });
    expect(check.status).toBe(200);
    expect(check.data.hasConflict).toBe(false);
  });

  test("T1-F04-02 Document without foreign CP passes guardrail when matching project context", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const cp = uniqueTestCp(testInfo.workerIndex);
    const proj = await api.createProject({
      codeProjet: cp,
      client: "Caisse d'Épargne",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    expect(proj.status).toBe(201);

    const check = await api.checkCpConflict(proj.data.id, {
      filename: "devis_studio_assets_3d.pdf",
      extractedCp: null,
      rawText: "Caisse d'Épargne Fortnite création assets 3D sans numéro CP",
    });
    expect(check.status).toBe(200);
    expect(check.data.hasConflict).toBe(false);
    expect(check.data.detectedCps).toEqual([]);
  });

  test("T1-F04-03 Foreign CP 326018 inside active project triggers 409 Conflict and AuditLog", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const cp = uniqueTestCp(testInfo.workerIndex);
    const proj = await api.createProject({
      codeProjet: cp,
      client: "Caisse d'Épargne",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    expect(proj.status).toBe(201);

    const check = await api.checkCpConflict(proj.data.id, {
      filename: CONFLICT_CP_CRISTALINE.invoiceFilename,
      extractedCp: CONFLICT_CP_CRISTALINE.codeProjet,
      rawText: `Facture Cristaline CP ${CONFLICT_CP_CRISTALINE.codeProjet}`,
    });
    assertCpConflictBlocked(check, CONFLICT_CP_CRISTALINE.codeProjet, cp);

    const auditRes = await api.listAuditLogs(proj.data.id);
    expect(auditRes.status).toBe(200);
    assertAuditLogged(auditRes, {
      action: /CP_CONFLICT|CONFLICT_BLOCKED/i,
      detailsContain: CONFLICT_CP_CRISTALINE.codeProjet,
    });
  });

  test("T1-F04-04 Global red CP conflict alert banner appears in UI after conflict detection", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const cp = uniqueTestCp(testInfo.workerIndex);
    const proj = await api.createProject({
      codeProjet: cp,
      client: "Caisse d'Épargne",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    expect(proj.status).toBe(201);

    await api.checkCpConflict(proj.data.id, {
      filename: CONFLICT_CP_CRISTALINE.invoiceFilename,
      extractedCp: CONFLICT_CP_CRISTALINE.codeProjet,
      rawText: `Cristaline CP ${CONFLICT_CP_CRISTALINE.codeProjet}`,
    });

    await page.goto(`${BASE_URL}/?projectId=${proj.data.id}`);
    await assertRedAlertBanner(page, CONFLICT_CP_CRISTALINE.codeProjet);

    await page.goto(`${BASE_URL}/drive?projectId=${proj.data.id}`);
    await assertRedAlertBanner(page, CONFLICT_CP_CRISTALINE.codeProjet);
  });

  test("T1-F04-05 Quarantined CP conflict leaves project Drive tree and anchors untouched", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, nodes: nodesBefore } = await createProvisionedProject(
      api,
      testInfo.workerIndex,
      "Quarantine"
    );

    const check = await api.checkCpConflict(project.id, {
      filename: CONFLICT_CP_CRISTALINE.invoiceFilename,
      extractedCp: CONFLICT_CP_CRISTALINE.codeProjet,
      rawText: `Facture Cristaline CP ${CONFLICT_CP_CRISTALINE.codeProjet}`,
    });
    assertCpConflictBlocked(check, CONFLICT_CP_CRISTALINE.codeProjet, project.codeProjet);

    const nodesAfter = await api.getDriveTree(project.id);
    expect(nodesAfter.status).toBe(200);
    expect(nodesAfter.data.length).toBe(nodesBefore.length);
    expect(nodesAfter.data.map((n) => n.driveFileId)).toEqual(
      nodesBefore.map((n) => n.driveFileId)
    );
  });
});

// =============================================================================
// F5 — Sandbox Isolation Mode & PROD Write Protection (6 tests)
// =============================================================================
test.describe("Tier 1 — F5: Sandbox Isolation Mode & PROD Write Protection", () => {
  test("T1-F05-01 Sandbox bootstrap creates [PILOTE - 326027] & [EXT - PILOTE 326027] with zero PROD writes", async ({
    request,
  }) => {
    const api = createApiClient(request);
    await api.harness.resetCalls();

    const boot = await api.bootstrapSandbox();
    expect([200, 201]).toContain(boot.status);
    assertProdUntouched(boot.data);

    const calls = await api.harness.getCalls();
    expect(calls.status).toBe(200);
    assertProdUntouched(calls.data);
  });

  test("T1-F05-02 UI displays active Sandbox Mode badge and PROD lock indicator", async ({
    page,
    request,
  }) => {
    const api = createApiClient(request);
    const boot = await api.bootstrapSandbox();
    expect([200, 201]).toContain(boot.status);

    await page.goto(`${BASE_URL}/?projectId=${boot.data.id}`);
    await assertSandboxBadgeVisible(page, PILOT_PROJECT.codeProjet);

    await page.goto(`${BASE_URL}/settings`);
    await expect(page.locator("body")).toContainText(PROD_IDS.PROD_PROJECT_CE);
  });

  test("T1-F05-03 files.copy from PROD template into verified Sandbox folder is permitted", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const boot = await api.bootstrapSandbox();
    expect([200, 201]).toContain(boot.status);

    const tree = await api.getDriveTree(boot.data.id);
    const budgetFolder = findNodeByCode(tree.data, "001.1");
    expect(budgetFolder?.driveFileId).toBeTruthy();

    const copyProbe = await api.harness.probeSandboxWrite({
      operation: "copy",
      sourceId: PROD_IDS.PROD_BUDGET_SHEET,
      targetId: budgetFolder!.driveFileId!,
      parentId: budgetFolder!.driveFileId!,
      projectId: boot.data.id,
      name: "Budget Copie Sandbox Test",
    });
    expect(copyProbe.status).toBe(200);
    expect(copyProbe.data.copiedFileId ?? copyProbe.data.id).toBeTruthy();
    expect(copyProbe.data.copiedFileId ?? copyProbe.data.id).not.toBe(PROD_IDS.PROD_BUDGET_SHEET);
  });

  test("T1-F05-04 Full Drive tree, talent, and [EXT] sync operations never target any PROD ID", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    await api.harness.resetCalls();

    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "SafeOps");
    await api.addTalent(project.id, { talentName: "Kalut" });

    const seeded = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "kit-com-banniere.png",
      mimeType: "image/png",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });
    expect([200, 201]).toContain(seeded.status);

    const syncRes = await api.syncDriveToExt(project.id);
    expect(syncRes.status).toBe(200);

    const calls = await api.harness.getCalls();
    expect(calls.status).toBe(200);
    assertProdUntouched(calls.data);
  });

  test("T1-F05-05 GET /api/settings exposes sandboxModeEnabled and all 9 PROD_IMMUTABLE_IDS", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const res = await api.getSettings();
    expect(res.status).toBe(200);
    expect(res.data.sandboxModeEnabled ?? res.data.sandboxMode).toBe(true);

    const blockedIds = res.data.prodBlockedIds as string[];
    expect(Array.isArray(blockedIds)).toBe(true);
    for (const prodId of PROD_IMMUTABLE_IDS) {
      expect(blockedIds, `Expected ${prodId} in settings.prodBlockedIds`).toContain(prodId);
    }
  });

  test("T1-F05-06 Read-only metadata inspection on PROD reference ID succeeds without violation", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const readRes = await api.harness.probeSandboxRead(PROD_IDS.PROD_PROJECT_CE);
    expect(readRes.status).toBe(200);

    const audit = await api.listAuditLogs();
    const recentViolations = (audit.data ?? []).filter(
      (l) =>
        String(l.action ?? "").includes("SANDBOX_VIOLATION") &&
        String(l.targetId ?? "") === PROD_IDS.PROD_PROJECT_CE &&
        String(l.detailsJson ?? "").includes("sandbox-read")
    );
    expect(recentViolations).toEqual([]);
  });
});

// =============================================================================
// F6 — No Dummy / Hardcoded Google & Gemini Implementations (5 tests)
// =============================================================================
test.describe("Tier 1 — F6: Real Connectors & Zero Hardcoded Data", () => {
  test("T1-F06-01 Connected boundary operations route through gateway ports and record trace", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    await api.harness.resetCalls();

    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "Trace");
    const gemini = await api.testGemini();
    expect(gemini.status).toBe(200);

    const calls = await api.harness.getCalls();
    expect(calls.status).toBe(200);
    expect(calls.data.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(calls.data);
    expect(serialized).toMatch(/drive|create/i);
    expect(serialized).toMatch(/gemini|ping/i);
    expect(project.id).toBeTruthy();
  });

  test("T1-F06-03 Fresh project /drive view returns empty tree instead of hardcoded dummy folders", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const created = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "Client Vide",
      nomJeu: "Fortnite Vide",
      isSandbox: true,
    });
    expect(created.status).toBe(201);

    const driveRes = await api.getDriveTree(created.data.id);
    expect(driveRes.status).toBe(200);
    expect(driveRes.data).toEqual([]);

    await page.goto(`${BASE_URL}/drive?projectId=${created.data.id}`);
    await expect(page.locator("body")).not.toContainText("001.1 Budget");
    await expect(page.locator("body")).toContainText(/Provisionner|Initialiser|Aucun|001\./i);
  });

  test("T1-F06-05 Optional Live Sandbox smoke verifies real OAuth2 & Gemini when RUN_LIVE_SANDBOX_E2E=true", async ({
    request,
  }) => {
    test.skip(!IS_LIVE_SANDBOX, "RUN_LIVE_SANDBOX_E2E=true not enabled");
    const api = createApiClient(request, { boundaryHarness: false });
    const settings = await api.getSettings();
    expect(settings.status).toBe(200);
    expect(settings.data.googleConnected).toBe(true);
    expect(settings.data.sandboxModeEnabled ?? settings.data.sandboxMode).toBe(true);

    const gemini = await api.testGemini();
    expect(gemini.status).toBe(200);
    expect(gemini.data.ok).toBe(true);
  });
});

// =============================================================================
// F7 — Exhaustive 001. -> 006. Internal Tree Creation (6 tests)
// =============================================================================
test.describe("Tier 1 — F7: Exhaustive 001. -> 006. Internal Tree Creation", () => {
  test("T1-F07-01 Provisioning creates all 6 root sections 001..006 and all 4 [EXT] root sections", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, nodes } = await createProvisionedProject(api, testInfo.workerIndex, "TreeRoots");
    expect(project.driveInternalRootId).toBeTruthy();
    expect(project.driveExternalRootId).toBeTruthy();

    for (const rootName of INTERNAL_TOP_LEVEL_FOLDERS) {
      const code = rootName.slice(0, 3);
      const found = nodes.find((n) => n.code === code || n.name === rootName);
      expect(found, `Missing internal root ${rootName}`).toBeDefined();
      expect(found?.driveFileId).toBeTruthy();
    }

    const calls = await api.harness.getCalls();
    const serialized = JSON.stringify(calls.data) + JSON.stringify(nodes);
    for (const extFolder of EXT_MIRROR_FOLDERS) {
      expect(serialized).toContain(extFolder);
    }
    for (const extSub of EXT_PRODUCTION_SUBFOLDERS) {
      expect(serialized).toContain(extSub);
    }
  });

  test("T1-F07-02 Provisioning creates all 001., 002., 003., 005., and 006. subfolders", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { nodes } = await createProvisionedProject(api, testInfo.workerIndex, "Subfolders");
    assertDriveTreeComplete(nodes);

    const expectedNames = [
      "001.1 Budget",
      "001.2 Devis",
      "001.3 Factures",
      "002.1 Rétroplanning Actif",
      "002.2 Historique Rétroplanning",
      "002.3 Comptes Rendus",
      "003.1 Kick-off & Recommandations",
      "003.2 Weeklys Clients",
      "003.3 _Archives",
      "005.1 Contrats Client",
      "005.2 Contrats Prestataires & Talents",
      "005.3 Règlements & Conformité",
      "006.1 Données Brutes",
      "006.2 Reporting Excel & Sheets",
      "006.3 Reporting Client (Slides)",
      ...INTERNAL_NESTED_SUBFOLDERS["006.1"],
    ];

    const allNames = nodes.map((n) => n.name);
    for (const name of expectedNames) {
      expect(allNames, `Missing folder ${name}`).toContain(name);
    }
  });

  test("T1-F07-03 Provisioning creates exhaustive 004. Production nested hierarchy", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { nodes } = await createProvisionedProject(api, testInfo.workerIndex, "Prod004");
    const allNames = nodes.map((n) => n.name);

    for (const spec of INTERNAL_FOLDER_SPECS.filter((s) => s.code.startsWith("004."))) {
      expect(allNames).toContain(spec.name);
    }
    for (const group of ["004.2", "004.3", "004.4", "004.5", "004.6"]) {
      for (const child of INTERNAL_NESTED_SUBFOLDERS[group]) {
        expect(allNames, `Missing ${group} child ${child}`).toContain(child);
      }
    }
    for (const leaf of INTERNAL_004_4_LEAF_SUBFOLDERS) {
      expect(allNames, `Missing 004.4 leaf ${leaf}`).toContain(leaf);
    }
  });

  test("T1-F07-04 DriveNode & SyncStatus initialize internal-only vs syncable flags accurately", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { nodes } = await createProvisionedProject(api, testInfo.workerIndex, "SyncFlags");

    for (const code of ["001.1", "001.2", "001.3", "002.2", "003.3", "005.1", "005.2", "006.1", "006.2"]) {
      const node = findNodeByCode(nodes, code);
      expect(node, `Missing ${code}`).toBeDefined();
      expect(node?.isExtEligible).toBe(false);
    }

    const retroNode = findNodeByCode(nodes, "002.1");
    expect(retroNode).toBeDefined();
    expect(retroNode?.isExtEligible).toBe(false);
    expect(retroNode?.allowPermanentExtSync).toBe(false);

    for (const code of ["002.3", "003.1", "003.2", "004.4", "006.3"]) {
      const node = findNodeByCode(nodes, code);
      expect(node, `Missing ${code}`).toBeDefined();
      expect(node?.isExtEligible).toBe(true);
    }
  });

  test("T1-F07-05 Re-running Drive tree provisioning is 100% idempotent with zero duplicates", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, nodes: initialNodes } = await createProvisionedProject(
      api,
      testInfo.workerIndex,
      "IdempotentTree"
    );

    const initialIds = new Map(initialNodes.map((n) => [n.code, n.driveFileId]));
    const secondRes = await api.provisionDriveTree(project.id);
    expect([200, 201]).toContain(secondRes.status);

    const afterNodes = (await api.getDriveTree(project.id)).data;
    expect(afterNodes.length).toBe(initialNodes.length);
    for (const node of afterNodes) {
      expect(node.driveFileId).toBe(initialIds.get(node.code));
    }
  });

  test("T1-F07-06 /drive UI renders full 001..006 tree with eligibility badges", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "DriveUI");

    await page.goto(`${BASE_URL}/drive?projectId=${project.id}`);
    for (const root of INTERNAL_TOP_LEVEL_FOLDERS) {
      await expect(page.locator("body")).toContainText(root);
    }
    await expect(page.locator("body")).toContainText("002.1 Rétroplanning Actif");
    await expect(page.locator("body")).toContainText(/Interne uniquement|Jamais synchronis/i);
  });
});

// =============================================================================
// F8 — Dynamic Talent Subfolder Provisioning (5 tests)
// =============================================================================
test.describe("Tier 1 — F8: Dynamic Talent Subfolder Provisioning", () => {
  test("T1-F08-01 Adding talent creates 004.3/02_Talents/<Nom> and 006.1/02_Influence/<Nom> trees", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "TalentKalut");

    const addRes = await api.addTalent(project.id, { talentName: "Kalut" });
    expect([200, 201]).toContain(addRes.status);

    const nodes = (await api.getDriveTree(project.id)).data;
    const names = nodes.map((n) => n.name);
    expect(names).toContain("Kalut");
    for (const sub of TALENT_SUBFOLDERS_004_3) {
      expect(names).toContain(sub);
    }
    for (const net of INFLUENCE_PLATFORM_FOLDER_LABELS) {
      expect(names).toContain(net);
    }
  });

  test("T1-F08-02 Provisioning all 4 Pilot CE talents (Kalut, Aksianka, Allyson, Wig) succeeds", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "4Talents");

    for (const talentName of PILOT_PROJECT.talents) {
      const res = await api.addTalent(project.id, { talentName });
      expect([200, 201]).toContain(res.status);
    }

    const nodes = (await api.getDriveTree(project.id)).data;
    for (const talentName of PILOT_PROJECT.talents) {
      const talentNodes = nodes.filter((n) => n.name === talentName);
      expect(talentNodes.length).toBeGreaterThanOrEqual(2);
      for (const n of talentNodes) {
        expect(n.driveFileId).toBeTruthy();
      }
    }
  });

  test("T1-F08-03 Re-adding existing talent is idempotent and preserves existing DriveNode IDs", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "TalentIdemp");

    const first = await api.addTalent(project.id, { talentName: "Aksianka" });
    expect([200, 201]).toContain(first.status);
    const nodesAfterFirst = (await api.getDriveTree(project.id)).data;
    const firstTalentFileIds = nodesAfterFirst
      .filter((n) => n.name === "Aksianka")
      .map((n) => n.driveFileId)
      .sort();

    const second = await api.addTalent(project.id, { talentName: "Aksianka" });
    expect([200, 201]).toContain(second.status);
    const nodesAfterSecond = (await api.getDriveTree(project.id)).data;

    expect(nodesAfterSecond.length).toBe(nodesAfterFirst.length);
    const secondTalentFileIds = nodesAfterSecond
      .filter((n) => n.name === "Aksianka")
      .map((n) => n.driveFileId)
      .sort();
    expect(secondTalentFileIds).toEqual(firstTalentFileIds);
  });

  test("T1-F08-04 Adding a talent from UI immediately updates /drive tree", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "TalentUI");

    await page.goto(`${BASE_URL}/drive?projectId=${project.id}`);
    const input = page
      .locator('input[name="talentName"], input[placeholder*="Talent"], input[placeholder*="Kalut"]')
      .first();
    await input.fill("Allyson");
    await page
      .locator("button")
      .filter({ hasText: /Ajouter.*talent|Cr[ée]er.*talent|Provisionner/i })
      .first()
      .click();

    await expect(page.locator("body")).toContainText("Allyson");
    await expect(page.locator("body")).toContainText("Script");
    await expect(page.locator("body")).toContainText("Validations");
  });

  test("T1-F08-05 Talent subfolder provisioning is strictly scoped to target projectId", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project: p1 } = await createProvisionedProject(api, testInfo.workerIndex, "TalP1");
    const { project: p2 } = await createProvisionedProject(api, testInfo.workerIndex + 50, "TalP2");

    await api.addTalent(p1.id, { talentName: "Wig" });

    const p1Nodes = (await api.getDriveTree(p1.id)).data;
    const p2Nodes = (await api.getDriveTree(p2.id)).data;

    expect(p1Nodes.some((n) => n.name === "Wig")).toBe(true);
    expect(p2Nodes.some((n) => n.name === "Wig")).toBe(false);
  });
});

// =============================================================================
// F9 — Client Mirror [EXT] & Drift Detection (6 tests)
// =============================================================================
test.describe("Tier 1 — F9: Client Mirror [EXT] & Drift Detection", () => {
  test("T1-F09-01 Eligible node transitions cleanly Brouillon Interne -> En Revue -> Validé Client", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "Workflow");

    const seeded = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "key-art-fortnite.png",
      mimeType: "image/png",
      validationStatus: "BROUILLON_INTERNE",
      isFolder: false,
    });
    expect([200, 201]).toContain(seeded.status);

    const toReview = await api.updateDriveNode(project.id, seeded.data.id, {
      validationStatus: "EN_REVUE",
    });
    expect(toReview.status).toBe(200);
    expect(toReview.data.validationStatus).toBe("EN_REVUE");

    const toValidated = await api.updateDriveNode(project.id, seeded.data.id, {
      validationStatus: "VALIDE_CLIENT",
    });
    expect(toValidated.status).toBe(200);
    expect(toValidated.data.validationStatus).toBe("VALIDE_CLIENT");
    expect(toValidated.data.driftDetected).toBe(true);
  });

  test("T1-F09-02 sync-ext mirrors Validé Client file into [EXT] and clears drift", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "ExtSync");

    const seeded = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "kit-com-banniere-v1.png",
      mimeType: "image/png",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });
    expect([200, 201]).toContain(seeded.status);

    const syncRes = await api.syncDriveToExt(project.id);
    expect(syncRes.status).toBe(200);

    const treeAfter = (await api.getDriveTree(project.id)).data;
    const updatedNode = treeAfter.find((n) => n.id === seeded.data.id);
    expect(updatedNode?.extMirrorFileId).toBeTruthy();
    expect(updatedNode?.lastSyncedAt).toBeTruthy();
    expect(updatedNode?.driftDetected).toBe(false);
    assertProdUntouched(treeAfter);
  });

  test("T1-F09-03 Internal modification after [EXT] sync triggers Décalage Interne/Client détecté badge", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "DriftBadge");

    const seeded = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "poster-a3.png",
      mimeType: "image/png",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });
    await api.syncDriveToExt(project.id);

    const drifted = await api.harness.simulateInternalDrift(project.id, seeded.data.id, {
      contentHash: "sha256-v2-modified",
    });
    expect(drifted.status).toBe(200);
    expect(drifted.data.driftDetected).toBe(true);

    await page.goto(`${BASE_URL}/drive?projectId=${project.id}`);
    await assertExtDriftBadgeVisible(page);
  });

  test("T1-F09-04 Re-syncing drifted binary file uses files.update in-place preserving [EXT] File ID", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "InPlaceUpdate");

    const seeded = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "logo-jeu-final.png",
      mimeType: "image/png",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });
    await api.syncDriveToExt(project.id);

    const firstNode = (await api.getDriveTree(project.id)).data.find((n) => n.id === seeded.data.id);
    const originalExtId = firstNode?.extMirrorFileId;
    expect(originalExtId).toBeTruthy();

    await api.harness.simulateInternalDrift(project.id, seeded.data.id, {
      contentHash: "sha256-v3-updated",
    });
    await api.harness.resetCalls();

    const resync = await api.syncDriveToExt(project.id);
    expect(resync.status).toBe(200);

    const afterNode = (await api.getDriveTree(project.id)).data.find((n) => n.id === seeded.data.id);
    expect(afterNode?.extMirrorFileId).toBe(originalExtId);
    expect(afterNode?.driftDetected).toBe(false);

    const calls = await api.harness.getCalls();
    const updateCalls = calls.data.filter(
      (c) =>
        /update/i.test(String(c.operation ?? c.method ?? "")) &&
        String(c.targetId ?? c.fileId ?? "") === originalExtId
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("T1-F09-05 Validated 003.2 Weekly Slides & 006.3 Reporting Slides sync cleanly to [EXT]", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "SlidesSync");

    const weeklyNode = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "003.2",
      name: "2026-09-11 - Weekly Caisse d'Epargne",
      mimeType: "application/vnd.google-apps.presentation",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });
    const reportingNode = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "006.3",
      name: "Reporting - Caisse d'Epargne",
      mimeType: "application/vnd.google-apps.presentation",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });

    const syncRes = await api.syncDriveToExt(project.id);
    expect(syncRes.status).toBe(200);

    const tree = (await api.getDriveTree(project.id)).data;
    expect(tree.find((n) => n.id === weeklyNode.data.id)?.extMirrorFileId).toBeTruthy();
    expect(tree.find((n) => n.id === reportingNode.data.id)?.extMirrorFileId).toBeTruthy();
  });

  test("T1-F09-06 Command Center / and /drive accurately reflect live [EXT] drift counter", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "DriftCount");

    await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "visuel-1.png",
      mimeType: "image/png",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });
    await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.2",
      name: "capture-map-1.png",
      mimeType: "image/png",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });

    await page.goto(`${BASE_URL}/?projectId=${project.id}`);
    await expect(page.locator("body")).toContainText(
      /\b2\s*(d[ée]calage|drift)|d[ée]calage[s]?\s*:\s*2\b/i
    );

    await api.syncDriveToExt(project.id);
    await page.reload();
    await expect(page.locator("body")).toContainText(/0\s*(d[ée]calage|drift)|synchronis[ée]/i);
  });
});

// =============================================================================
// F10 — 002.1 Rétroplanning Actif Never Permanently Synced to [EXT] (5 tests)
// =============================================================================
test.describe("Tier 1 — F10: 002.1 Rétroplanning Actif Never Permanently Synced", () => {
  test("T1-F10-01 Provisioned 002.1 node enforces allowPermanentExtSync: false and isExtEligible: false", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { nodes } = await createProvisionedProject(api, testInfo.workerIndex, "RetroPolicy");
    assertRetroplanningNeverAutoSyncedToExt(nodes);
  });

  test("T1-F10-02 /drive UI displays internal-only lock badge on 002.1 and manual export-once button", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "RetroUI");

    await page.goto(`${BASE_URL}/drive?projectId=${project.id}`);
    await expect(page.locator("body")).toContainText("002.1 Rétroplanning Actif");
    await expect(page.locator("body")).toContainText(/Jamais synchronis|Strictement interne/i);
    await expect(
      page.locator("button").filter({ hasText: /Export ponctuel/i }).first()
    ).toBeVisible();
  });

  test("T1-F10-03 Global sync-ext syncs validated 002.3 Comptes Rendus while skipping 002.1", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "Skip0021");

    const crNode = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "002.3",
      name: "CR-Kickoff-CE.pdf",
      mimeType: "application/pdf",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });

    const syncRes = await api.syncDriveToExt(project.id);
    expect(syncRes.status).toBe(200);
    assertRetroplanningNeverAutoSyncedToExt(syncRes.data);

    const tree = (await api.getDriveTree(project.id)).data;
    assertRetroplanningNeverAutoSyncedToExt(tree);
    expect(tree.find((n) => n.id === crNode.data.id)?.extMirrorFileId).toBeTruthy();
  });

  test("T1-F10-04 Explicit export-once creates frozen [EXT] copy and AuditLog", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "ExportOnce");

    const exp = await api.exportRetroplanningOnce(project.id, {
      explicitManualExportConfirm: true,
      targetFormat: "COPY",
    });
    expect([200, 201]).toContain(exp.status);
    expect(exp.data.exportedFileId ?? exp.data.driveFileId).toBeTruthy();

    const audit = await api.listAuditLogs(project.id);
    assertAuditLogged(audit, {
      action: /RETROPLANNING.*EXPORT_ONCE|MANUAL_EXPORT/i,
    });
  });

  test("T1-F10-05 After manual export-once, 002.1 retains allowPermanentExtSync: false with no continuous link", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "AfterExport");

    const exp = await api.exportRetroplanningOnce(project.id, {
      explicitManualExportConfirm: true,
    });
    expect([200, 201]).toContain(exp.status);

    const tree = (await api.getDriveTree(project.id)).data;
    assertRetroplanningNeverAutoSyncedToExt(tree);
  });
});

// =============================================================================
// F24 — Internal Cron / Scheduled Jobs + Audit Logging (5 tests)
// =============================================================================
test.describe("Tier 1 — F24: Internal Cron / Scheduled Jobs + Audit Logging", () => {
  test("T1-F24-01 M1 mutations persist structured AuditLog entries with actor, action, target, details", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "AuditTrail");
    await api.addTalent(project.id, { talentName: "Kalut" });
    await api.exportRetroplanningOnce(project.id, { explicitManualExportConfirm: true });

    const auditRes = await api.listAuditLogs(project.id);
    expect(auditRes.status).toBe(200);
    expect(auditRes.data.length).toBeGreaterThanOrEqual(3);

    const firstLog = auditRes.data[0];
    expect(firstLog.projectId).toBe(project.id);
    expect(firstLog.actor).toBeTruthy();
    expect(firstLog.action).toBeTruthy();
    expect(firstLog.targetType).toBeTruthy();
    expect(firstLog.createdAt).toBeTruthy();
  });

  test("T1-F24-02 AuditLog queries are strictly scoped by projectId", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project: p1 } = await createProvisionedProject(api, testInfo.workerIndex, "AuditP1");
    const { project: p2 } = await createProvisionedProject(api, testInfo.workerIndex + 60, "AuditP2");

    await api.addTalent(p1.id, { talentName: "Kalut" });
    await api.addTalent(p2.id, { talentName: "Wig" });

    const audit1 = await api.listAuditLogs(p1.id);
    const audit2 = await api.listAuditLogs(p2.id);

    expect(audit1.status).toBe(200);
    expect(audit2.status).toBe(200);
    expect(audit1.data.every((l) => l.projectId === p1.id)).toBe(true);
    expect(audit2.data.every((l) => l.projectId === p2.id)).toBe(true);
    expect(JSON.stringify(audit1.data)).not.toContain(p2.id);
  });

  test("T1-F24-03 POST /api/cron/run executes Drive drift sweep cleanly and logs run", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "CronRun");

    const cronRes = await api.triggerSchedulerJob("DRIVE_DRIFT_CHECK", project.id);
    expect(cronRes.status).toBe(200);

    const audit = await api.listAuditLogs(project.id);
    assertAuditLogged(audit, { action: /CRON|SCHEDULER|DRIVE_DRIFT/i });
  });

  test("T1-F24-04 Security rejections (CP conflict & PROD write guard) are always persisted in AuditLog", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "SecAudit");

    await api.checkCpConflict(project.id, {
      filename: CONFLICT_CP_CRISTALINE.invoiceFilename,
      extractedCp: CONFLICT_CP_CRISTALINE.codeProjet,
      rawText: "CP 326018",
    });

    await api.harness.probeSandboxWrite({
      operation: "update",
      targetId: PROD_IDS.PROD_PROJECT_CE,
      projectId: project.id,
    });

    const projectAudit = await api.listAuditLogs(project.id);
    assertAuditLogged(projectAudit, { action: /CP_CONFLICT/i });

    const globalAudit = await api.listAuditLogs();
    assertAuditLogged(globalAudit, {
      action: /SANDBOX_VIOLATION/i,
      targetId: PROD_IDS.PROD_PROJECT_CE,
    });
  });

  test("T1-F24-05 UI surfaces project audit activity trail on / cleanly", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "AuditUI");
    await api.addTalent(project.id, { talentName: "Aksianka" });

    await page.goto(`${BASE_URL}/?projectId=${project.id}`);
    await expect(page.locator("body")).toContainText(/Journal|Audit|Activit[ée]|Aksianka/i);
  });
});
});

// Serial unconfigured group kept outside Connected Harness Tests so restoreConfigured beforeEach never overrides it
test.describe.serial("Tier 1 — F6 Unconfigured State (No Dummy Fallbacks)", () => {
  test.beforeAll(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.setUnconfigured({ google: true, gemini: true });
  });

  test.beforeEach(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.setUnconfigured({ google: true, gemini: true });
  });

  test.afterAll(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.restoreConfigured();
  });

  test("T1-F06-02 Fresh unconfigured state displays disconnected badges on /settings", async ({
    page,
    request,
  }) => {
    const api = createApiClient(request);
    const res = await api.getSettings();
    expect(res.status).toBe(200);
    expect(res.data.googleConnected).toBe(false);
    expect(res.data.geminiKeyConfigured ?? res.data.geminiConfigured).toBe(false);

    await page.goto(`${BASE_URL}/settings`);
    await expect(page.locator("body")).toContainText(/Non connect[ée]|Manquant|Non configur[ée]/i);
  });

  test("T1-F06-04 Command Center / shows zero hardcoded dummy Caisse d'Épargne KPIs when unconfigured", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const created = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "Client Neutre",
      nomJeu: "Jeu Neutre",
      isSandbox: true,
    });
    expect(created.status).toBe(201);

    await page.goto(`${BASE_URL}/?projectId=${created.data.id}`);
    await expect(page.locator("body")).toContainText("Client Neutre");
    await expect(page.locator("body")).not.toContainText("FAC-2026-DUMMY");
  });
});
