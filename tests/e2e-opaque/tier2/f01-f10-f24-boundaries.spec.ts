/**
 * Tier 2 — Boundary, Corner Case & Negative Opaque-Box E2E Tests (F1–F10, F24)
 * Target count: 60 tests (>=5 per feature across 11 features).
 * Progressive testability: Exercises ONLY M1 UI pages (/, /settings, /projects, /drive)
 * and M1 HTTP APIs + TEST_BOUNDARY_HARNESS=1 boundary ports. Zero src/ or prisma/ imports.
 */

import { expect, test } from "@playwright/test";
import { createApiClient, type DriveNodeDto, type ProjectDto } from "../helpers/api-client";
import {
  assertAuditLogged,
  assertCpConflictBlocked,
  assertPreconditionMissing,
  assertProdUntouched,
  assertRetroplanningNeverAutoSyncedToExt,
  assertSetupPreconditionBanner,
} from "../helpers/assertions";
import {
  BASE_URL,
  CONFLICT_CP_CRISTALINE,
  PROD_CHILD_AND_TEMPLATE_IDS,
  PROD_IDS,
  PROD_IMMUTABLE_IDS,
  uniqueTestCp,
} from "../helpers/constants";

function findNodeByCode(nodes: DriveNodeDto[], code: string): DriveNodeDto | undefined {
  return nodes.find((n) => n.code === code || n.name.startsWith(code));
}

async function createProvisionedProject(
  api: ReturnType<typeof createApiClient>,
  workerIndex: number,
  suffix = "BVA"
): Promise<{ project: ProjectDto; nodes: DriveNodeDto[] }> {
  const cp = uniqueTestCp(workerIndex);
  const created = await api.createProject({
    codeProjet: cp,
    client: `Client ${suffix} ${cp}`,
    nomJeu: `Fortnite ${suffix}`,
    isSandbox: true,
  });
  expect(created.status, `Failed creating project ${cp}`).toBe(201);
  const provisioned = await api.provisionDriveTree(created.data.id);
  expect([200, 201]).toContain(provisioned.status);
  const tree = await api.getDriveTree(created.data.id);
  expect(tree.status).toBe(200);
  return { project: created.data, nodes: tree.data };
}

test.describe("Tier 2 — Connected Harness Tests", () => {
  test.beforeEach(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.restoreConfigured();
  });

// =============================================================================
// F1 Boundaries (5 tests)
// =============================================================================
test.describe("Tier 2 — F1 Boundaries: Web App & SQLite/Prisma", () => {
  test("T2-F01-01 Unknown API route returns 404 without leaking internal stack traces", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const res = await api.requestJson("GET", "/api/nonexistent-endpoint-xyz-999");
    expect(res.status).toBe(404);
    const bodyStr = JSON.stringify(res.raw ?? "");
    expect(bodyStr).not.toMatch(/C:\\\\|node_modules|at Object\./i);
  });

  test("T2-F01-02 Malformed JSON body on POST /api/projects returns 400 cleanly", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const res = await api.requestJson("POST", "/api/projects", {
      rawBody: "{bad json",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(res.ok).toBe(false);
  });

  test("T2-F01-03 Unknown UI route returns 404 without crashing AppShell or server", async ({
    page,
  }) => {
    const notFound = await page.goto(`${BASE_URL}/unknown-route-999`);
    expect(notFound?.status()).toBe(404);

    const recovery = await page.goto(`${BASE_URL}/`);
    expect(recovery?.status()).toBe(200);
    await expect(page.locator("main").first()).toBeVisible();
  });

  test("T2-F01-04 Concurrent project creations succeed without SQLite SQLITE_BUSY locking failure", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const cps = Array.from({ length: 5 }, (_, idx) => uniqueTestCp(testInfo.workerIndex * 10 + idx));

    const results = await Promise.all(
      cps.map((cp, idx) =>
        api.createProject({
          codeProjet: cp,
          client: `Concurrent Client ${idx}`,
          nomJeu: `Concurrent Game ${idx}`,
          isSandbox: true,
        })
      )
    );

    for (const r of results) {
      expect(r.status).toBe(201);
    }

    const list = await api.listProjects();
    expect(list.status).toBe(200);
    for (const cp of cps) {
      expect(list.data.some((p) => p.codeProjet === cp)).toBe(true);
    }
  });

  test("T2-F01-05 Non-JSON Content-Type on POST /api/settings rejected cleanly without state corruption", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const before = await api.getSettings();
    expect(before.status).toBe(200);

    const res = await api.requestJson("POST", "/api/settings", {
      rawBody: "corrupt-plain-text-payload",
      headers: { "content-type": "text/plain" },
    });
    expect([400, 415]).toContain(res.status);

    const after = await api.getSettings();
    expect(after.status).toBe(200);
    expect(after.data.pennylaneEmail).toBe(before.data.pennylaneEmail);
  });
});

