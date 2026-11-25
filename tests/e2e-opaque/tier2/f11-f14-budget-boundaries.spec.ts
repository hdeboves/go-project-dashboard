/**
 * Tier 2 — Boundary, Corner Case & Negative Opaque-Box E2E Tests (F11–F14: Budget & Invoices)
 * Target count: 24 tests (6 per feature across F11, F12, F13, F14; exceeds >=20 / >=5 minimum).
 * Covers malformed .xlsx, stale header mismatch, 0€ division-by-zero, 85%/100% BVA, floating-point rounding,
 * CP conflict guardrails (filename + text-only), corrupt/spoofed PDFs, duplicate invoice numbers,
 * partial-failure retry idempotency, PROD sandbox blocks, and 412 unconfigured preconditions.
 * Zero src/ or prisma/ imports.
 */

import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import {
  createApiClient,
  type ApiClient,
  type BudgetLinePayload,
  type ProjectDto,
} from "../helpers/api-client";
import {
  assertAuditLogged,
  assertBudgetThresholdAlert,
  assertCpConflictBlocked,
  assertPreconditionMissing,
  assertProdUntouched,
  assertRedAlertBanner,
  assertSetupPreconditionBanner,
} from "../helpers/assertions";
import {
  BASE_URL,
  INVOICE_FILENAME_REGEX,
  PROD_IDS,
  expectedInvoiceFilename,
  uniqueTestCp,
} from "../helpers/constants";
import {
  buildMalformedBudgetXlsx,
  buildPilot326027BudgetXlsx,
  buildXlsxWorkbook,
  buildZeroPreOpBudgetXlsx,
  type XlsxCellValue,
} from "../fixtures/budget-xlsx";
import {
  CONFLICT_INVOICE_CRISTALINE_326018,
  CONFLICT_INVOICE_TEXT_ONLY_326018,
  CORRUPT_PDF_BUFFER,
  EMPTY_TEXT_PDF_BUFFER,
  createInvoicePdfFixture,
} from "../fixtures/invoices";
import { buildMinimalPngBuffer } from "../fixtures/reporting-data";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeGatewayCall(call: Record<string, unknown>): Record<string, unknown> {
  return {
    ...asRecord(call.args),
    ...asRecord(call.payload),
    ...call,
  };
}

function assertValidId(id: unknown, label: string): string {
  expect(
    typeof id === "string" && id.length > 0,
    `Expected non-empty string ID for ${label}, got ${String(id)}`
  ).toBe(true);
  return id as string;
}

function pickNumber(obj: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val)) {
      return val;
    }
  }
  return undefined;
}

function extractBudgetEnvelope(raw: unknown): {
  lines: Record<string, unknown>[];
  summary: Record<string, unknown>;
  alerts: Record<string, unknown>[];
  warnings: string[];
  budgetSheetId: string | null;
} {
  const root = asRecord(raw);
  const data = isRecord(root.data) ? root.data : root;
  const lines = asRecordArray(data.lines ?? root.lines ?? data.budgetLines ?? root.budgetLines);
  const summary = asRecord(data.summary ?? root.summary);
  const alerts = asRecordArray(data.alerts ?? root.alerts);
  const rawWarnings = data.warnings ?? root.warnings ?? data.headerMismatchWarning ?? root.headerMismatchWarning;
  const warnings: string[] = Array.isArray(rawWarnings)
    ? rawWarnings.map((w) => (typeof w === "string" ? w : JSON.stringify(w)))
    : typeof rawWarnings === "string" && rawWarnings.length > 0
      ? [rawWarnings]
      : isRecord(rawWarnings)
        ? [JSON.stringify(rawWarnings)]
        : [];
  const budgetSheetId =
    typeof data.budgetSheetId === "string"
      ? data.budgetSheetId
      : typeof root.budgetSheetId === "string"
        ? root.budgetSheetId
        : null;

  return { lines, summary, alerts, warnings, budgetSheetId };
}

function findBudgetLineByObjet(
  lines: Record<string, unknown>[],
  objetMatch: string | RegExp
): Record<string, unknown> | undefined {
  return lines.find((line) => {
    const objet = String(line.objet ?? "");
    return typeof objetMatch === "string"
      ? objet.toLowerCase().includes(objetMatch.toLowerCase())
      : objetMatch.test(objet);
  });
}

function assertNoNonFiniteSerializedValues(payload: unknown): void {
  const json = JSON.stringify(payload);
  expect(json).not.toMatch(/\bNaN\b|\bInfinity\b|-Infinity/);
}

function buildStaleHeaderMismatchBudgetXlsx(): Buffer {
  const makeRow = (): XlsxCellValue[] => Array.from({ length: 20 }, () => null);
  const row8 = makeRow();
  row8[0] = "Prix de vente";
  row8[9] = "Couts réels pré-opération";
  row8[15] = "Couts réels post-opération";

  const row11 = makeRow();
  row11[2] = "Objet";
  row11[3] = "Réalisé par";
  row11[4] = "Quantité";
  row11[5] = "Jours";
  row11[6] = "Coût/ unité (€)";
  row11[7] = "Prix (€)";
  row11[9] = "Type de dépenses";
  row11[10] = "Coût réel/u (€)";
  row11[11] = "Coût réel (€)";
  row11[15] = "Qté";
  row11[16] = "Jours";
  row11[17] = "Coût réel/u (€)";
  row11[18] = "Coût réel (€)";

  const lineRow = makeRow();
  lineRow[2] = "Mapping & HUD Fortnite";
  lineRow[3] = "Vertigo Studio";
  lineRow[4] = 1;
  lineRow[5] = 10;
  lineRow[6] = 1000;
  lineRow[7] = 10000;
  lineRow[9] = "Externe";
  lineRow[10] = 600;
  lineRow[11] = 6000;
  lineRow[15] = 0;
  lineRow[16] = 0;
  lineRow[17] = 0;
  lineRow[18] = 0;

  return buildXlsxWorkbook([
    {
      name: "Vue d'ensemble",
      rows: [
        ["Cristaline x Fortnite", null, null, null],
        ["Année :", 2026, "Code projet :", null],
        ["Chef de projet :", "Hugo Debôves", null, null],
      ],
    },
    {
      name: "Postes de dépenses",
      rows: [
        ["Budget : CE - Fortnite", null, "Code projet :", null],
        [],
        [],
        [],
        [],
        [],
        [],
        row8,
        [],
        [],
        row11,
        [null, null, "CRÉATION DE LA CARTE DANS FORTNITE"],
        lineRow,
      ],
    },
  ]);
}