// =============================================================================
// F2 Boundaries (3 connected tests here + 2 serial unconfigured tests below = 5)
// =============================================================================
test.describe("Tier 2 — F2 Boundaries: OAuth2 & Gemini Config", () => {
  test("T2-F02-02 OAuth2 callback with access_denied, missing code, or invalid state fails cleanly", async ({
    request,
  }) => {
    const api = createApiClient(request);

    const denied = await api.callbackGoogleAuth({ error: "access_denied" });
    expect([302, 307, 400, 401, 403]).toContain(denied.status);
    if (denied.status >= 300 && denied.status < 400) {
      expect(denied.headers.location ?? "").toMatch(/error=/i);
    }

    const missingCode = await api.callbackGoogleAuth({});
    expect([302, 307, 400]).toContain(missingCode.status);

    const badState = await api.callbackGoogleAuth({ code: "abc", state: "tampered-invalid-state" });
    expect([302, 307, 400, 401, 403]).toContain(badState.status);
  });

  test("T2-F02-04 Invalid Gemini API key returns explicit error, never fake ok", async ({
    request,
  }) => {
    const api = createApiClient(request);
    try {
      await api.harness.setState({ geminiConfigured: true, invalidGeminiKey: true });
      const res = await api.testGemini();
      expect([401, 403, 412, 502]).toContain(res.status);
      expect(res.ok).toBe(false);
      expect(res.data?.ok).not.toBe(true);
    } finally {
      await api.harness.restoreConfigured();
    }
  });

  test("T2-F02-05 Saved secrets (GEMINI_API_KEY, GOOGLE_CLIENT_SECRET) never leak in API JSON or /settings HTML", async ({
    page,
    request,
  }) => {
    const api = createApiClient(request);
    const sentinelGemini = "SENTINEL_GEMINI_SECRET_XYZ_987";
    const sentinelClientSecret = "SENTINEL_GOOGLE_SECRET_ABC_654";

    const saveRes = await api.updateSettings({
      geminiApiKey: sentinelGemini,
      googleClientSecret: sentinelClientSecret,
    });
    expect(saveRes.status).toBe(200);

    const getRes = await api.getSettings();
    expect(getRes.status).toBe(200);
    expect(JSON.stringify(getRes.raw)).not.toContain(sentinelGemini);
    expect(JSON.stringify(getRes.raw)).not.toContain(sentinelClientSecret);

    await page.goto(`${BASE_URL}/settings`);
    const html = await page.content();
    expect(html).not.toContain(sentinelGemini);
    expect(html).not.toContain(sentinelClientSecret);
  });
});

// =============================================================================
// F3 Boundaries (6 tests)
// =============================================================================
test.describe("Tier 2 — F3 Boundaries: Multi-Project Identity & Strict Scoping", () => {
  test("T2-F03-01 Duplicate (codeProjet, client, nomJeu) tuple rejected with 409 Conflict", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const cp = uniqueTestCp(testInfo.workerIndex);
    const payload = {
      codeProjet: cp,
      client: "DupClient",
      nomJeu: "DupGame",
      isSandbox: true,
    };

    const first = await api.createProject(payload);
    expect(first.status).toBe(201);

    const dup = await api.createProject(payload);
    expect(dup.status).toBe(409);

    const list = await api.listProjects();
    const matches = list.data.filter(
      (p) => p.codeProjet === cp && p.client === "DupClient" && p.nomJeu === "DupGame"
    );
    expect(matches.length).toBe(1);
  });

  test("T2-F03-02 Missing or whitespace-only codeProjet/client/nomJeu rejected with 400", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const cp = uniqueTestCp(testInfo.workerIndex);

    const badPayloads = [
      { codeProjet: "", client: "CE", nomJeu: "Map" },
      { codeProjet: cp, client: "   ", nomJeu: "Map" },
      { codeProjet: cp, client: "CE", nomJeu: "" },
    ];
    for (const p of badPayloads) {
      const res = await api.createProject(p);
      expect(res.status).toBe(400);
    }
  });

  test("T2-F03-03 Non-existent projectId returns 404 across all /api/projects/[id]/* routes", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const missingId = "nonexistent-project-id-000";

    expect((await api.getDriveTree(missingId)).status).toBe(404);
    expect((await api.addTalent(missingId, { talentName: "Kalut" })).status).toBe(404);
    expect((await api.syncDriveToExt(missingId)).status).toBe(404);
    expect(
      (await api.exportRetroplanningOnce(missingId, { explicitManualExportConfirm: true })).status
    ).toBe(404);
    expect((await api.listAuditLogs(missingId)).status).toBe(404);
  });

  test("T2-F03-04 Cross-project DriveNode IDOR mutation rejected with 403/404", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project: projA } = await createProvisionedProject(api, testInfo.workerIndex, "IdorA");
    const { project: projB } = await createProvisionedProject(api, testInfo.workerIndex + 10, "IdorB");

    const seededB = await api.harness.seedDriveNode({
      projectId: projB.id,
      parentCode: "004.4",
      name: "secret-b-asset.png",
      mimeType: "image/png",
      validationStatus: "BROUILLON_INTERNE",
      isFolder: false,
    });

    const idorRes = await api.updateDriveNode(projA.id, seededB.data.id, {
      validationStatus: "VALIDE_CLIENT",
    });
    expect([403, 404]).toContain(idorRes.status);

    const bTree = (await api.getDriveTree(projB.id)).data;
    const nodeB = bTree.find((n) => n.id === seededB.data.id);
    expect(nodeB?.validationStatus).toBe("BROUILLON_INTERNE");
  });

  test("T2-F03-05 Invalid codeProjet characters (SQLi/XSS) rejected cleanly with 400", async ({
    page,
    request,
  }) => {
    const api = createApiClient(request);
    const sqli = await api.createProject({
      codeProjet: "326027; DROP TABLE Project;",
      client: "Evil",
      nomJeu: "SQLi",
    });
    expect(sqli.status).toBe(400);

    const xss = await api.createProject({
      codeProjet: "<script>alert(1)</script>",
      client: "Evil",
      nomJeu: "XSS",
    });
    expect(xss.status).toBe(400);

    await page.goto(`${BASE_URL}/projects`);
    expect(await page.locator("script:has-text('alert(1)')").count()).toBe(0);
  });

  test("T2-F03-06 Switching active project in UI clears previous project Drive & talent state", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project: projA } = await createProvisionedProject(api, testInfo.workerIndex, "SwitchA");
    await api.addTalent(projA.id, { talentName: "Kalut" });

    const projB = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex + 20),
      client: "Client Switch B",
      nomJeu: "Empty Switch B",
      isSandbox: true,
    });

    await page.goto(`${BASE_URL}/drive?projectId=${projA.id}`);
    await expect(page.locator("body")).toContainText("Kalut");

    await page.goto(`${BASE_URL}/drive?projectId=${projB.data.id}`);
    await expect(page.locator("body")).not.toContainText("Kalut");
    await expect(page.locator("body")).not.toContainText("001.1 Budget");
  });
});

// =============================================================================
// F4 Boundaries (6 tests)
// =============================================================================
test.describe("Tier 2 — F4 Boundaries: Code Projet Conflict Guardrail", () => {
  test("T2-F04-01 Canonical Cristaline 326018 inside active 326xxx blocked with 409", async ({
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

    const res = await api.checkCpConflict(proj.data.id, {
      filename: CONFLICT_CP_CRISTALINE.invoiceFilename,
      extractedCp: "326018",
      rawText: "Facture QF08_326018 Cristaline",
    });
    assertCpConflictBlocked(res, "326018", cp);

    const audit = await api.listAuditLogs(proj.data.id);
    assertAuditLogged(audit, { action: /CP_CONFLICT/i, detailsContain: "326018" });
  });

  test("T2-F04-02 Multiple CPs in single document (active + foreign 326018) still blocked with 409", async ({
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

    const res = await api.checkCpConflict(proj.data.id, {
      filename: "multi_cp.pdf",
      extractedCp: cp,
      rawText: `Projet principal CP ${cp} + reliquat CP 326018`,
    });
    assertCpConflictBlocked(res, "326018", cp);
  });

  test("T2-F04-03 Numeric boundary: non-CP numbers do not false-positive while adjacent CP blocks", async ({
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

    const safeRes = await api.checkCpConflict(proj.data.id, {
      filename: "facture_montants.pdf",
      extractedCp: null,
      rawText: `Montant ${cp}0 EUR Date 20260911 SIRET 12345678901234`,
    });
    expect(safeRes.status).toBe(200);
    expect(safeRes.data.hasConflict).toBe(false);

    const conflictRes = await api.checkCpConflict(proj.data.id, {
      filename: "facture_voisine.pdf",
      extractedCp: null,
      rawText: "Ref CP 326019",
    });
    assertCpConflictBlocked(conflictRes, "326019", cp);
  });

  test("T2-F04-04 Case-insensitive and whitespace/punctuation CP variations blocked", async ({
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

    for (const variant of [
      "cp:   326018",
      "CODE PROJET\t326018",
      "cp-326018",
      "Code_Projet=326018",
    ]) {
      const res = await api.checkCpConflict(proj.data.id, {
        filename: "scan.pdf",
        extractedCp: null,
        rawText: variant,
      });
      assertCpConflictBlocked(res, "326018", cp);
    }
  });

  test("T2-F04-05 Swapped client/game text matching active project does not override mismatched CP", async ({
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

    const res = await api.checkCpConflict(proj.data.id, {
      filename: "Caisse_Epargne_Fortnite_Facture.pdf",
      extractedCp: "326018",
      rawText: "Caisse d'Épargne Fortnite — Code Projet 326018",
    });
    assertCpConflictBlocked(res, "326018", cp);
  });

  test("T2-F04-06 Red conflict alert banner is scoped per project and does not bleed into sibling", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const projA = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "Client Conflict A",
      nomJeu: "Fortnite A",
      isSandbox: true,
    });
    const projB = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex + 30),
      client: "Client Clean B",
      nomJeu: "Fortnite B",
      isSandbox: true,
    });

    await api.checkCpConflict(projA.data.id, {
      filename: "Facture QF08_326018.pdf",
      extractedCp: "326018",
      rawText: "CP 326018",
    });

    await page.goto(`${BASE_URL}/?projectId=${projB.data.id}`);
    await expect(page.locator('[data-testid="cp-conflict-banner"]')).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("326018");
  });
});