async function createIsolatedProject(
  api: ApiClient,
  workerIndex: number,
  opts?: {
    suffix?: string;
    provisionDrive?: boolean;
    importPilotBudget?: boolean;
    client?: string;
    nomJeu?: string;
  }
): Promise<{
  project: ProjectDto;
  cp: string;
  budgetLines: Record<string, unknown>[];
}> {
  const cp = uniqueTestCp(workerIndex);
  const suffix = opts?.suffix ?? "T2";
  const created = await api.createProject({
    codeProjet: cp,
    client: opts?.client ?? `Client ${suffix} ${cp}`,
    nomJeu: opts?.nomJeu ?? `Fortnite ${suffix}`,
    isSandbox: true,
  });
  expect(created.status, `Failed creating project ${cp}: ${JSON.stringify(created.raw)}`).toBe(201);
  const project = created.data;

  if (opts?.provisionDrive !== false) {
    const prov = await api.provisionDriveTree(project.id);
    expect([200, 201]).toContain(prov.status);
  }

  let budgetLines: Record<string, unknown>[] = [];
  if (opts?.importPilotBudget) {
    const xlsx = buildPilot326027BudgetXlsx(cp);
    const imp = await api.importBudgetXlsx(project.id, {
      file: {
        name: xlsx.filename,
        mimeType: xlsx.mimeType,
        buffer: xlsx.buffer,
      },
    });
    expect([200, 201]).toContain(imp.status);
    budgetLines = extractBudgetEnvelope((await api.getBudget(project.id)).raw).lines;
  }

  return { project, cp, budgetLines };
}