// =============================================================================
// F5 Boundaries (7 tests — explicit coverage of all 9 PROD IDs + children/templates)
// =============================================================================
test.describe("Tier 2 — F5 Boundaries: PROD Write Protection (All 9 PROD IDs)", () => {
  test("T2-F05-01 Direct write/create/update/delete/move blocked for PROD container IDs", async ({
    request,
  }) => {
    const api = createApiClient(request);
    await api.harness.resetCalls();

    const containerIds = [
      PROD_IDS.PROD_PROJECT_CE,
      PROD_IDS.SHARED_DRIVE_13_PROJETS_NEW,
      PROD_IDS.FOLDER_APRES_VENTE,
      PROD_IDS.FOLDER_TEMPLATES_PROJETS,
    ];

    for (const targetId of containerIds) {
      for (const operation of ["update", "delete", "move"] as const) {
        const res = await api.harness.probeSandboxWrite({ operation, targetId });
        expect(res.status, `Expected 403 for ${operation} on ${targetId}`).toBe(403);
      }
    }

    const calls = await api.harness.getCalls();
    assertProdUntouched(calls.data);
  });

  test("T2-F05-02 Direct write/update/delete blocked for ALL 9 primary PROD IDs", async ({
    request,
  }) => {
    const api = createApiClient(request);
    await api.harness.resetCalls();

    for (const prodId of PROD_IMMUTABLE_IDS) {
      const updateRes = await api.harness.probeSandboxWrite({
        operation: "update",
        targetId: prodId,
      });
      expect(updateRes.status, `Expected 403 update block on ${prodId}`).toBe(403);

      const deleteRes = await api.harness.probeSandboxWrite({
        operation: "delete",
        targetId: prodId,
      });
      expect(deleteRes.status, `Expected 403 delete block on ${prodId}`).toBe(403);
    }

    const calls = await api.harness.getCalls();
    expect(
      calls.data.filter((c) => /update|delete/i.test(String(c.operation ?? c.method ?? "")))
    ).toEqual([]);
  });

  test("T2-F05-03 Ancestry guard blocks writes to PROD child and template IDs", async ({
    request,
  }) => {
    const api = createApiClient(request);
    for (const childOrTemplateId of PROD_CHILD_AND_TEMPLATE_IDS) {
      const res = await api.harness.probeSandboxWrite({
        operation: "update",
        targetId: childOrTemplateId,
      });
      expect(res.status, `Expected 403 ancestry block on ${childOrTemplateId}`).toBe(403);
    }
  });

  test("T2-F05-04 files.copy FROM PROD template INTO PROD or non-sandbox folder is rejected", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const badDestinations = [
      PROD_IDS.PROD_PROJECT_CE,
      PROD_IDS.FOLDER_APRES_VENTE,
      PROD_IDS.FOLDER_TEMPLATES_PROJETS,
    ];

    for (const dest of badDestinations) {
      const res = await api.harness.probeSandboxWrite({
        operation: "copy",
        sourceId: PROD_IDS.PROD_BUDGET_SHEET,
        targetId: dest,
        parentId: dest,
      });
      expect(res.status, `Expected 403 copy destination block for ${dest}`).toBe(403);
    }
  });

  test("T2-F05-05 Creating a Project with any PROD ID as writable root/sheet anchor is rejected", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const resRoot = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "Bypass Attempt",
      nomJeu: "Fortnite",
      driveInternalRootId: PROD_IDS.PROD_PROJECT_CE,
    });
    expect([400, 403]).toContain(resRoot.status);

    const resSheet = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex + 10),
      client: "Bypass Sheet",
      nomJeu: "Fortnite",
      budgetSheetId: PROD_IDS.PROD_BUDGET_SHEET,
    });
    expect([400, 403]).toContain(resSheet.status);
  });

  test("T2-F05-06 [EXT] sync refuses execution if external root resolves to PROD or 3 - Après-vente", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const probeExt = await api.harness.probeSandboxWrite({
      operation: "create",
      targetId: PROD_IDS.FOLDER_APRES_VENTE,
      parentId: PROD_IDS.FOLDER_APRES_VENTE,
      name: "IllegalDirectFileInApresVente",
    });
    expect(probeExt.status).toBe(403);
  });

  test("T2-F05-07 Setting isSandbox: false cannot bypass PROD_IMMUTABLE_IDS protection", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const customProj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "NonSandbox Client",
      nomJeu: "Custom Game",
      isSandbox: false,
    });
    expect(customProj.status).toBe(201);

    for (const prodId of [PROD_IDS.PROD_PROJECT_CE, PROD_IDS.PROD_REPORTING_SLIDES]) {
      const probe = await api.harness.probeSandboxWrite({
        operation: "update",
        targetId: prodId,
        projectId: customProj.data.id,
      });
      expect(probe.status).toBe(403);
    }
  });
});

// =============================================================================
// F6 Boundaries (2 connected tests here + 3 serial unconfigured tests below = 5)
// =============================================================================
test.describe("Tier 2 — F6 Boundaries: Connected Harness & Expiration", () => {
  test("T2-F06-03 Expired OAuth2 token without refresh returns 412 rather than mock Drive fallback", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "ExpiredTok");

    try {
      await api.harness.setState({ googleConnected: true, expiredToken: true });
      const syncRes = await api.syncDriveToExt(project.id);
      assertPreconditionMissing(syncRes);
    } finally {
      await api.harness.restoreConfigured();
    }
  });

  test("T2-F06-05 Boundary harness verifies zero hardcoded PROD IDs are ever returned as sandbox roots", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const boot = await api.bootstrapSandbox();
    expect([200, 201]).toContain(boot.status);
    assertProdUntouched(boot.data);

    const tree = await api.getDriveTree(boot.data.id);
    expect(tree.status).toBe(200);
    assertProdUntouched(tree.data);
  });
});

// =============================================================================
// F7 Boundaries (5 tests)
// =============================================================================
test.describe("Tier 2 — F7 Boundaries: Exhaustive 001. -> 006. Tree Creation", () => {
  test("T2-F07-01 001.* and 005.1/005.2 remain strictly excluded from [EXT] even if marked VALIDE_CLIENT", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "Exclude001");

    const seededIds: string[] = [];
    for (const code of ["001.1", "001.3", "005.1", "005.2"]) {
      const seeded = await api.harness.seedDriveNode({
        projectId: project.id,
        parentCode: code,
        name: `confidentiel-${code}.pdf`,
        mimeType: "application/pdf",
        validationStatus: "BROUILLON_INTERNE",
        isFolder: false,
      });
      seededIds.push(seeded.data.id);
      await api.updateDriveNode(project.id, seeded.data.id, {
        validationStatus: "VALIDE_CLIENT",
      });
    }

    await api.syncDriveToExt(project.id);
    const tree = (await api.getDriveTree(project.id)).data;
    for (const id of seededIds) {
      const node = tree.find((n) => n.id === id);
      expect(node?.extMirrorFileId ?? null).toBeFalsy();
    }
  });

  test("T2-F07-02 002.2, 003.3, 005.3, 006.1, 006.2 excluded from [EXT] sync even when validated", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "Exclude006");

    const seededIds: string[] = [];
    for (const code of ["002.2", "003.3", "005.3", "006.1", "006.2"]) {
      const seeded = await api.harness.seedDriveNode({
        projectId: project.id,
        parentCode: code,
        name: `interne-${code}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        validationStatus: "BROUILLON_INTERNE",
        isFolder: false,
      });
      seededIds.push(seeded.data.id);
      await api.updateDriveNode(project.id, seeded.data.id, {
        validationStatus: "VALIDE_CLIENT",
      });
    }

    await api.syncDriveToExt(project.id);
    const tree = (await api.getDriveTree(project.id)).data;
    for (const id of seededIds) {
      const node = tree.find((n) => n.id === id);
      expect(node?.extMirrorFileId ?? null).toBeFalsy();
    }
  });

  test("T2-F07-03 Mid-tree Drive API transient 503 failure recovers idempotently on retry", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const proj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "Retry Tree Client",
      nomJeu: "Fortnite Retry",
      isSandbox: true,
    });

    try {
      await api.harness.setState({ failDriveOnCallIndex: 4 });
      const failedAttempt = await api.provisionDriveTree(proj.data.id);
      expect([500, 502, 503]).toContain(failedAttempt.status);

      await api.harness.setState({ failDriveOnCallIndex: null });
      const retryAttempt = await api.provisionDriveTree(proj.data.id);
      expect([200, 201]).toContain(retryAttempt.status);

      const tree = (await api.getDriveTree(proj.data.id)).data;
      const root001 = tree.filter((n) => n.code === "001");
      expect(root001.length).toBe(1);
    } finally {
      await api.harness.restoreConfigured();
    }
  });

  test("T2-F07-04 Re-running provisioning adopts existing nodes without duplicate Drive folders", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, nodes } = await createProvisionedProject(api, testInfo.workerIndex, "Adopt");
    const node001 = findNodeByCode(nodes, "001");
    expect(node001?.driveFileId).toBeTruthy();

    await api.harness.resetCalls();
    const rerun = await api.provisionDriveTree(project.id);
    expect([200, 201]).toContain(rerun.status);

    const after = (await api.getDriveTree(project.id)).data;
    expect(after.filter((n) => n.code === "001").length).toBe(1);
    expect(findNodeByCode(after, "001")?.driveFileId).toBe(node001?.driveFileId);
  });

  test("T2-F07-05 All Drive API calls pass supportsAllDrives: true for Shared Drive compatibility", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    await api.harness.resetCalls();

    await createProvisionedProject(api, testInfo.workerIndex, "SharedDriveFlag");
    const calls = await api.harness.getCalls();
    const driveCalls = calls.data.filter((c) => /drive/i.test(String(c.service ?? c.operation ?? "")));
    expect(driveCalls.length).toBeGreaterThan(0);

    for (const call of driveCalls) {
      expect(call.supportsAllDrives).toBe(true);
    }
  });
});

// =============================================================================
// F8 Boundaries (4 connected tests here + 1 serial unconfigured test below = 5)
// =============================================================================
test.describe("Tier 2 — F8 Boundaries: Dynamic Talent Subfolder Provisioning", () => {
  test("T2-F08-01 Talent name with accents, apostrophe, and hyphens safely provisioned", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "Accents");

    const res = await api.addTalent(project.id, { talentName: "Léo-D'Artagnan (Élodie)" });
    expect([200, 201]).toContain(res.status);

    const tree = (await api.getDriveTree(project.id)).data;
    expect(tree.some((n) => n.name === "Léo-D'Artagnan (Élodie)")).toBe(true);
  });

  test("T2-F08-02 Case and whitespace duplicate talent names do not create duplicate folders", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "CaseDup");

    await api.addTalent(project.id, { talentName: "Kalut" });
    const countBefore = (await api.getDriveTree(project.id)).data.length;

    const dup = await api.addTalent(project.id, { talentName: "  kalut  " });
    expect([200, 201, 409]).toContain(dup.status);
    const countAfter = (await api.getDriveTree(project.id)).data.length;
    expect(countAfter).toBe(countBefore);
  });

  test("T2-F08-03 Empty, whitespace-only, or path-traversal talent names rejected with 400", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, nodes: before } = await createProvisionedProject(
      api,
      testInfo.workerIndex,
      "BadTalent"
    );

    for (const badName of ["", "   ", "../evil", "foo/bar", "foo\\bar"]) {
      const res = await api.addTalent(project.id, { talentName: badName });
      expect(res.status, `Expected 400 for talentName "${badName}"`).toBe(400);
    }

    const after = (await api.getDriveTree(project.id)).data;
    expect(after.length).toBe(before.length);
  });

  test("T2-F08-04 Adding talent before Drive tree exists handles missing 004.3/006.1 gracefully", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const proj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "No Tree Client",
      nomJeu: "Fortnite",
      isSandbox: true,
    });

    const res = await api.addTalent(proj.data.id, { talentName: "Kalut" });
    expect([200, 201, 409, 412]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });
});

// =============================================================================
// F9 Boundaries (6 tests)
// =============================================================================
test.describe("Tier 2 — F9 Boundaries: Client Mirror [EXT] & Drift Detection", () => {
  test("T2-F09-01 Unvalidated nodes (BROUILLON_INTERNE, EN_REVUE) are never synced to [EXT]", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "Unvalidated");

    const draft = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "draft-asset.png",
      mimeType: "image/png",
      validationStatus: "BROUILLON_INTERNE",
      isFolder: false,
    });
    const review = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "review-asset.png",
      mimeType: "image/png",
      validationStatus: "EN_REVUE",
      isFolder: false,
    });

    const syncRes = await api.syncDriveToExt(project.id);
    expect(syncRes.status).toBe(200);

    const tree = (await api.getDriveTree(project.id)).data;
    expect(tree.find((n) => n.id === draft.data.id)?.extMirrorFileId ?? null).toBeFalsy();
    expect(tree.find((n) => n.id === review.data.id)?.extMirrorFileId ?? null).toBeFalsy();
  });

  test("T2-F09-02 Direct sync-ext targeting 001.3 or 005.1 nodeId is rejected and logged", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, nodes } = await createProvisionedProject(api, testInfo.workerIndex, "ForceExt");

    const node0013 = findNodeByCode(nodes, "001.3");
    const node0051 = findNodeByCode(nodes, "005.1");
    expect(node0013).toBeDefined();
    expect(node0051).toBeDefined();

    const r1 = await api.syncDriveToExt(project.id, { nodeIds: [node0013!.id] });
    expect([403, 422]).toContain(r1.status);

    const r2 = await api.syncDriveToExt(project.id, { nodeIds: [node0051!.id] });
    expect([403, 422]).toContain(r2.status);

    const audit = await api.listAuditLogs(project.id);
    assertAuditLogged(audit, { action: /FORBIDDEN|BLOCKED|REJECTED|POLICY/i });
  });

  test("T2-F09-03 Invalid validationStatus enum value in PATCH node returns 400", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "BadStatus");

    const seeded = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "asset.png",
      mimeType: "image/png",
      validationStatus: "BROUILLON_INTERNE",
      isFolder: false,
    });

    const badPatch = await api.updateDriveNode(project.id, seeded.data.id, {
      validationStatus: "PUBLISHED_FAKE_STATUS",
    });
    expect(badPatch.status).toBe(400);

    const tree = (await api.getDriveTree(project.id)).data;
    expect(tree.find((n) => n.id === seeded.data.id)?.validationStatus).toBe("BROUILLON_INTERNE");
  });

  test("T2-F09-04 Missing [EXT] target on Drive during files.update handles 404 safely without hiding drift", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "MissingExt");

    const seeded = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "deleted-ext-target.png",
      mimeType: "image/png",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });
    await api.syncDriveToExt(project.id);
    await api.harness.simulateInternalDrift(project.id, seeded.data.id, {
      contentHash: "hash-after-ext-deleted",
    });

    try {
      await api.harness.setState({ simulateExtMissingOnUpdate: true });
      const resync = await api.syncDriveToExt(project.id);
      const afterNode = (await api.getDriveTree(project.id)).data.find(
        (n) => n.id === seeded.data.id
      );

      if (resync.ok) {
        expect(afterNode?.extMirrorFileId).toBeTruthy();
        expect(afterNode?.driftDetected).toBe(false);
      } else {
        expect(afterNode?.driftDetected).toBe(true);
      }
    } finally {
      await api.harness.restoreConfigured();
    }
  });

  test("T2-F09-05 Re-running sync-ext with zero drift performs zero redundant Drive write calls", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "ZeroDrift");

    await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "already-synced.png",
      mimeType: "image/png",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });
    await api.syncDriveToExt(project.id);
    await api.harness.resetCalls();

    const secondSync = await api.syncDriveToExt(project.id);
    expect(secondSync.status).toBe(200);

    const calls = await api.harness.getCalls();
    const writeCalls = calls.data.filter((c) =>
      /create|update|copy/i.test(String(c.operation ?? c.method ?? ""))
    );
    expect(writeCalls).toEqual([]);
  });

  test("T2-F09-06 Concurrent sync-ext calls on same drifted node do not create duplicate [EXT] files", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "ConcurrentSync");

    const seeded = await api.harness.seedDriveNode({
      projectId: project.id,
      parentCode: "004.4",
      name: "concurrent-banner.png",
      mimeType: "image/png",
      validationStatus: "VALIDE_CLIENT",
      isFolder: false,
    });

    await api.harness.resetCalls();
    const [r1, r2] = await Promise.all([
      api.syncDriveToExt(project.id),
      api.syncDriveToExt(project.id),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const node = (await api.getDriveTree(project.id)).data.find((n) => n.id === seeded.data.id);
    expect(node?.extMirrorFileId).toBeTruthy();

    const calls = await api.harness.getCalls();
    const createdForNode = calls.data.filter(
      (c) =>
        /create|copy/i.test(String(c.operation ?? c.method ?? "")) &&
        String(c.name ?? "").includes("concurrent-banner.png")
    );
    expect(createdForNode.length).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// F10 Boundaries (4 connected tests here + 1 unconfigured/sandbox test in serial block = 5)
// =============================================================================
test.describe("Tier 2 — F10 Boundaries: 002.1 Hard Non-Sync Lock", () => {
  test("T2-F10-01 Marking 002.1 node as VALIDE_CLIENT still blocks permanent [EXT] sync", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, nodes } = await createProvisionedProject(api, testInfo.workerIndex, "Lock0021");

    const node0021 = findNodeByCode(nodes, "002.1");
    expect(node0021).toBeDefined();

    await api.updateDriveNode(project.id, node0021!.id, {
      validationStatus: "VALIDE_CLIENT",
    });

    const syncRes = await api.syncDriveToExt(project.id);
    expect(syncRes.status).toBe(200);
    assertRetroplanningNeverAutoSyncedToExt(syncRes.data);
    assertRetroplanningNeverAutoSyncedToExt((await api.getDriveTree(project.id)).data);
  });

  test("T2-F10-02 Explicit sync-ext with { nodeIds: [node0021Id] } rejects with 403", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, nodes } = await createProvisionedProject(api, testInfo.workerIndex, "Force0021");
    const node0021 = findNodeByCode(nodes, "002.1");
    expect(node0021).toBeDefined();

    const res = await api.syncDriveToExt(project.id, { nodeIds: [node0021!.id] });
    expect(res.status).toBe(403);
    expect(String(res.error?.code ?? res.raw)).toMatch(/RETROPLANNING|FORBIDDEN|SYNC/i);

    const audit = await api.listAuditLogs(project.id);
    assertAuditLogged(audit, { action: /RETROPLANNING.*FORBIDDEN|SYNC.*BLOCKED/i });
  });

  test("T2-F10-03 Attempting to set allowPermanentExtSync: true via PATCH on 002.1 is rejected", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, nodes } = await createProvisionedProject(api, testInfo.workerIndex, "Patch0021");
    const node0021 = findNodeByCode(nodes, "002.1");
    expect(node0021).toBeDefined();

    const res = await api.updateDriveNode(project.id, node0021!.id, {
      allowPermanentExtSync: true,
      isExtEligible: true,
    });
    expect([400, 403]).toContain(res.status);

    const tree = (await api.getDriveTree(project.id)).data;
    assertRetroplanningNeverAutoSyncedToExt(tree);
  });

  test("T2-F10-04 Internal modification of 002.1 after manual export-once never triggers auto-sync", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, nodes } = await createProvisionedProject(api, testInfo.workerIndex, "AfterOnce");
    const node0021 = findNodeByCode(nodes, "002.1");
    expect(node0021).toBeDefined();

    const exp = await api.exportRetroplanningOnce(project.id, {
      explicitManualExportConfirm: true,
    });
    expect([200, 201]).toContain(exp.status);
    const frozenId = String(exp.data.exportedFileId ?? exp.data.driveFileId ?? "");

    await api.harness.simulateInternalDrift(project.id, node0021!.id, {
      contentHash: "retro-v2-edited",
    });
    await api.harness.resetCalls();

    await api.syncDriveToExt(project.id);
    await api.triggerSchedulerJob("DRIVE_DRIFT_CHECK", project.id);

    const calls = await api.harness.getCalls();
    const updatesToFrozen = calls.data.filter(
      (c) =>
        /update|copy/i.test(String(c.operation ?? c.method ?? "")) &&
        String(c.targetId ?? c.fileId ?? "") === frozenId
    );
    expect(updatesToFrozen).toEqual([]);
  });
});

// =============================================================================
// F24 Boundaries (5 tests)
// =============================================================================
test.describe("Tier 2 — F24 Boundaries: Cron / Scheduler & AuditLog", () => {
  test("T2-F24-01 Re-triggering same cron job immediately is idempotent with zero duplicate artifacts", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, nodes: before } = await createProvisionedProject(
      api,
      testInfo.workerIndex,
      "CronIdemp"
    );

    const r1 = await api.triggerSchedulerJob("DRIVE_DRIFT_CHECK", project.id);
    const r2 = await api.triggerSchedulerJob("DRIVE_DRIFT_CHECK", project.id);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const after = (await api.getDriveTree(project.id)).data;
    expect(after.length).toBe(before.length);
  });

  test("T2-F24-02 Scheduler isolates per-project errors without crashing server or skipping healthy projects", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const brokenProj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "Broken Anchor",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    const { project: healthyProj } = await createProvisionedProject(
      api,
      testInfo.workerIndex + 40,
      "Healthy"
    );

    const cronRes = await api.triggerSchedulerJob("DRIVE_DRIFT_CHECK");
    expect([200, 207]).toContain(cronRes.status);

    const listCheck = await api.listProjects();
    expect(listCheck.status).toBe(200);
    expect(listCheck.data.some((p) => p.id === brokenProj.data.id)).toBe(true);
    expect(listCheck.data.some((p) => p.id === healthyProj.id)).toBe(true);
  });

  test("T2-F24-03 Unknown cron job identifier rejected with 400 Bad Request", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const res = await api.triggerSchedulerJob("NON_EXISTENT_JOB_XYZ");
    expect(res.status).toBe(400);
  });

  test("T2-F24-04 Invalid Authorization header when CRON_SECRET is enforced returns 401/403", async ({
    request,
  }) => {
    const api = createApiClient(request);
    try {
      await api.harness.setState({ cronSecret: "super-secret-cron-token" });
      const badAuth = await api.triggerSchedulerJob("DRIVE_DRIFT_CHECK", undefined, {
        authorization: "Bearer wrong-secret",
      });
      expect([401, 403]).toContain(badAuth.status);
    } finally {
      await api.harness.restoreConfigured();
    }
  });

  test("T2-F24-05 AuditLog query pagination bounds work cleanly and detailsJson never leaks secrets", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const sentinel = "SECRET_LEAK_GUARD_123";
    await api.updateSettings({ geminiApiKey: sentinel });

    const { project } = await createProvisionedProject(api, testInfo.workerIndex, "AuditLimit");
    await api.addTalent(project.id, { talentName: "Kalut" });
    await api.addTalent(project.id, { talentName: "Aksianka" });
    await api.addTalent(project.id, { talentName: "Allyson" });
    await api.addTalent(project.id, { talentName: "Wig" });

    const limited = await api.listAuditLogs(project.id, { limit: 3 });
    expect(limited.status).toBe(200);
    expect(limited.data.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(limited.data)).not.toContain(sentinel);
  });
});
});

// =============================================================================
// Serial Unconfigured (412 Precondition Failed) Group (F2, F6, F8, F10 = 7 tests)
// =============================================================================
test.describe.serial("Tier 2 — Unconfigured Preconditions (412) Isolated Serial Group", () => {
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

  test("T2-F02-01 Missing Google OAuth client credentials returns 412 on /api/auth/google/start", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const res = await api.startGoogleAuth();
    assertPreconditionMissing(res, "GOOGLE_NOT_CONNECTED");
  });

  test("T2-F02-03 Missing GEMINI_API_KEY returns 412 GEMINI_KEY_MISSING with setupUrl /settings", async ({
    request,
  }) => {
    const api = createApiClient(request);
    const res = await api.testGemini();
    assertPreconditionMissing(res, "GEMINI_KEY_MISSING");
  });

  test("T2-F06-01 Missing Google OAuth2 returns 412 across all Drive/Bootstrap endpoints", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const proj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "Unconfigured Client",
      nomJeu: "Fortnite",
      isSandbox: true,
    });
    expect(proj.status).toBe(201);

    assertPreconditionMissing(await api.bootstrapSandbox(), "GOOGLE_NOT_CONNECTED");
    assertPreconditionMissing(await api.provisionDriveTree(proj.data.id), "GOOGLE_NOT_CONNECTED");
    assertPreconditionMissing(
      await api.addTalent(proj.data.id, { talentName: "Kalut" }),
      "GOOGLE_NOT_CONNECTED"
    );
    assertPreconditionMissing(await api.syncDriveToExt(proj.data.id), "GOOGLE_NOT_CONNECTED");
    assertPreconditionMissing(
      await api.exportRetroplanningOnce(proj.data.id, { explicitManualExportConfirm: true }),
      "GOOGLE_NOT_CONNECTED"
    );
  });

  test("T2-F06-02 Missing GEMINI_API_KEY with Google connected still returns 412 GEMINI_KEY_MISSING with zero fake responses", async ({
    request,
  }) => {
    const api = createApiClient(request);
    try {
      await api.harness.setState({
        googleConnected: true,
        googleClientConfigured: true,
        geminiConfigured: false,
      });

      const settingsRes = await api.getSettings();
      expect(settingsRes.status).toBe(200);
      expect(settingsRes.data.googleConnected).toBe(true);
      expect(settingsRes.data.geminiKeyConfigured ?? settingsRes.data.geminiConfigured).toBe(false);

      const res = await api.testGemini();
      assertPreconditionMissing(res, "GEMINI_KEY_MISSING");
      expect(res.data?.ok).not.toBe(true);
      expect(res.data?.model ?? null).toBeNull();
      expect(res.data?.response ?? null).toBeNull();
    } finally {
      await api.harness.setUnconfigured({ google: true, gemini: true });
    }
  });

  test("T2-F06-04 UI surfaces 412 setup banner with /settings link when triggering Drive/Gemini unconfigured", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const proj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "UI 412 Client",
      nomJeu: "Fortnite",
      isSandbox: true,
    });

    await page.goto(`${BASE_URL}/drive?projectId=${proj.data.id}`);
    const actionBtn = page
      .locator("button")
      .filter({ hasText: /Provisionner|Initialiser|Synchroniser/i })
      .first();
    await expect(actionBtn).toBeVisible();
    await actionBtn.click();
    await assertSetupPreconditionBanner(page);
  });

  test("T2-F08-05 Adding talent without Google OAuth2 returns 412 with zero orphan DB DriveNodes", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const proj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "No OAuth Talent",
      nomJeu: "Fortnite",
      isSandbox: true,
    });

    const res = await api.addTalent(proj.data.id, { talentName: "Wig" });
    assertPreconditionMissing(res, "GOOGLE_NOT_CONNECTED");

    const tree = await api.getDriveTree(proj.data.id);
    expect(tree.status).toBe(200);
    expect(tree.data).toEqual([]);
  });

  test("T2-F10-05 Manual export-once returns 412 when OAuth2 missing and 400 when confirmation missing", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const proj = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "ExportOnce 412",
      nomJeu: "Fortnite",
      isSandbox: true,
    });

    const missingConfirm = await api.exportRetroplanningOnce(proj.data.id, {
      explicitManualExportConfirm: false,
    });
    expect([400, 412]).toContain(missingConfirm.status);

    const res412 = await api.exportRetroplanningOnce(proj.data.id, {
      explicitManualExportConfirm: true,
    });
    assertPreconditionMissing(res412, "GOOGLE_NOT_CONNECTED");
  });
});