test.describe("Tier 2 — Connected Boundary & Negative Tests (F11–F14)", () => {
  test.beforeEach(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.restoreConfigured();
  });

  // ===========================================================================
  // F11 — Budget Sheet Initialization Boundaries (5 connected + 1 serial 412)
  // ===========================================================================
  test.describe("Tier 2 — F11: Budget Initialization Boundaries & Negative Cases", () => {
    test("T2-F11-01 Malformed/corrupted .xlsx bytes rejected cleanly with 400/422 and zero partial DB writes", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "MalformedXlsx",
      });

      await api.harness.resetCalls();
      const res = await api.importBudgetXlsx(project.id, {
        file: {
          name: `corrupted_${cp}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: buildMalformedBudgetXlsx(),
        },
      });
      expect(res.ok).toBe(false);
      expect([400, 422]).toContain(res.status);

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      expect(budgetAfter.lines).toEqual([]);
      expect(budgetAfter.budgetSheetId).toBeNull();

      const callsRes = await api.harness.getCalls();
      const driveCreates = callsRes.data.filter((c) =>
        /drive.*create|createFile/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(driveCreates).toEqual([]);
    });

    test("T2-F11-02 Valid .xlsx ZIP missing Postes de dépenses tab or 3-block headers rejected with 400/422", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "MissingTabsXlsx",
      });

      const invalidStructureXlsx = buildXlsxWorkbook([
        {
          name: "Sheet1",
          rows: [
            ["Foo", "Bar", "Baz"],
            [1, 2, 3],
          ],
        },
      ]);

      const res = await api.importBudgetXlsx(project.id, {
        file: {
          name: `invalid_tabs_${cp}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: invalidStructureXlsx,
        },
      });
      expect(res.ok).toBe(false);
      expect([400, 422]).toContain(res.status);

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      expect(budgetAfter.lines).toEqual([]);
    });

    test("T2-F11-03 Stale Sheet header mismatch (Cristaline x Fortnite + blank CP) warns without cross-contamination", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "StaleHeader",
        client: "Caisse d'Épargne",
        nomJeu: `Fortnite Stale ${uniqueTestCp(testInfo.workerIndex + 5)}`,
      });

      const staleXlsx = buildStaleHeaderMismatchBudgetXlsx();
      const res = await api.importBudgetXlsx(project.id, {
        file: {
          name: `Budget_CE_Stale_${cp}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: staleXlsx,
        },
      });
      expect([200, 201]).toContain(res.status);

      const { warnings, lines } = extractBudgetEnvelope(res.raw);
      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      const combinedWarnings = [...warnings, ...budgetAfter.warnings].join(" ");
      expect(combinedWarnings).toMatch(/Cristaline|en-t[êe]te|header|mismatch|Code projet/i);
      expect(lines.length || budgetAfter.lines.length).toBeGreaterThanOrEqual(1);

      const projectsRes = await api.listProjects();
      const reloaded = projectsRes.data.find((p) => p.id === project.id);
      expect(reloaded?.codeProjet).toBe(cp);
      expect(reloaded?.client).toBe("Caisse d'Épargne");

      assertProdUntouched((await api.harness.getCalls()).data);
    });

    test("T2-F11-04 PROD Budget Sheet write/update & copy-into-PROD attempts blocked with 403 SANDBOX_VIOLATION", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "ProdBlock",
      });

      await api.harness.resetCalls();
      const updateProd = await api.harness.probeSandboxWrite({
        operation: "update",
        targetId: PROD_IDS.PROD_BUDGET_SHEET,
        projectId: project.id,
        name: "Illegal PROD Budget Edit",
      });
      expect(updateProd.status).toBe(403);
      expect(updateProd.error?.code).toBe("SANDBOX_VIOLATION");

      const copyIntoProd = await api.harness.probeSandboxWrite({
        operation: "copy",
        targetId: PROD_IDS.PROD_PROJECT_CE,
        sourceId: PROD_IDS.PROD_BUDGET_SHEET,
        parentId: PROD_IDS.PROD_PROJECT_CE,
        projectId: project.id,
      });
      expect(copyIntoProd.status).toBe(403);
      expect(copyIntoProd.error?.code).toBe("SANDBOX_VIOLATION");

      const callsRes = await api.harness.getCalls();
      assertProdUntouched(callsRes.data);

      const auditRes = await api.listAuditLogs(project.id);
      assertAuditLogged(auditRes, {
        action: /SANDBOX_VIOLATION|BLOCKED/i,
      });
    });

    test("T2-F11-06 Invalid BudgetLine payload (empty category/objet or negative unit price) rejected with 400", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "InvalidLine",
      });

      const emptyFields = await api.upsertBudgetLine(project.id, {
        category: "",
        objet: "",
        saleTotalHt: 1000,
      });
      expect(emptyFields.ok).toBe(false);
      expect([400, 422]).toContain(emptyFields.status);

      const negativeAmount = await api.upsertBudgetLine(project.id, {
        category: "CHARTE",
        objet: "Negative Line",
        saleUnitPrice: -100,
        saleTotalHt: -100,
        preOpUnitCost: -50,
        preOpTotalHt: -50,
      });
      expect(negativeAmount.ok).toBe(false);
      expect([400, 422]).toContain(negativeAmount.status);

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      expect(budgetAfter.lines).toEqual([]);
    });
  });

  // ===========================================================================
  // F12 — Budget KPIs, Thresholds & Isolation Boundaries (6 tests)
  // ===========================================================================
  test.describe("Tier 2 — F12: Budget KPI, Division-by-Zero & Threshold BVA", () => {
    test("T2-F12-01 0 EUR Pre-Op (0/0 and unbudgeted 2672/0) guards division-by-zero with zero NaN/Infinity", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "ZeroPreOp",
      });

      const zeroPreOpBuf = buildZeroPreOpBudgetXlsx(cp);
      const imp = await api.importBudgetXlsx(project.id, {
        file: {
          name: `Budget_ZeroPreOp_${cp}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: zeroPreOpBuf,
        },
      });
      expect([200, 201]).toContain(imp.status);

      const zeroZeroLine = await api.upsertBudgetLine(project.id, {
        category: "FRAIS DIVERS",
        objet: "Matériel",
        realisePar: "Interne GO",
        expenseType: "Amortissement",
        saleTotalHt: 0,
        preOpTotalHt: 0,
        postOpTotalHt: 0,
      });
      expect([200, 201]).toContain(zeroZeroLine.status);

      const budgetRes = await api.getBudget(project.id);
      expect(budgetRes.status).toBe(200);
      assertNoNonFiniteSerializedValues(budgetRes.raw);

      const { summary, alerts } = extractBudgetEnvelope(budgetRes.raw);
      expect(pickNumber(summary, ["soldTotalHt", "soldHt"])).toBe(3500);
      expect(pickNumber(summary, ["preOpTotalHt", "preOpHt"])).toBe(0);
      expect(pickNumber(summary, ["postOpTotalHt", "postOpHt"])).toBe(2672);

      const remainingVal = pickNumber(summary, [
        "remainingToCommitHt",
        "resteAEngager",
        "remainingToCommit",
      ]);
      expect(typeof remainingVal === "number" && Number.isFinite(remainingVal)).toBe(true);

      const plannedMarginPctVal = pickNumber(summary, ["plannedMarginPct"]);
      expect(typeof plannedMarginPctVal === "number" && Number.isFinite(plannedMarginPctVal)).toBe(
        true
      );

      const realMarginPctVal = pickNumber(summary, ["realMarginPct"]);
      expect(typeof realMarginPctVal === "number" && Number.isFinite(realMarginPctVal)).toBe(true);

      const printAlert = alerts.find((a) => String(a.objet ?? "").includes("Visuels Print"));
      expect(printAlert).toBeDefined();
      if (printAlert) {
        for (const key of ["ratioPct", "consumptionPct", "ratio"] as const) {
          if (key in printAlert && printAlert[key] !== undefined && printAlert[key] !== null) {
            expect(
              typeof printAlert[key] === "number" && Number.isFinite(printAlert[key] as number),
              `Expected finite numeric ${key} in ${JSON.stringify(printAlert)}`
            ).toBe(true);
          }
        }
      }

      const materielAlerts = alerts.filter((a) => String(a.objet ?? "").includes("Matériel"));
      expect(materielAlerts).toEqual([]);

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      await expect(page.locator("body")).toContainText("Visuels Print");
      const bodyText = await page.locator("body").innerText();
      expect(bodyText).not.toMatch(/\bNaN\b|Infinity/i);
    });

    test("T2-F12-02 0 EUR Sold HT guards plannedMarginPct and realMarginPct division-by-zero cleanly", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "ZeroSold",
      });

      const res = await api.upsertBudgetLine(project.id, {
        category: "INTERNAL",
        objet: "R&D Interne Sans Vente",
        expenseType: "RH Internes",
        saleTotalHt: 0,
        preOpTotalHt: 500,
        postOpTotalHt: 200,
      });
      expect([200, 201]).toContain(res.status);

      const budgetRes = await api.getBudget(project.id);
      expect(budgetRes.status).toBe(200);
      assertNoNonFiniteSerializedValues(budgetRes.raw);

      const { summary } = extractBudgetEnvelope(budgetRes.raw);
      expect(pickNumber(summary, ["soldTotalHt", "soldHt"])).toBe(0);
      expect(pickNumber(summary, ["plannedMarginHt"])).toBe(-500);
      expect(pickNumber(summary, ["realMarginHt"])).toBe(-200);
      expect(pickNumber(summary, ["plannedMarginPct"])).toBe(0);
      expect(pickNumber(summary, ["realMarginPct"])).toBe(0);
    });

    test("T2-F12-03 BVA around 85% threshold: 84.99% emits NO alert vs 85.00% emits WARNING", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "Bva85",
      });

      const basePayload: BudgetLinePayload = {
        category: "MAPPING",
        objet: "BVA 85 Line",
        expenseType: "Externe",
        saleTotalHt: 15000,
        preOpTotalHt: 10000,
        postOpTotalHt: 8499,
      };
      const below = await api.upsertBudgetLine(project.id, basePayload);
      expect([200, 201]).toContain(below.status);
      const belowId = assertValidId(below.data.id, "below.data.id");

      const budgetBelow = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      expect(
        budgetBelow.alerts.filter((a) => String(a.objet ?? "").includes("BVA 85 Line"))
      ).toEqual([]);

      const at85 = await api.upsertBudgetLine(project.id, {
        ...basePayload,
        id: belowId,
        postOpTotalHt: 8500,
      });
      expect([200, 201]).toContain(at85.status);

      const budgetAt85 = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      const warnAlert = budgetAt85.alerts.find(
        (a) =>
          String(a.objet ?? "").includes("BVA 85 Line") &&
          String(a.level ?? "").toUpperCase().includes("WARN")
      );
      expect(warnAlert, `Expected 85.00% WARNING alert in ${JSON.stringify(budgetAt85.alerts)}`).toBeDefined();
    });

    test("T2-F12-04 BVA around 100% threshold: 99.99% WARNING vs 100.00% & 100.01% CRITICAL + clamped Reste à engager", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "Bva100",
      });

      const created = await api.upsertBudgetLine(project.id, {
        category: "MAPPING",
        objet: "BVA 100 Line",
        expenseType: "Externe",
        saleTotalHt: 15000,
        preOpTotalHt: 10000,
        postOpTotalHt: 9999,
      });
      expect([200, 201]).toContain(created.status);
      const lineId = assertValidId(created.data.id, "created.data.id");

      const at9999 = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      const alert9999 = at9999.alerts.find((a) => String(a.objet ?? "").includes("BVA 100 Line"));
      expect(alert9999).toBeDefined();
      expect(String(alert9999?.level ?? "")).toMatch(/WARN/i);
      expect(String(alert9999?.level ?? "")).not.toMatch(/CRIT/i);

      const up100 = await api.upsertBudgetLine(project.id, {
        id: lineId,
        category: "MAPPING",
        objet: "BVA 100 Line",
        expenseType: "Externe",
        saleTotalHt: 15000,
        preOpTotalHt: 10000,
        postOpTotalHt: 10000,
      });
      expect([200, 201]).toContain(up100.status);
      const at100 = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      const alert100 = at100.alerts.find((a) => String(a.objet ?? "").includes("BVA 100 Line"));
      expect(String(alert100?.level ?? "")).toMatch(/CRIT/i);

      const upOver = await api.upsertBudgetLine(project.id, {
        id: lineId,
        category: "MAPPING",
        objet: "BVA 100 Line",
        expenseType: "Externe",
        saleTotalHt: 15000,
        preOpTotalHt: 10000,
        postOpTotalHt: 10001,
      });
      expect([200, 201]).toContain(upOver.status);
      const atOver = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      const alertOver = atOver.alerts.find((a) => String(a.objet ?? "").includes("BVA 100 Line"));
      expect(String(alertOver?.level ?? "")).toMatch(/CRIT/i);
      expect(
        pickNumber(atOver.summary, ["remainingToCommitHt", "resteAEngager", "remainingToCommit"])
      ).toBe(0);

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      await assertBudgetThresholdAlert(page, "100%");
    });

    test("T2-F12-05 Multi-project budget isolation: same client Caisse d'Épargne KPIs never bleed across projects", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const projA = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "IsoA",
        client: "Caisse d'Épargne",
        nomJeu: `Fortnite IsoA ${uniqueTestCp(testInfo.workerIndex + 10)}`,
        importPilotBudget: true,
      });
      const projB = await createIsolatedProject(api, testInfo.workerIndex + 1, {
        suffix: "IsoB",
        client: "Caisse d'Épargne",
        nomJeu: `Event IsoB ${uniqueTestCp(testInfo.workerIndex + 20)}`,
      });

      const lineB = await api.upsertBudgetLine(projB.project.id, {
        category: "ÉVÉNEMENTIEL",
        objet: "Scène Event Collaborateurs",
        expenseType: "Externe",
        saleTotalHt: 45000,
        preOpTotalHt: 30000,
        postOpTotalHt: 15000,
      });
      expect([200, 201]).toContain(lineB.status);

      const budgetA = extractBudgetEnvelope((await api.getBudget(projA.project.id)).raw);
      const budgetB = extractBudgetEnvelope((await api.getBudget(projB.project.id)).raw);

      expect(pickNumber(budgetA.summary, ["soldTotalHt", "soldHt"])).toBe(12000);
      expect(pickNumber(budgetB.summary, ["soldTotalHt", "soldHt"])).toBe(45000);
      expect(findBudgetLineByObjet(budgetA.lines, "Scène Event Collaborateurs")).toBeUndefined();
      expect(findBudgetLineByObjet(budgetB.lines, "Mapping & HUD Fortnite")).toBeUndefined();
    });

    test("T2-F12-06 Floating-point precision rounding on fractional Euro amounts (0.10 + 0.20 and 33.33 + 66.67)", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "FloatRounding",
      });

      const fracA = await api.upsertBudgetLine(project.id, {
        category: "TEST",
        objet: "Fraction A",
        saleTotalHt: 33.33,
        preOpTotalHt: 10.1,
        postOpTotalHt: 0.1,
      });
      expect([200, 201]).toContain(fracA.status);
      const fracB = await api.upsertBudgetLine(project.id, {
        category: "TEST",
        objet: "Fraction B",
        saleTotalHt: 66.67,
        preOpTotalHt: 20.2,
        postOpTotalHt: 0.2,
      });
      expect([200, 201]).toContain(fracB.status);

      const budgetRes = await api.getBudget(project.id);
      expect(budgetRes.status).toBe(200);
      const { summary } = extractBudgetEnvelope(budgetRes.raw);
      expect(pickNumber(summary, ["soldTotalHt", "soldHt"])).toBe(100);
      expect(pickNumber(summary, ["preOpTotalHt", "preOpHt"])).toBe(30.3);
      expect(pickNumber(summary, ["postOpTotalHt", "postOpHt"])).toBe(0.3);
      expect(pickNumber(summary, ["plannedMarginHt"])).toBe(69.7);
      expect(pickNumber(summary, ["realMarginHt"])).toBe(99.7);
    });
  });

  // ===========================================================================
  // F13 — Invoice Ingestion & Gemini Boundaries (5 connected + 1 serial 412)
  // ===========================================================================
  test.describe("Tier 2 — F13: Invoice Ingestion, CP Conflict & Negative Inputs", () => {
    test("T2-F13-01 CP conflict in filename & text (Facture QF08_326018.pdf in active project) blocks + shows red banner", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "CpConflictFile",
        importPilotBudget: true,
      });

      await api.harness.resetCalls();
      const conflictRes = await api.uploadInvoicePdf(project.id, {
        name: CONFLICT_INVOICE_CRISTALINE_326018.filename,
        mimeType: CONFLICT_INVOICE_CRISTALINE_326018.mimeType,
        buffer: CONFLICT_INVOICE_CRISTALINE_326018.buffer,
      });
      assertCpConflictBlocked(conflictRes, "326018", cp);

      const callsRes = await api.harness.getCalls();
      const mutatingWorkspaceCalls = callsRes.data.filter((c) =>
        /drive.*create|sheets.*update|createDraft|drafts\.create/i.test(
          String(c.operation ?? c.method ?? "")
        )
      );
      expect(mutatingWorkspaceCalls).toEqual([]);
      assertProdUntouched(callsRes.data);

      const auditRes = await api.listAuditLogs(project.id);
      assertAuditLogged(auditRes, {
        projectId: project.id,
        action: /CP_CONFLICT|CONFLICT/i,
        detailsContain: "326018",
      });

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      await assertRedAlertBanner(page);
      await expect(
        page
          .locator(
            '[data-testid="cp-conflict-banner"], main [role="alert"], main .bg-red-50, main .border-red-500'
          )
          .filter({ hasText: /326018/ })
          .first()
      ).toBeVisible();
    });

    test("T2-F13-02 CP conflict in PDF text ONLY (scan_recu_01.pdf with CP 326018 inside) caught by deterministic guard", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "CpConflictText",
        importPilotBudget: true,
      });

      await api.harness.resetCalls();
      const res = await api.uploadInvoicePdf(project.id, {
        name: CONFLICT_INVOICE_TEXT_ONLY_326018.filename,
        mimeType: CONFLICT_INVOICE_TEXT_ONLY_326018.mimeType,
        buffer: CONFLICT_INVOICE_TEXT_ONLY_326018.buffer,
      });
      assertCpConflictBlocked(res, "326018", cp);

      const callsRes = await api.harness.getCalls();
      const mutatingCalls = callsRes.data.filter((c) =>
        /drive.*create|sheets.*update|createDraft/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(mutatingCalls).toEqual([]);
      assertProdUntouched(callsRes.data);
    });

    test("T2-F13-03 Corrupt PDF bytes and empty-text PDF handled gracefully without committing phantom budget amounts", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "CorruptPdf",
        importPilotBudget: true,
      });

      const corruptRes = await api.uploadInvoicePdf(project.id, {
        name: `corrupt_${cp}.pdf`,
        mimeType: "application/pdf",
        buffer: CORRUPT_PDF_BUFFER,
      });
      expect(corruptRes.ok).toBe(false);
      expect([400, 422]).toContain(corruptRes.status);

      const emptyRes = await api.uploadInvoicePdf(project.id, {
        name: `empty_${cp}.pdf`,
        mimeType: "application/pdf",
        buffer: EMPTY_TEXT_PDF_BUFFER,
      });
      if (!emptyRes.ok) {
        expect([400, 422]).toContain(emptyRes.status);
      } else {
        expect(emptyRes.data.status).not.toBe("VALIDATED");
        expect(Number(emptyRes.data.amountHt ?? 0)).toBe(0);
      }

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      expect(pickNumber(budgetAfter.summary, ["postOpTotalHt", "postOpHt"])).toBe(0);
    });

    test("T2-F13-04 Non-PDF MIME / PNG buffer spoofed as .pdf rejected cleanly with zero Invoice persisted", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "SpoofMime",
      });

      const txtRes = await api.uploadInvoicePdf(project.id, {
        name: `notes_${cp}.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from("Plain text payload not a PDF", "utf8"),
      });
      expect(txtRes.ok).toBe(false);
      expect([400, 415, 422]).toContain(txtRes.status);

      const pngSpoof = await api.uploadInvoicePdf(project.id, {
        name: `spoof_${cp}.pdf`,
        mimeType: "application/pdf",
        buffer: buildMinimalPngBuffer(),
      });
      expect(pngSpoof.ok).toBe(false);
      expect([400, 415, 422]).toContain(pngSpoof.status);

      const listRes = await api.listInvoices(project.id);
      expect(listRes.status).toBe(200);
      expect(listRes.data).toEqual([]);
    });

    test("T2-F13-05 Duplicate N° Facture uploaded twice to same project is flagged to prevent double payment", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "DuplicateInv",
        importPilotBudget: true,
      });

      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-DUP-2026-01",
        amountHt: 1500,
        invoiceType: "UNIQUE",
      });
      const first = await api.uploadInvoicePdf(project.id, {
        name: pdf.filename,
        mimeType: pdf.mimeType,
        buffer: pdf.buffer,
      });
      expect([200, 201]).toContain(first.status);

      const second = await api.uploadInvoicePdf(project.id, {
        name: `copy_${pdf.filename}`,
        mimeType: pdf.mimeType,
        buffer: pdf.buffer,
      });
      if (!second.ok) {
        expect([400, 409, 422]).toContain(second.status);
        expect(JSON.stringify(second.raw)).toMatch(/doublon|duplicate|FAC-DUP-2026-01|existe/i);
      } else {
        const rawText = JSON.stringify(second.raw);
        expect(rawText).toMatch(/isDuplicate|doublon|duplicate/i);
      }
    });
  });

  // ===========================================================================
  // F14 — 1-Click Validation Pipeline Boundaries (5 connected + 1 serial 412)
  // ===========================================================================
  test.describe("Tier 2 — F14: Validation Pipeline Guardrails, Recovery & Idempotency", () => {
    test("T2-F14-01 Validating a CONFLICT_BLOCKED (326018) invoice without override returns 409 and executes zero external calls", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, budgetLines } = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "BlockValidate",
        importPilotBudget: true,
      });
      const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");

      const conflictUpload = await api.uploadInvoicePdf(project.id, {
        name: CONFLICT_INVOICE_CRISTALINE_326018.filename,
        mimeType: CONFLICT_INVOICE_CRISTALINE_326018.mimeType,
        buffer: CONFLICT_INVOICE_CRISTALINE_326018.buffer,
      });
      assertCpConflictBlocked(conflictUpload, "326018");

      const listedInvoices = await api.listInvoices(project.id);
      expect(listedInvoices.status).toBe(200);
      const rawInvoice = asRecord(asRecord(conflictUpload.raw).invoice);
      const conflictRecord = listedInvoices.data.find((inv) => inv.cpConflict === true);
      const quarantinedId = assertValidId(
        conflictUpload.data.id ?? rawInvoice.id ?? conflictRecord?.id,
        "quarantinedId"
      );

      const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");
      await api.harness.resetCalls();
      const validateRes = await api.validateInvoice(project.id, quarantinedId, {
        budgetLineId: mappingLineId,
      });
      expect(validateRes.ok).toBe(false);
      expect([403, 409, 422]).toContain(validateRes.status);

      const callsRes = await api.harness.getCalls();
      const externalMutations = callsRes.data.filter((c) =>
        /drive.*create|sheets.*update|updateCellNote|createDraft/i.test(
          String(c.operation ?? c.method ?? "")
        )
      );
      expect(externalMutations).toEqual([]);

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      expect(pickNumber(budgetAfter.summary, ["postOpTotalHt", "postOpHt"])).toBe(0);
    });

    test("T2-F14-02 Partial-failure recovery: Drive succeeds, Sheet step fails, retry completes without duplicate 001.3 file or double HT", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp, budgetLines } = await createIsolatedProject(
        api,
        testInfo.workerIndex,
        {
          suffix: "PartialRetry",
          importPilotBudget: true,
        }
      );
      const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");
      const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");

      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-RETRY-01",
        invoiceDate: "2026-09-20",
        amountHt: 2500,
        invoiceType: "UNIQUE",
        prestationSummary: "Mapping Fortnite Retry",
      });
      const uploaded = await api.uploadInvoicePdf(project.id, {
        name: pdf.filename,
        mimeType: pdf.mimeType,
        buffer: pdf.buffer,
      });
      expect([200, 201]).toContain(uploaded.status);
      const invoiceId = assertValidId(uploaded.data.id, "uploaded.data.id");

      try {
        await api.harness.resetCalls();
        const faultRes = await api.requestJson("POST", "/api/test-harness/state", {
          data: { failSheetsOnCallIndex: 1 },
        });
        expect(faultRes.ok).toBe(true);

        const failedAttempt = await api.validateInvoice(project.id, invoiceId, {
          budgetLineId: mappingLineId,
        });
        expect(failedAttempt.ok).toBe(false);
        expect(failedAttempt.status).toBeGreaterThanOrEqual(500);
      } finally {
        await api.requestJson("POST", "/api/test-harness/state", {
          data: { failSheetsOnCallIndex: null },
        });
        await api.harness.restoreConfigured();
      }

      const retryRes = await api.validateInvoice(project.id, invoiceId, {
        budgetLineId: mappingLineId,
      });
      expect(retryRes.status).toBe(200);
      expect(retryRes.data.status).toBe("VALIDATED");
      expect(retryRes.data.stepDriveDone).toBe(true);
      expect(retryRes.data.stepSheetDone).toBe(true);
      expect(retryRes.data.stepGmailDone).toBe(true);

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      const updatedLine = findBudgetLineByObjet(budgetAfter.lines, "Mapping & HUD Fortnite");
      expect(updatedLine?.postOpTotalHt).toBe(2500);

      const callsRes = await api.harness.getCalls();
      const normalizedCalls = callsRes.data.map(normalizeGatewayCall);
      const driveUploads = normalizedCalls.filter((c) => {
        const op = String(c.operation ?? c.method ?? "");
        const name = String(c.name ?? c.filename ?? "");
        return (
          /drive.*create|createFile|upload/i.test(op) &&
          (name.includes("FAC-RETRY-01") || name.includes("2500EUR.pdf"))
        );
      });
      expect(driveUploads.length).toBe(1);

      const draftCreates = callsRes.data.filter((c) =>
        /createDraft|drafts\.create/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(draftCreates.length).toBe(1);
      assertProdUntouched(callsRes.data);
    });

    test("T2-F14-03 Idempotency: re-calling validate on already VALIDATED invoice does NOT double HT or create second Gmail draft", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp, budgetLines } = await createIsolatedProject(
        api,
        testInfo.workerIndex,
        {
          suffix: "IdempotentVal",
          importPilotBudget: true,
        }
      );
      const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");
      const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");

      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-IDEMP-01",
        invoiceDate: "2026-09-21",
        amountHt: 3000,
        invoiceType: "ACOMPTE",
      });
      const uploaded = await api.uploadInvoicePdf(project.id, {
        name: pdf.filename,
        mimeType: pdf.mimeType,
        buffer: pdf.buffer,
      });
      expect([200, 201]).toContain(uploaded.status);
      const invoiceId = assertValidId(uploaded.data.id, "uploaded.data.id");

      const firstVal = await api.validateInvoice(project.id, invoiceId, {
        budgetLineId: mappingLineId,
      });
      expect(firstVal.status).toBe(200);
      const firstDraftId = firstVal.data.pennylaneDraftId;

      await api.harness.resetCalls();
      const secondVal = await api.validateInvoice(project.id, invoiceId, {
        budgetLineId: mappingLineId,
      });
      expect([200, 409]).toContain(secondVal.status);

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      const updatedLine = findBudgetLineByObjet(budgetAfter.lines, "Mapping & HUD Fortnite");
      expect(updatedLine?.postOpTotalHt).toBe(3000);

      const noteOccurrences = String(updatedLine?.invoiceNumbersNote ?? "").match(/FAC-IDEMP-01/g) ?? [];
      expect(noteOccurrences.length).toBe(1);

      const listAfter = await api.listInvoices(project.id);
      const persisted = listAfter.data.find((inv) => inv.id === invoiceId);
      expect(persisted?.pennylaneDraftId).toBe(firstDraftId);

      const callsRes = await api.harness.getCalls();
      const draftCreates = callsRes.data.filter((c) =>
        /createDraft|drafts\.create/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(draftCreates).toEqual([]);
      assertProdUntouched(callsRes.data);
    });

    test("T2-F14-05 Vendor name sanitization & decimal HT formatting produce safe YYYY-MM-DD_<CP>_<Presta>_1250.50EUR.pdf", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp, budgetLines } = await createIsolatedProject(
        api,
        testInfo.workerIndex,
        {
          suffix: "SanitizeName",
          importPilotBudget: true,
        }
      );
      const daLine = findBudgetLineByObjet(budgetLines, "DA / Charte graphique");
      const daLineId = assertValidId(daLine?.id, "daLine.id");

      const specialVendor = "L'Atelier ../Éphémère & Co";
      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: specialVendor,
        invoiceNumber: "FAC-SPEC-01",
        invoiceDate: "2026-09-22",
        amountHt: 1250.5,
        invoiceType: "UNIQUE",
        prestationSummary: "DA Visuels",
      });
      const uploaded = await api.uploadInvoicePdf(project.id, {
        name: pdf.filename,
        mimeType: pdf.mimeType,
        buffer: pdf.buffer,
      });
      expect([200, 201]).toContain(uploaded.status);
      const uploadedId = assertValidId(uploaded.data.id, "uploaded.data.id");

      const validated = await api.validateInvoice(project.id, uploadedId, {
        budgetLineId: daLineId,
        vendorName: specialVendor,
        amountHt: 1250.5,
      });
      expect(validated.status).toBe(200);

      const renamed = String(validated.data.renamedFilename ?? "");
      expect(renamed).toMatch(INVOICE_FILENAME_REGEX);
      expect(renamed).not.toContain("/");
      expect(renamed).not.toContain("..");
      expect(renamed).not.toContain(" ");
      expect(renamed).toBe(expectedInvoiceFilename("2026-09-22", cp, specialVendor, 1250.5));
      expect(renamed.endsWith("_1250.50EUR.pdf")).toBe(true);
      assertProdUntouched((await api.harness.getCalls()).data);
    });

    test("T2-F14-06 Cross-project validation guard returns 404 for foreign invoiceId and leaves PROD untouched", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const projA = await createIsolatedProject(api, testInfo.workerIndex, {
        suffix: "CrossValA",
        importPilotBudget: true,
      });
      const projB = await createIsolatedProject(api, testInfo.workerIndex + 1, {
        suffix: "CrossValB",
        importPilotBudget: true,
      });

      const pdfA = createInvoicePdfFixture({
        codeProjet: projA.cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-CROSS-A1",
        amountHt: 2000,
      });
      const uploadedA = await api.uploadInvoicePdf(projA.project.id, {
        name: pdfA.filename,
        mimeType: pdfA.mimeType,
        buffer: pdfA.buffer,
      });
      expect([200, 201]).toContain(uploadedA.status);
      const uploadedAId = assertValidId(uploadedA.data.id, "uploadedA.data.id");

      const lineB = findBudgetLineByObjet(projB.budgetLines, "Mapping & HUD Fortnite");
      const lineBId = assertValidId(lineB?.id, "lineB.id");
      await api.harness.resetCalls();
      const crossAttempt = await api.validateInvoice(
        projB.project.id,
        uploadedAId,
        { budgetLineId: lineBId }
      );
      expect(crossAttempt.ok).toBe(false);
      expect([403, 404]).toContain(crossAttempt.status);

      const budgetB = extractBudgetEnvelope((await api.getBudget(projB.project.id)).raw);
      expect(pickNumber(budgetB.summary, ["postOpTotalHt", "postOpHt"])).toBe(0);
      assertProdUntouched((await api.harness.getCalls()).data);
    });
  });
});

// =============================================================================
// Serial Unconfigured (412 Precondition Failed) Group (T2-F11-05, T2-F13-06, T2-F14-04)
// =============================================================================
test.describe.serial("Tier 2 — Unconfigured Preconditions (412) Isolated Serial Group (F11–F14)", () => {
  test.afterAll(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.restoreConfigured();
  });

  test("T2-F11-05 Missing Google OAuth2 returns 412 GOOGLE_NOT_CONNECTED on .xlsx import and PROD copy with zero orphan lines", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, cp } = await createIsolatedProject(api, testInfo.workerIndex, {
      suffix: "NoGoogleF11",
      provisionDrive: false,
    });

    await api.harness.setUnconfigured({ google: true, gemini: true });
    try {
      const xlsx = buildPilot326027BudgetXlsx(cp);
      const importRes = await api.importBudgetXlsx(project.id, {
        file: {
          name: xlsx.filename,
          mimeType: xlsx.mimeType,
          buffer: xlsx.buffer,
        },
      });
      assertPreconditionMissing(importRes, "GOOGLE_NOT_CONNECTED");

      const copyRes = await api.importBudgetXlsx(project.id, {
        sourceSheetId: PROD_IDS.PROD_BUDGET_SHEET,
      });
      assertPreconditionMissing(copyRes, "GOOGLE_NOT_CONNECTED");

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      expect(budgetAfter.budgetSheetId).toBeNull();
      expect(budgetAfter.lines).toEqual([]);
    } finally {
      await api.harness.restoreConfigured();
    }
  });

  test("T2-F13-06 Missing GEMINI_API_KEY returns 412 GEMINI_KEY_MISSING with zero fake extraction & /budget setup banner", async ({
    page,
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, cp } = await createIsolatedProject(api, testInfo.workerIndex, {
      suffix: "NoGeminiF13",
      importPilotBudget: true,
    });

    await api.harness.setState({
      googleConnected: true,
      googleClientConfigured: true,
      geminiConfigured: false,
    });

    try {
      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-NO-GEMINI",
        amountHt: 1500,
      });
      const uploadRes = await api.uploadInvoicePdf(project.id, {
        name: pdf.filename,
        mimeType: pdf.mimeType,
        buffer: pdf.buffer,
      });
      assertPreconditionMissing(uploadRes, "GEMINI_KEY_MISSING");

      const scanRes = await api.scanGmailInvoices(project.id);
      assertPreconditionMissing(scanRes, "GEMINI_KEY_MISSING");

      const invoicesAfter = await api.listInvoices(project.id);
      expect(invoicesAfter.data).toEqual([]);

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      const scanBtn = page.getByRole("button", { name: /Scanner Gmail/i }).first();
      await expect(scanBtn).toBeVisible();
      await expect(scanBtn).toBeEnabled();
      await scanBtn.click();
      await assertSetupPreconditionBanner(page);
    } finally {
      await api.harness.restoreConfigured();
    }
  });

  test("T2-F14-04 Missing Google OAuth2 during 1-click validation returns 412 GOOGLE_NOT_CONNECTED and leaves DB/Sheet untouched", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const { project, cp, budgetLines } = await createIsolatedProject(
      api,
      testInfo.workerIndex,
      {
        suffix: "NoGoogleF14",
        importPilotBudget: true,
      }
    );
    const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");
    const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");

    const pdf = createInvoicePdfFixture({
      codeProjet: cp,
      vendorName: "Vertigo Studio",
      invoiceNumber: "FAC-412-VAL",
      amountHt: 2000,
      invoiceType: "UNIQUE",
    });
    const uploaded = await api.uploadInvoicePdf(project.id, {
      name: pdf.filename,
      mimeType: pdf.mimeType,
      buffer: pdf.buffer,
    });
    expect([200, 201]).toContain(uploaded.status);
    const invoiceId = assertValidId(uploaded.data.id, "uploaded.data.id");

    await api.harness.setUnconfigured({ google: true });
    try {
      const valRes = await api.validateInvoice(project.id, invoiceId, {
        budgetLineId: mappingLineId,
      });
      assertPreconditionMissing(valRes, "GOOGLE_NOT_CONNECTED");

      const listAfter = await api.listInvoices(project.id);
      const persisted = listAfter.data.find((inv) => inv.id === invoiceId);
      expect(persisted?.status).toBe("PENDING_VALIDATION");
      expect(persisted?.driveFileId ?? null).toBeNull();
      expect(persisted?.pennylaneDraftId ?? null).toBeNull();

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      expect(pickNumber(budgetAfter.summary, ["postOpTotalHt", "postOpHt"])).toBe(0);
    } finally {
      await api.harness.restoreConfigured();
    }
  });
});
