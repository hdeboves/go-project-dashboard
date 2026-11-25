/**
 * Tier 1 — Isolated Happy-Path Opaque-Box E2E Tests (F11–F14: Budget 3-Blocs & Invoice Pipeline)
 * Target count: 24 tests (6 per feature across F11, F12, F13, F14; exceeds >=20 / >=5 minimum).
 * Progressive testability: Exercises ONLY M1+M2 HTTP APIs, /budget UI, and TEST_BOUNDARY_HARNESS=1 ports.
 * Zero src/ or prisma/ imports. Never mutates PROD IDs.
 */

import { expect, test } from "@playwright/test";
import {
  createApiClient,
  type ApiClient,
  type BudgetLinePayload,
  type DriveNodeDto,
  type ProjectDto,
} from "../helpers/api-client";
import {
  assertAuditLogged,
  assertBudgetThresholdAlert,
  assertPennylaneDraftShape,
  assertProdUntouched,
} from "../helpers/assertions";
import {
  BASE_URL,
  INVOICE_FILENAME_REGEX,
  PENNYLANE_DEFAULT_CC_NAMES,
  PENNYLANE_EMAIL,
  PENNYLANE_SUBJECT_REGEX,
  PROD_IDS,
  PROD_IMMUTABLE_ID_SET,
  expectedInvoiceFilename,
  expectedPennylaneSubject,
  uniqueTestCp,
} from "../helpers/constants";
import {
  buildPilot326027BudgetXlsx,
  buildXlsxWorkbook,
  type XlsxCellValue,
} from "../fixtures/budget-xlsx";
import { createInvoicePdfFixture } from "../fixtures/invoices";

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

function findNodeByCode(nodes: DriveNodeDto[], code: string): DriveNodeDto | undefined {
  return nodes.find((n) => n.code === code || n.name.startsWith(code));
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

function extractBudgetEnvelope(raw: unknown): {
  lines: Record<string, unknown>[];
  summary: Record<string, unknown>;
  categories: Record<string, unknown>[];
  alerts: Record<string, unknown>[];
  budgetSheetId: string | null;
} {
  const root = asRecord(raw);
  const data = isRecord(root.data) ? root.data : root;
  const lines = asRecordArray(data.lines ?? root.lines ?? data.budgetLines ?? root.budgetLines);
  const summary = asRecord(data.summary ?? root.summary);
  const categories = asRecordArray(
    data.categories ??
      root.categories ??
      data.categoryBreakdown ??
      root.categoryBreakdown
  );
  const alerts = asRecordArray(data.alerts ?? root.alerts);
  const budgetSheetId =
    typeof data.budgetSheetId === "string"
      ? data.budgetSheetId
      : typeof root.budgetSheetId === "string"
        ? root.budgetSheetId
        : null;

  return { lines, summary, categories, alerts, budgetSheetId };
}

function assertSummaryCloseTo(
  summary: Record<string, unknown>,
  keys: readonly string[],
  expected: number,
  precision = 2
): void {
  const actual = pickNumber(summary, keys);
  expect(actual, `Expected finite KPI for [${keys.join(", ")}] in ${JSON.stringify(summary)}`).toBeDefined();
  expect(actual as number).toBeCloseTo(expected, precision);
}

function assertStrictPennylaneDraft(
  draft: Record<string, unknown>,
  expected: { cp: string; presta: string; expectedRenamedFilename: string }
): void {
  assertPennylaneDraftShape(draft, { cp: expected.cp, presta: expected.presta });
  expect(draft.to).toBe(PENNYLANE_EMAIL);
  expect(String(draft.subject ?? "")).toMatch(PENNYLANE_SUBJECT_REGEX);

  const ccVal = draft.cc;
  const ccSerialized = Array.isArray(ccVal) ? ccVal.join(" ") : String(ccVal ?? "");
  for (const name of PENNYLANE_DEFAULT_CC_NAMES) {
    const normalizedName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const normalizedCc = ccSerialized.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    expect(normalizedCc, `Expected CC "${ccSerialized}" to include ${name}`).toContain(normalizedName);
  }

  const attachments = Array.isArray(draft.attachments) ? draft.attachments.filter(isRecord) : [];
  const firstAttachment = attachments[0];
  const firstAttachmentName =
    typeof firstAttachment?.filename === "string"
      ? firstAttachment.filename
      : typeof firstAttachment?.name === "string"
        ? firstAttachment.name
        : "";
  const attachmentFilename =
    typeof draft.attachmentFilename === "string" && draft.attachmentFilename.length > 0
      ? draft.attachmentFilename
      : firstAttachmentName;
  expect(attachmentFilename).toMatch(INVOICE_FILENAME_REGEX);
  expect(attachmentFilename).toBe(expected.expectedRenamedFilename);
  expect(draft.sent).not.toBe(true);
}

function buildThreeExpenseTypesBudgetXlsx(codeProjet: string): Buffer {
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

  const buildLine = (opts: {
    objet: string;
    realisePar: string;
    saleQty: number;
    saleDays: number;
    saleUnit: number;
    saleTotal: number;
    expenseType: "Externe" | "RH Internes" | "Amortissement";
    preOpUnit: number;
    preOpTotal: number;
    postOpTotal?: number;
  }): XlsxCellValue[] => {
    const row = makeRow();
    row[2] = opts.objet;
    row[3] = opts.realisePar;
    row[4] = opts.saleQty;
    row[5] = opts.saleDays;
    row[6] = opts.saleUnit;
    row[7] = opts.saleTotal;
    row[9] = opts.expenseType;
    row[10] = opts.preOpUnit;
    row[11] = opts.preOpTotal;
    row[15] = opts.postOpTotal && opts.postOpTotal > 0 ? 1 : 0;
    row[16] = opts.postOpTotal && opts.postOpTotal > 0 ? 1 : 0;
    row[17] = opts.postOpTotal ?? 0;
    row[18] = opts.postOpTotal ?? 0;
    return row;
  };

  return buildXlsxWorkbook([
    {
      name: "Vue d'ensemble",
      rows: [
        ["Caisse d'Épargne x Fortnite", null, null, null],
        ["Année :", 2026, "Code projet :", codeProjet],
        ["Chef de projet :", "Hugo Debôves", null, null],
      ],
    },
    {
      name: "Postes de dépenses",
      rows: [
        ["Budget Multi-Blocs", null, "Code projet :", codeProjet],
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
        [null, null, "MAPPING & DEV"],
        buildLine({
          objet: "Développement Map Fortnite",
          realisePar: "Vertigo Studio",
          saleQty: 1,
          saleDays: 6,
          saleUnit: 1200,
          saleTotal: 7200,
          expenseType: "Externe",
          preOpUnit: 1000,
          preOpTotal: 6000,
          postOpTotal: 1500,
        }),
        [null, null, "MANAGEMENT"],
        buildLine({
          objet: "Chefferie de projet interne",
          realisePar: "Hugo Debôves",
          saleQty: 1,
          saleDays: 5,
          saleUnit: 600,
          saleTotal: 3000,
          expenseType: "RH Internes",
          preOpUnit: 300,
          preOpTotal: 1500,
          postOpTotal: 0,
        }),
        [null, null, "MATÉRIEL & AMORTISSEMENT"],
        buildLine({
          objet: "Régie Stream & Matériel",
          realisePar: "Interne GO",
          saleQty: 1,
          saleDays: 2,
          saleUnit: 900,
          saleTotal: 1800,
          expenseType: "Amortissement",
          preOpUnit: 250,
          preOpTotal: 500,
          postOpTotal: 0,
        }),
      ],
    },
  ]);
}

async function createBudgetReadyProject(
  api: ApiClient,
  workerIndex: number,
  opts?: { suffix?: string; importPilotXlsx?: boolean; client?: string; nomJeu?: string }
): Promise<{
  project: ProjectDto;
  cp: string;
  nodes: DriveNodeDto[];
  budgetLines: Record<string, unknown>[];
}> {
  const cp = uniqueTestCp(workerIndex);
  const suffix = opts?.suffix ?? "Budget";
  const created = await api.createProject({
    codeProjet: cp,
    client: opts?.client ?? `Client ${suffix} ${cp}`,
    nomJeu: opts?.nomJeu ?? `Fortnite ${suffix}`,
    isSandbox: true,
  });
  expect(created.status, `Failed creating project ${cp}: ${JSON.stringify(created.raw)}`).toBe(201);
  const project = created.data;
  expect(project.id).toBeTruthy();

  const provisioned = await api.provisionDriveTree(project.id);
  expect([200, 201]).toContain(provisioned.status);

  const treeRes = await api.getDriveTree(project.id);
  expect(treeRes.status).toBe(200);

  let budgetLines: Record<string, unknown>[] = [];
  if (opts?.importPilotXlsx !== false) {
    const fixture = buildPilot326027BudgetXlsx(cp);
    const imported = await api.importBudgetXlsx(project.id, {
      file: {
        name: fixture.filename,
        mimeType: fixture.mimeType,
        buffer: fixture.buffer,
      },
    });
    expect(
      [200, 201],
      `Budget import failed for ${cp}: ${JSON.stringify(imported.raw)}`
    ).toContain(imported.status);

    const budgetRes = await api.getBudget(project.id);
    expect(budgetRes.status).toBe(200);
    budgetLines = extractBudgetEnvelope(budgetRes.raw).lines;
  }

  return { project, cp, nodes: treeRes.data, budgetLines };
}

test.describe("Tier 1 — Connected Harness Tests (F11–F14)", () => {
  test.beforeEach(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.restoreConfigured();
  });

  // ===========================================================================
  // F11 — Budget Sheet Initialization (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F11: Budget Sheet Initialization", () => {
    test("T1-F11-01 Import valid 3-block .xlsx initializes BudgetLines, sandbox Sheet, and AuditLog", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F11Import",
        importPilotXlsx: false,
      });

      await api.harness.resetCalls();
      const fixture = buildPilot326027BudgetXlsx(cp);
      const importRes = await api.importBudgetXlsx(project.id, {
        file: {
          name: fixture.filename,
          mimeType: fixture.mimeType,
          buffer: fixture.buffer,
        },
      });
      expect([200, 201]).toContain(importRes.status);

      const budgetRes = await api.getBudget(project.id);
      expect(budgetRes.status).toBe(200);
      const { lines, budgetSheetId } = extractBudgetEnvelope(budgetRes.raw);
      expect(budgetSheetId).toBeTruthy();
      expect(PROD_IMMUTABLE_ID_SET.has(budgetSheetId as string)).toBe(false);
      expect(lines.length).toBe(3);

      const mappingLine = findBudgetLineByObjet(lines, "Mapping & HUD Fortnite");
      expect(mappingLine).toBeDefined();
      expect(mappingLine?.realisePar).toBe("Vertigo Studio");
      expect(mappingLine?.expenseType).toBe("Externe");
      expect(mappingLine?.saleTotalHt).toBe(10000);
      expect(mappingLine?.preOpTotalHt).toBe(6000);
      expect(mappingLine?.postOpTotalHt).toBe(0);

      const daLine = findBudgetLineByObjet(lines, "DA / Charte graphique");
      expect(daLine).toBeDefined();
      expect(daLine?.saleTotalHt).toBe(2000);
      expect(daLine?.preOpTotalHt).toBe(1000);

      const matLine = findBudgetLineByObjet(lines, "Matériel");
      expect(matLine).toBeDefined();
      expect(matLine?.expenseType).toBe("Amortissement");

      const auditRes = await api.listAuditLogs(project.id);
      assertAuditLogged(auditRes, {
        projectId: project.id,
        action: /BUDGET|IMPORT/i,
      });

      const callsRes = await api.harness.getCalls();
      assertProdUntouched(callsRes.data);
    });

    test("T1-F11-02 Copy PROD Budget Sheet into sandbox 001.1 Budget without mutating PROD", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, nodes } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F11CopyProd",
        importPilotXlsx: false,
      });
      const node0011 = findNodeByCode(nodes, "001.1");
      expect(node0011?.driveFileId).toBeTruthy();

      await api.harness.resetCalls();
      const copyRes = await api.importBudgetXlsx(project.id, {
        sourceSheetId: PROD_IDS.PROD_BUDGET_SHEET,
      });
      expect([200, 201]).toContain(copyRes.status);

      const budgetRes = await api.getBudget(project.id);
      expect(budgetRes.status).toBe(200);
      const { budgetSheetId } = extractBudgetEnvelope(budgetRes.raw);
      expect(budgetSheetId).toBeTruthy();
      expect(budgetSheetId).not.toBe(PROD_IDS.PROD_BUDGET_SHEET);
      expect(PROD_IMMUTABLE_ID_SET.has(budgetSheetId as string)).toBe(false);

      const callsRes = await api.harness.getCalls();
      const normalizedCalls = callsRes.data.map(normalizeGatewayCall);
      const copyCall = normalizedCalls.find((c) => {
        const op = String(c.operation ?? c.method ?? "");
        const sourceId = c.sourceFileId ?? c.sourceId;
        return /copy/i.test(op) && sourceId === PROD_IDS.PROD_BUDGET_SHEET;
      });
      expect(copyCall, `Expected Drive copy call from PROD_BUDGET_SHEET in ${JSON.stringify(callsRes.data)}`).toBeDefined();
      const node0011DriveId = assertValidId(node0011?.driveFileId, "node0011.driveFileId");
      expect(copyCall?.destinationParentId ?? copyCall?.parentId).toBe(node0011DriveId);
      assertProdUntouched(callsRes.data, { allowCopySource: true });
    });

    test("T1-F11-03 Imported 3-block rows preserve exact Prix de vente, Pré-op, Post-op & expense types", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F11Blocks",
        importPilotXlsx: false,
      });

      const xlsxBuf = buildThreeExpenseTypesBudgetXlsx(cp);
      const importRes = await api.importBudgetXlsx(project.id, {
        file: {
          name: `Budget_Multi_${cp}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: xlsxBuf,
        },
      });
      expect([200, 201]).toContain(importRes.status);

      const budgetRes = await api.getBudget(project.id);
      expect(budgetRes.status).toBe(200);
      const { lines } = extractBudgetEnvelope(budgetRes.raw);
      expect(lines.length).toBe(3);

      const ext = findBudgetLineByObjet(lines, "Développement Map Fortnite");
      expect(ext?.saleQty).toBe(1);
      expect(ext?.saleDays).toBe(6);
      expect(ext?.saleUnitPrice).toBe(1200);
      expect(ext?.saleTotalHt).toBe(7200);
      expect(ext?.expenseType).toBe("Externe");
      expect(ext?.preOpUnitCost).toBe(1000);
      expect(ext?.preOpTotalHt).toBe(6000);
      expect(ext?.postOpTotalHt).toBe(1500);

      const rh = findBudgetLineByObjet(lines, "Chefferie de projet interne");
      expect(rh?.expenseType).toBe("RH Internes");
      expect(rh?.saleTotalHt).toBe(3000);
      expect(rh?.preOpTotalHt).toBe(1500);
      expect(rh?.postOpTotalHt).toBe(0);

      const amort = findBudgetLineByObjet(lines, "Régie Stream & Matériel");
      expect(amort?.expenseType).toBe("Amortissement");
      expect(amort?.saleTotalHt).toBe(1800);
      expect(amort?.preOpTotalHt).toBe(500);

      assertProdUntouched((await api.harness.getCalls()).data);
    });

    test("T1-F11-04 Manual BudgetLine creation and update via POST /budget persists across reload", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F11Crud",
      });

      await api.harness.resetCalls();
      const payload: BudgetLinePayload = {
        category: "INFLUENCE",
        objet: "Activation Kalut TikTok",
        realisePar: "Kalut",
        expenseType: "Externe",
        saleQty: 1,
        saleDays: 1,
        saleUnitPrice: 5000,
        saleTotalHt: 5000,
        preOpUnitCost: 3500,
        preOpTotalHt: 3500,
        postOpTotalHt: 0,
      };
      const createdLine = await api.upsertBudgetLine(project.id, payload);
      expect([200, 201]).toContain(createdLine.status);
      const createdLineId = assertValidId(createdLine.data.id, "createdLine.data.id");

      const updatedLine = await api.upsertBudgetLine(project.id, {
        ...payload,
        id: createdLineId,
        preOpTotalHt: 3750,
        preOpUnitCost: 3750,
      });
      expect([200, 201]).toContain(updatedLine.status);

      const budgetRes = await api.getBudget(project.id);
      expect(budgetRes.status).toBe(200);
      const found = findBudgetLineByObjet(
        extractBudgetEnvelope(budgetRes.raw).lines,
        "Activation Kalut TikTok"
      );
      expect(found).toBeDefined();
      expect(found?.saleTotalHt).toBe(5000);
      expect(found?.preOpTotalHt).toBe(3750);

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      await expect(page.locator("body")).toContainText("Activation Kalut TikTok");
      await page.reload();
      await expect(page.locator("body")).toContainText("Activation Kalut TikTok");

      const callsRes = await api.harness.getCalls();
      assertProdUntouched(callsRes.data);
    });

    test("T1-F11-05 /budget UI .xlsx import flow renders 3-block table with zero console/page errors", async ({
      page,
      request,
    }, testInfo) => {
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      const api = createApiClient(request);
      const { project, cp } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F11UiImport",
        importPilotXlsx: false,
      });
      const fixture = buildPilot326027BudgetXlsx(cp);

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      const fileInput = page
        .locator(
          'input[type="file"][accept*="xlsx"], input[type="file"][accept*="spreadsheetml"], [data-testid*="xlsx"] input[type="file"]'
        )
        .first();
      await expect(fileInput).toBeAttached();
      await fileInput.setInputFiles({
        name: fixture.filename,
        mimeType: fixture.mimeType,
        buffer: fixture.buffer,
      });

      await expect(page.locator("body")).toContainText(/Mapping & HUD Fortnite/i);
      await expect(page.locator("body")).toContainText(/Prix de vente/i);
      await expect(page.locator("body")).toContainText(/pr[ée]-op[ée]ration/i);
      await expect(page.locator("body")).toContainText(/post-op[ée]ration/i);
      await expect(page.locator("body")).toContainText(/CR[ÉE]ATION DE LA CARTE DANS FORTNITE/i);

      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      assertProdUntouched((await api.harness.getCalls()).data);
    });

    test("T1-F11-06 Re-importing updated .xlsx refreshes BudgetLines idempotently without duplicate rows", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F11Reimport",
      });

      const updatedBuf = buildThreeExpenseTypesBudgetXlsx(cp);
      const reimportRes = await api.importBudgetXlsx(project.id, {
        file: {
          name: `Budget_Updated_${cp}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: updatedBuf,
        },
      });
      expect([200, 201]).toContain(reimportRes.status);

      const budgetRes = await api.getBudget(project.id);
      expect(budgetRes.status).toBe(200);
      const { lines, summary } = extractBudgetEnvelope(budgetRes.raw);
      expect(lines.length).toBe(3);

      const devMatches = lines.filter((l) =>
        String(l.objet ?? "").includes("Développement Map Fortnite")
      );
      expect(devMatches.length).toBe(1);
      assertSummaryCloseTo(summary, ["soldTotalHt", "soldHt"], 12000);
      assertSummaryCloseTo(summary, ["preOpTotalHt", "preOpHt"], 8000);
      assertSummaryCloseTo(summary, ["postOpTotalHt", "postOpHt"], 1500);

      const callsRes = await api.harness.getCalls();
      assertProdUntouched(callsRes.data);
    });
  });

  // ===========================================================================
  // F12 — Real-Time Budget KPIs, Charts & 85%/100% Alerts (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F12: Real-Time Budget KPIs, Charts & 85%/100% Alerts", () => {
    test("T1-F12-01 Real-time KPI computation: Sold HT, Pre-op, Post-op, Reste à engager, Planned & Real margins", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, budgetLines } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F12Kpis",
      });
      const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");
      const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");

      const updated = await api.upsertBudgetLine(project.id, {
        id: mappingLineId,
        category: String(mappingLine?.category ?? "CRÉATION DE LA CARTE DANS FORTNITE"),
        objet: String(mappingLine?.objet ?? "Mapping & HUD Fortnite"),
        realisePar: String(mappingLine?.realisePar ?? "Vertigo Studio"),
        expenseType: "Externe",
        saleQty: 1,
        saleDays: 10,
        saleUnitPrice: 1000,
        saleTotalHt: 10000,
        preOpUnitCost: 600,
        preOpTotalHt: 6000,
        postOpTotalHt: 3000,
      });
      expect([200, 201]).toContain(updated.status);

      const budgetRes = await api.getBudget(project.id);
      expect(budgetRes.status).toBe(200);
      const { summary } = extractBudgetEnvelope(budgetRes.raw);
      assertSummaryCloseTo(summary, ["soldTotalHt", "soldHt"], 12000);
      assertSummaryCloseTo(summary, ["preOpTotalHt", "preOpHt"], 7000);
      assertSummaryCloseTo(summary, ["postOpTotalHt", "postOpHt"], 3000);
      assertSummaryCloseTo(
        summary,
        ["remainingToCommitHt", "resteAEngager", "remainingToCommit"],
        4000
      );
      assertSummaryCloseTo(summary, ["plannedMarginHt"], 5000);
      assertSummaryCloseTo(summary, ["plannedMarginPct"], 41.67, 1);
      assertSummaryCloseTo(summary, ["realMarginHt"], 9000);
      assertSummaryCloseTo(summary, ["realMarginPct"], 75, 1);

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      await expect(page.locator("body")).toContainText(/12[\s\u00a0]?000/);
      await expect(page.locator("body")).toContainText(/7[\s\u00a0]?000/);
      await expect(page.locator("body")).toContainText(/3[\s\u00a0]?000/);
      await expect(page.locator("body")).toContainText(/4[\s\u00a0]?000/);
      await expect(page.locator("body")).toContainText(/Marge pr[ée]vue/i);
      await expect(page.locator("body")).toContainText(/Marge r[ée]elle/i);
    });

    test("T1-F12-02 Category aggregation and charts breakdown match global line sums", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F12Categories",
      });

      const budgetRes = await api.getBudget(project.id);
      expect(budgetRes.status).toBe(200);
      const { summary, categories } = extractBudgetEnvelope(budgetRes.raw);
      expect(categories.length).toBeGreaterThanOrEqual(2);

      const catSoldSum = categories.reduce(
        (acc, c) => acc + (pickNumber(c, ["soldTotalHt", "saleTotalHt"]) ?? 0),
        0
      );
      const catPreOpSum = categories.reduce(
        (acc, c) => acc + (pickNumber(c, ["preOpTotalHt"]) ?? 0),
        0
      );
      const catPostOpSum = categories.reduce(
        (acc, c) => acc + (pickNumber(c, ["postOpTotalHt"]) ?? 0),
        0
      );
      expect(catSoldSum).toBeCloseTo(pickNumber(summary, ["soldTotalHt", "soldHt"]) ?? 0, 2);
      expect(catPreOpSum).toBeCloseTo(pickNumber(summary, ["preOpTotalHt", "preOpHt"]) ?? 0, 2);
      expect(catPostOpSum).toBeCloseTo(pickNumber(summary, ["postOpTotalHt", "postOpHt"]) ?? 0, 2);

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      await expect(page.locator("body")).toContainText(/cat[ée]gorie/i);
      await expect(page.locator("body")).toContainText(/CR[ÉE]ATION DE LA CARTE DANS FORTNITE/i);
    });

    test("T1-F12-03 >=85% consumption triggers WARNING alert on API and /budget UI", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, budgetLines } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F12Alert85",
      });
      const daLine = findBudgetLineByObjet(budgetLines, "DA / Charte graphique");
      const daLineId = assertValidId(daLine?.id, "daLine.id");

      const updated = await api.upsertBudgetLine(project.id, {
        id: daLineId,
        category: String(daLine?.category ?? "CHARTE"),
        objet: String(daLine?.objet ?? "DA / Charte graphique"),
        realisePar: "Agency Alpha",
        expenseType: "Externe",
        saleTotalHt: 2000,
        preOpTotalHt: 1000,
        postOpTotalHt: 880,
      });
      expect([200, 201]).toContain(updated.status);

      const budgetRes = await api.getBudget(project.id);
      const { alerts } = extractBudgetEnvelope(budgetRes.raw);
      const warn85 = alerts.find(
        (a) =>
          String(a.objet ?? "").includes("DA / Charte graphique") &&
          String(a.level ?? "").toUpperCase().includes("WARN") &&
          (a.thresholdPct === 85 || Number(a.ratioPct ?? a.consumptionPct ?? 0) >= 85)
      );
      expect(warn85, `Expected 85% WARNING alert in ${JSON.stringify(alerts)}`).toBeDefined();

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      await assertBudgetThresholdAlert(page, "85%");
    });

    test("T1-F12-04 >=100% consumption triggers CRITICAL alert on API and /budget UI", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, budgetLines } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F12Alert100",
      });
      const daLine = findBudgetLineByObjet(budgetLines, "DA / Charte graphique");
      const daLineId = assertValidId(daLine?.id, "daLine.id");

      const updated = await api.upsertBudgetLine(project.id, {
        id: daLineId,
        category: String(daLine?.category ?? "CHARTE"),
        objet: String(daLine?.objet ?? "DA / Charte graphique"),
        realisePar: "Agency Alpha",
        expenseType: "Externe",
        saleTotalHt: 2000,
        preOpTotalHt: 1000,
        postOpTotalHt: 1200,
      });
      expect([200, 201]).toContain(updated.status);

      const budgetRes = await api.getBudget(project.id);
      const { alerts } = extractBudgetEnvelope(budgetRes.raw);
      const crit100 = alerts.find(
        (a) =>
          String(a.objet ?? "").includes("DA / Charte graphique") &&
          String(a.level ?? "").toUpperCase().includes("CRIT") &&
          (a.thresholdPct === 100 || Number(a.ratioPct ?? a.consumptionPct ?? 0) >= 100)
      );
      expect(crit100, `Expected 100% CRITICAL alert in ${JSON.stringify(alerts)}`).toBeDefined();

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      await assertBudgetThresholdAlert(page, "100%");
    });

    test("T1-F12-05 Live KPI recalculation immediately after invoice validation updates Marge réelle & Reste à engager", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp, budgetLines } = await createBudgetReadyProject(
        api,
        testInfo.workerIndex,
        { suffix: "F12LiveRecalc" }
      );
      const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");
      const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");

      const beforeBudget = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      assertSummaryCloseTo(beforeBudget.summary, ["postOpTotalHt", "postOpHt"], 0);
      assertSummaryCloseTo(
        beforeBudget.summary,
        ["remainingToCommitHt", "resteAEngager", "remainingToCommit"],
        7000
      );

      const invoicePdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-2026-0142",
        invoiceDate: "2026-09-05",
        amountHt: 3000,
        invoiceType: "ACOMPTE",
        prestationSummary: "Mapping Fortnite",
      });
      const uploaded = await api.uploadInvoicePdf(
        project.id,
        {
          name: invoicePdf.filename,
          mimeType: invoicePdf.mimeType,
          buffer: invoicePdf.buffer,
        },
        { budgetLineId: mappingLineId }
      );
      expect([200, 201]).toContain(uploaded.status);
      const uploadedId = assertValidId(uploaded.data.id, "uploaded.data.id");

      const validated = await api.validateInvoice(project.id, uploadedId, {
        budgetLineId: mappingLineId,
      });
      expect(validated.status).toBe(200);

      const afterBudget = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      assertSummaryCloseTo(afterBudget.summary, ["postOpTotalHt", "postOpHt"], 3000);
      assertSummaryCloseTo(
        afterBudget.summary,
        ["remainingToCommitHt", "resteAEngager", "remainingToCommit"],
        4000
      );
      assertSummaryCloseTo(afterBudget.summary, ["realMarginHt"], 9000);

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      await expect(page.locator("body")).toContainText(/9[\s\u00a0]?000/);
      await expect(page.locator("body")).toContainText(/4[\s\u00a0]?000/);

      assertProdUntouched((await api.harness.getCalls()).data);
    });

    test("T1-F12-06 Expense-type breakdown (Externe, RH Internes, Amortissement) distinguishes Gross vs Net margin", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F12GrossNet",
        importPilotXlsx: false,
      });

      const xlsxBuf = buildThreeExpenseTypesBudgetXlsx(cp);
      const importRes = await api.importBudgetXlsx(project.id, {
        file: {
          name: `Budget_GrossNet_${cp}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: xlsxBuf,
        },
      });
      expect([200, 201]).toContain(importRes.status);

      const budgetRes = await api.getBudget(project.id);
      expect(budgetRes.status).toBe(200);
      const { summary } = extractBudgetEnvelope(budgetRes.raw);
      assertSummaryCloseTo(summary, ["soldTotalHt", "soldHt"], 12000);
      assertSummaryCloseTo(summary, ["preOpExternalHt", "externalCostsHt"], 6000);
      assertSummaryCloseTo(summary, ["preOpRhHt", "rhInternesHt"], 1500);
      assertSummaryCloseTo(summary, ["preOpAmortHt", "amortissementHt"], 500);
      assertSummaryCloseTo(summary, ["preOpTotalHt", "preOpHt"], 8000);
      assertSummaryCloseTo(summary, ["grossMarginHt", "margeBruteHt"], 6000);
      assertSummaryCloseTo(summary, ["plannedMarginHt", "netMarginHt", "margeNetteHt"], 4000);
    });
  });

  // ===========================================================================
  // F13 — Invoice Ingestion & Gemini PDF Extraction (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F13: Invoice Ingestion & Gemini PDF Extraction", () => {
    test("T1-F13-01 Drag-and-drop PDF upload invokes Gemini extraction & suggests matching BudgetLine", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp, budgetLines } = await createBudgetReadyProject(
        api,
        testInfo.workerIndex,
        { suffix: "F13Upload" }
      );
      const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");
      const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");

      const invoicePdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-2026-0142",
        invoiceDate: "2026-09-05",
        amountHt: 3000,
        invoiceType: "ACOMPTE",
        prestationSummary: "Mapping & HUD Fortnite",
      });
      const res = await api.uploadInvoicePdf(project.id, {
        name: invoicePdf.filename,
        mimeType: invoicePdf.mimeType,
        buffer: invoicePdf.buffer,
      });
      expect([200, 201]).toContain(res.status);
      assertValidId(res.data.id, "res.data.id");
      expect(res.data.status).toBe("PENDING_VALIDATION");
      expect(res.data.cpConflict).toBe(false);
      expect(res.data.vendorName).toBe("Vertigo Studio");
      expect(res.data.invoiceNumber).toBe("FAC-2026-0142");
      expect(res.data.invoiceDate).toBe("2026-09-05");
      expect(res.data.amountHt).toBe(3000);
      expect(res.data.tvaAmount).toBe(600);
      expect(res.data.amountTtc).toBe(3600);
      expect(res.data.invoiceType).toBe("ACOMPTE");
      expect(res.data.detectedCodeProjet).toBe(cp);

      const rawObj = asRecord(res.raw);
      const suggestedId =
        res.data.budgetLineId ??
        res.data.suggestedBudgetLineId ??
        rawObj.suggestedBudgetLineId;
      expect(suggestedId).toBe(mappingLineId);
    });

    test("T1-F13-02 Gmail invoice scan ingests unread project PDFs and excludes - Factures labeled threads", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F13GmailScan",
      });

      const unreadPdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-GMAIL-001",
        invoiceDate: "2026-09-08",
        amountHt: 2200,
        invoiceType: "UNIQUE",
        prestationSummary: "Mapping Fortnite",
      });
      const alreadyLabeledPdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Agency Alpha",
        invoiceNumber: "FAC-GMAIL-OLD",
        invoiceDate: "2026-09-01",
        amountHt: 999,
        invoiceType: "UNIQUE",
        prestationSummary: "Deja traitee",
      });

      const seedUnread = await api.requestJson("POST", "/api/test-harness/seed-gmail", {
        data: {
          projectId: project.id,
          messageId: `msg-unread-${cp}`,
          subject: `Facture Mapping CP ${cp}`,
          from: "facturation@vertigostudio.fr",
          labels: ["INBOX"],
          attachment: {
            filename: unreadPdf.filename,
            mimeType: unreadPdf.mimeType,
            contentBase64: unreadPdf.buffer.toString("base64"),
          },
        },
      });
      expect([200, 201]).toContain(seedUnread.status);

      const seedLabeled = await api.requestJson("POST", "/api/test-harness/seed-gmail", {
        data: {
          projectId: project.id,
          messageId: `msg-labeled-${cp}`,
          subject: `Facture Deja Classee CP ${cp}`,
          from: "facturation@agencyalpha.fr",
          labels: ["INBOX", "- Factures"],
          attachment: {
            filename: alreadyLabeledPdf.filename,
            mimeType: alreadyLabeledPdf.mimeType,
            contentBase64: alreadyLabeledPdf.buffer.toString("base64"),
          },
        },
      });
      expect([200, 201]).toContain(seedLabeled.status);

      await api.harness.resetCalls();
      const scanRes = await api.scanGmailInvoices(project.id);
      expect(scanRes.status).toBe(200);

      const listRes = await api.listInvoices(project.id);
      expect(listRes.status).toBe(200);
      expect(listRes.data.some((inv) => inv.invoiceNumber === "FAC-GMAIL-001")).toBe(true);
      expect(listRes.data.some((inv) => inv.invoiceNumber === "FAC-GMAIL-OLD")).toBe(false);

      const callsRes = await api.harness.getCalls();
      const normalizedCalls = callsRes.data.map(normalizeGatewayCall);
      const gmailListCall = normalizedCalls.find((c) =>
        /gmail.*listMessages|listMessages/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(gmailListCall).toBeDefined();
      const listMentionsLabelFilter = /-\s*Factures|label/i.test(JSON.stringify(gmailListCall));
      const checkedLabelsOrMessage = normalizedCalls.some((c) =>
        /ensureLabel|listLabels|getMessage/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(
        listMentionsLabelFilter || checkedLabelsOrMessage,
        `Expected listMessages label filter or ensureLabel/listLabels/getMessage in ${JSON.stringify(callsRes.data)}`
      ).toBe(true);
      assertProdUntouched(callsRes.data);
    });

    test("T1-F13-03 Extraction handles ACOMPTE, SOLDE, and UNIQUE invoice types with 2-decimal precision", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F13Types",
      });

      const fixtures = [
        createInvoicePdfFixture({
          codeProjet: cp,
          vendorName: "Vertigo Studio",
          invoiceNumber: "FAC-T-01",
          amountHt: 1250.5,
          invoiceType: "ACOMPTE",
        }),
        createInvoicePdfFixture({
          codeProjet: cp,
          vendorName: "Vertigo Studio",
          invoiceNumber: "FAC-T-02",
          amountHt: 1250.5,
          invoiceType: "SOLDE",
        }),
        createInvoicePdfFixture({
          codeProjet: cp,
          vendorName: "Agency Alpha",
          invoiceNumber: "FAC-T-03",
          amountHt: 880,
          invoiceType: "UNIQUE",
        }),
      ];

      for (const spec of fixtures) {
        const res = await api.uploadInvoicePdf(project.id, {
          name: spec.filename,
          mimeType: spec.mimeType,
          buffer: spec.buffer,
        });
        expect([200, 201]).toContain(res.status);
        expect(res.data.invoiceType).toBe(spec.expected.invoiceType);
        expect(res.data.amountHt).toBeCloseTo(spec.expected.amountHt, 2);
        expect(res.data.tvaAmount).toBeCloseTo(spec.expected.tvaAmount, 2);
        expect(res.data.amountTtc).toBeCloseTo(spec.expected.amountTtc, 2);
      }
    });

    test("T1-F13-04 /budget UI displays pending invoice queue with editable extracted fields & Valider CTA", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F13UiQueue",
      });

      const invoicePdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-UI-2026",
        invoiceDate: "2026-09-09",
        amountHt: 3000,
        invoiceType: "ACOMPTE",
        prestationSummary: "Mapping Fortnite",
      });
      const uploaded = await api.uploadInvoicePdf(project.id, {
        name: invoicePdf.filename,
        mimeType: invoicePdf.mimeType,
        buffer: invoicePdf.buffer,
      });
      expect([200, 201]).toContain(uploaded.status);
      const uploadedId = assertValidId(uploaded.data.id, "uploaded.data.id");
      expect(uploaded.data.invoiceType).toBe("ACOMPTE");

      const listedRes = await api.listInvoices(project.id);
      expect(listedRes.status).toBe(200);
      const persisted = listedRes.data.find((inv) => inv.id === uploadedId);
      expect(persisted?.invoiceType).toBe("ACOMPTE");

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      await expect(page.locator("body")).toContainText(cp);
      await expect(page.getByLabel(/Prestataire/i).first()).toHaveValue("Vertigo Studio");
      await expect(page.getByLabel(/N° Facture/i).first()).toHaveValue("FAC-UI-2026");
      await expect(page.getByLabel(/Montant HT/i).first()).toHaveValue("3000");

      const validateBtn = page.getByRole("button", { name: /^Valider/i }).first();
      await expect(validateBtn).toBeVisible();
    });

    test("T1-F13-05 AuditLog records every invoice ingestion scoped to projectId (F24)", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F13Audit",
      });

      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        invoiceNumber: "FAC-AUD-01",
        amountHt: 1100,
      });
      const uploadRes = await api.uploadInvoicePdf(project.id, {
        name: pdf.filename,
        mimeType: pdf.mimeType,
        buffer: pdf.buffer,
      });
      expect([200, 201]).toContain(uploadRes.status);

      await api.scanGmailInvoices(project.id);

      const auditRes = await api.listAuditLogs(project.id);
      expect(auditRes.status).toBe(200);
      assertAuditLogged(auditRes, {
        projectId: project.id,
        action: /INVOICE|INGEST|UPLOAD/i,
        detailsContain: "FAC-AUD-01",
      });
      assertProdUntouched((await api.harness.getCalls()).data);
    });

    test("T1-F13-06 Repeated Gmail scan does not duplicate already-ingested gmailMessageId invoices", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp } = await createBudgetReadyProject(api, testInfo.workerIndex, {
        suffix: "F13Dedup",
      });

      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        invoiceNumber: "FAC-ONCE-777",
        amountHt: 1450,
      });
      const seeded = await api.requestJson("POST", "/api/test-harness/seed-gmail", {
        data: {
          projectId: project.id,
          messageId: `msg-dedup-${cp}`,
          subject: `Facture Unique CP ${cp}`,
          from: "facturation@vertigostudio.fr",
          labels: ["INBOX"],
          attachment: {
            filename: pdf.filename,
            mimeType: pdf.mimeType,
            contentBase64: pdf.buffer.toString("base64"),
          },
        },
      });
      expect([200, 201]).toContain(seeded.status);

      const firstScan = await api.scanGmailInvoices(project.id);
      expect(firstScan.status).toBe(200);
      const afterFirst = await api.listInvoices(project.id);
      const countFirst = afterFirst.data.filter(
        (inv) => inv.invoiceNumber === "FAC-ONCE-777"
      ).length;
      expect(countFirst).toBe(1);

      const secondScan = await api.scanGmailInvoices(project.id);
      expect(secondScan.status).toBe(200);
      const afterSecond = await api.listInvoices(project.id);
      const countSecond = afterSecond.data.filter(
        (inv) => inv.invoiceNumber === "FAC-ONCE-777"
      ).length;
      expect(countSecond).toBe(1);
      assertProdUntouched((await api.harness.getCalls()).data);
    });
  });

  // ===========================================================================
  // F14 — 1-Click Invoice Validation Pipeline (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F14: 1-Click Invoice Validation Pipeline", () => {
    test("T1-F14-01 1-click validation uploads renamed YYYY-MM-DD_<CP>_<Presta>_<MontantHT>EUR.pdf to sandbox 001.3 Factures", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp, nodes, budgetLines } = await createBudgetReadyProject(
        api,
        testInfo.workerIndex,
        { suffix: "F14Drive0013" }
      );
      const node0013 = findNodeByCode(nodes, "001.3");
      const node0013DriveId = assertValidId(node0013?.driveFileId, "node0013.driveFileId");
      expect(node0013?.isExtEligible).not.toBe(true);

      const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");
      const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");
      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-2026-0142",
        invoiceDate: "2026-09-05",
        amountHt: 3000,
        invoiceType: "ACOMPTE",
        prestationSummary: "Mapping Fortnite",
      });
      const uploaded = await api.uploadInvoicePdf(project.id, {
        name: pdf.filename,
        mimeType: pdf.mimeType,
        buffer: pdf.buffer,
      });
      expect([200, 201]).toContain(uploaded.status);
      const uploadedId = assertValidId(uploaded.data.id, "uploaded.data.id");

      await api.harness.resetCalls();
      const validated = await api.validateInvoice(project.id, uploadedId, {
        budgetLineId: mappingLineId,
      });
      expect(validated.status).toBe(200);

      const expectedName = expectedInvoiceFilename("2026-09-05", cp, "Vertigo Studio", 3000);
      expect(validated.data.renamedFilename).toBe(expectedName);
      expect(String(validated.data.renamedFilename ?? "")).toMatch(INVOICE_FILENAME_REGEX);
      expect(validated.data.driveFileId).toBeTruthy();
      expect(PROD_IMMUTABLE_ID_SET.has(String(validated.data.driveFileId))).toBe(false);

      const callsRes = await api.harness.getCalls();
      const normalizedCalls = callsRes.data.map(normalizeGatewayCall);
      const driveUpload = normalizedCalls.find((c) => {
        const op = String(c.operation ?? c.method ?? "");
        const name = String(c.name ?? c.filename ?? "");
        return /upload|create/i.test(op) && name.includes(expectedName);
      });
      expect(driveUpload, `Expected Drive upload to 001.3 in ${JSON.stringify(callsRes.data)}`).toBeDefined();
      expect(driveUpload?.parentId).toBe(node0013DriveId);
      assertProdUntouched(callsRes.data);
    });

    test("T1-F14-02 1-click validation updates Coûts réels post-opération in DB + Google Sheet & writes cell note via batchUpdate", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp, budgetLines } = await createBudgetReadyProject(
        api,
        testInfo.workerIndex,
        { suffix: "F14SheetNote" }
      );
      const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");
      const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");

      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-2026-0142",
        invoiceDate: "2026-09-05",
        amountHt: 3000,
        invoiceType: "ACOMPTE",
        prestationSummary: "Mapping Fortnite",
      });
      const uploaded = await api.uploadInvoicePdf(project.id, {
        name: pdf.filename,
        mimeType: pdf.mimeType,
        buffer: pdf.buffer,
      });
      expect([200, 201]).toContain(uploaded.status);
      const uploadedId = assertValidId(uploaded.data.id, "uploaded.data.id");

      await api.harness.resetCalls();
      const validated = await api.validateInvoice(project.id, uploadedId, {
        budgetLineId: mappingLineId,
      });
      expect(validated.status).toBe(200);

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      const updatedMapping = findBudgetLineByObjet(budgetAfter.lines, "Mapping & HUD Fortnite");
      expect(updatedMapping?.postOpTotalHt).toBe(3000);
      expect(String(updatedMapping?.invoiceNumbersNote ?? "")).toContain("FAC-2026-0142");

      const callsRes = await api.harness.getCalls();
      const sheetValueWrite = callsRes.data.find((c) => {
        const op = String(c.operation ?? c.method ?? "");
        return /sheets.*update|updateValues/i.test(op);
      });
      expect(sheetValueWrite, `Expected Sheets values update in ${JSON.stringify(callsRes.data)}`).toBeDefined();

      const cellNoteCall = callsRes.data.find((c) => {
        const op = String(c.operation ?? c.method ?? "");
        return /updateCellNote|batchUpdate/i.test(op) && JSON.stringify(c).includes("FAC-2026-0142");
      });
      expect(cellNoteCall, `Expected Sheets updateCellNote/batchUpdate with FAC-2026-0142`).toBeDefined();
      assertProdUntouched(callsRes.data);
    });

    test("T1-F14-03 Multi-invoice accumulation (Acompte 50% + Solde 50%) sums Post-op HT and appends both numbers in cell note", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp, budgetLines } = await createBudgetReadyProject(
        api,
        testInfo.workerIndex,
        { suffix: "F14Cumul" }
      );
      const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");
      const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");

      const acomptePdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-2026-0142",
        invoiceDate: "2026-09-05",
        amountHt: 3000,
        invoiceType: "ACOMPTE",
        prestationSummary: "Mapping Fortnite Acompte",
      });
      const soldePdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-2026-0198",
        invoiceDate: "2026-09-25",
        amountHt: 3000,
        invoiceType: "SOLDE",
        prestationSummary: "Mapping Fortnite Solde",
      });

      const up1 = await api.uploadInvoicePdf(project.id, {
        name: acomptePdf.filename,
        mimeType: acomptePdf.mimeType,
        buffer: acomptePdf.buffer,
      });
      expect([200, 201]).toContain(up1.status);
      const up1Id = assertValidId(up1.data.id, "up1.data.id");
      const val1 = await api.validateInvoice(project.id, up1Id, {
        budgetLineId: mappingLineId,
      });
      expect(val1.status).toBe(200);

      await api.harness.resetCalls();
      const up2 = await api.uploadInvoicePdf(project.id, {
        name: soldePdf.filename,
        mimeType: soldePdf.mimeType,
        buffer: soldePdf.buffer,
      });
      expect([200, 201]).toContain(up2.status);
      const up2Id = assertValidId(up2.data.id, "up2.data.id");
      const val2 = await api.validateInvoice(project.id, up2Id, {
        budgetLineId: mappingLineId,
      });
      expect(val2.status).toBe(200);

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      const updatedMapping = findBudgetLineByObjet(budgetAfter.lines, "Mapping & HUD Fortnite");
      expect(updatedMapping?.postOpTotalHt).toBe(6000);

      const note = String(updatedMapping?.invoiceNumbersNote ?? "");
      expect(note).toContain("FAC-2026-0142");
      expect(note).toContain("FAC-2026-0198");

      const crit100 = budgetAfter.alerts.find(
        (a) =>
          String(a.objet ?? "").includes("Mapping & HUD Fortnite") &&
          String(a.level ?? "").toUpperCase().includes("CRIT")
      );
      expect(crit100).toBeDefined();

      const callsRes = await api.harness.getCalls();
      const noteCall = callsRes.data.find((c) => {
        const serialized = JSON.stringify(c);
        return (
          /updateCellNote|batchUpdate/i.test(String(c.operation ?? c.method ?? "")) &&
          serialized.includes("FAC-2026-0142") &&
          serialized.includes("FAC-2026-0198")
        );
      });
      expect(noteCall, "Expected cumulative cell note containing both invoice numbers").toBeDefined();
      assertProdUntouched(callsRes.data);
    });

    test("T1-F14-04 1-click validation creates Pennylane Gmail Draft (never auto-sent) with exact To, CC, Subject, and attachment", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp, budgetLines } = await createBudgetReadyProject(
        api,
        testInfo.workerIndex,
        { suffix: "F14Pennylane" }
      );
      const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");
      const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");

      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-2026-0142",
        invoiceDate: "2026-09-05",
        amountHt: 3000,
        invoiceType: "ACOMPTE",
        prestationSummary: "Mapping Fortnite",
      });
      const uploaded = await api.uploadInvoicePdf(project.id, {
        name: pdf.filename,
        mimeType: pdf.mimeType,
        buffer: pdf.buffer,
      });
      expect([200, 201]).toContain(uploaded.status);
      const uploadedId = assertValidId(uploaded.data.id, "uploaded.data.id");

      await api.harness.resetCalls();
      const validated = await api.validateInvoice(project.id, uploadedId, {
        budgetLineId: mappingLineId,
        prestationSummary: "Mapping Fortnite",
      });
      expect(validated.status).toBe(200);
      expect(validated.data.pennylaneDraftId).toBeTruthy();

      const rawObj = asRecord(validated.raw);
      const draftObj = asRecord(rawObj.pennylaneDraft ?? rawObj.draft);
      if (Object.keys(draftObj).length > 0) {
        assertStrictPennylaneDraft(draftObj, {
          cp,
          presta: "Vertigo Studio",
          expectedRenamedFilename: pdf.expected.expectedRenamedFilename,
        });
      }

      const callsRes = await api.harness.getCalls();
      const sendCalls = callsRes.data.filter((c) =>
        /messages\.send|sendMessage/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(sendCalls, "Draft-First violation: messages.send must NEVER be called").toEqual([]);

      const draftCall = callsRes.data.find((c) =>
        /createDraft|drafts\.create/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(draftCall, `Expected Gmail createDraft call in ${JSON.stringify(callsRes.data)}`).toBeDefined();
      if (draftCall) {
        const normalizedDraftCall = {
          ...asRecord(draftCall.args),
          ...asRecord(draftCall.payload),
          ...draftCall,
        };
        assertStrictPennylaneDraft(normalizedDraftCall, {
          cp,
          presta: "Vertigo Studio",
          expectedRenamedFilename: pdf.expected.expectedRenamedFilename,
        });
        expect(String(normalizedDraftCall.subject ?? "")).toBe(
          expectedPennylaneSubject("Vertigo Studio", "Mapping Fortnite", cp)
        );
      }
      assertProdUntouched(callsRes.data);
    });

    test("T1-F14-05 User edits extracted amountHt and budget line in /budget UI before clicking Valider", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp, budgetLines } = await createBudgetReadyProject(
        api,
        testInfo.workerIndex,
        { suffix: "F14UiEdit" }
      );
      const mappingLine = findBudgetLineByObjet(budgetLines, "Mapping & HUD Fortnite");
      const mappingLineId = assertValidId(mappingLine?.id, "mappingLine.id");

      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Vertigo Studio",
        invoiceNumber: "FAC-UI-EDIT-01",
        invoiceDate: "2026-09-14",
        amountHt: 3000,
        invoiceType: "UNIQUE",
        prestationSummary: "Mapping initial",
      });
      const uploaded = await api.uploadInvoicePdf(
        project.id,
        {
          name: pdf.filename,
          mimeType: pdf.mimeType,
          buffer: pdf.buffer,
        },
        { budgetLineId: mappingLineId }
      );
      expect([200, 201]).toContain(uploaded.status);
      assertValidId(uploaded.data.id, "uploaded.data.id");

      await page.goto(`${BASE_URL}/budget?projectId=${project.id}`);
      const amountInput = page.getByLabel(/Montant HT/i).first();
      await expect(amountInput).toBeVisible();
      await amountInput.fill("3250");

      const lineSelect = page.getByLabel(/Ligne budg[ée]taire|Poste/i).first();
      if ((await lineSelect.count()) > 0) {
        const tagName = await lineSelect.evaluate((el) => el.tagName.toLowerCase());
        if (tagName === "select") {
          await lineSelect.selectOption(mappingLineId);
        }
      }

      const validateBtn = page.getByRole("button", { name: /^Valider/i }).first();
      await validateBtn.click();

      await expect(page.locator("body")).toContainText(/VALIDATED|Valid[ée]e|3250EUR\.pdf/i);

      const listRes = await api.listInvoices(project.id);
      const validatedInv = listRes.data.find((i) => i.id === uploaded.data.id);
      expect(validatedInv?.status).toBe("VALIDATED");
      expect(validatedInv?.amountHt).toBe(3250);
      expect(validatedInv?.renamedFilename).toBe(
        expectedInvoiceFilename("2026-09-14", cp, "Vertigo Studio", 3250)
      );

      const budgetAfter = extractBudgetEnvelope((await api.getBudget(project.id)).raw);
      const updatedLine = findBudgetLineByObjet(budgetAfter.lines, "Mapping & HUD Fortnite");
      expect(updatedLine?.postOpTotalHt).toBe(3250);

      assertProdUntouched((await api.harness.getCalls()).data);
    });

    test("T1-F14-06 1-click validation marks status VALIDATED, all 3 step flags true, logs AuditLog, and leaves PROD untouched", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, cp, budgetLines } = await createBudgetReadyProject(
        api,
        testInfo.workerIndex,
        { suffix: "F14Flags" }
      );
      const daLine = findBudgetLineByObjet(budgetLines, "DA / Charte graphique");
      const daLineId = assertValidId(daLine?.id, "daLine.id");

      const pdf = createInvoicePdfFixture({
        codeProjet: cp,
        vendorName: "Agency Alpha",
        invoiceNumber: "FAC-2026-0300",
        invoiceDate: "2026-09-16",
        amountHt: 880,
        invoiceType: "UNIQUE",
        prestationSummary: "DA Charte Graphique",
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
      });
      expect(validated.status).toBe(200);
      expect(validated.data.status).toBe("VALIDATED");
      expect(validated.data.stepDriveDone).toBe(true);
      expect(validated.data.stepSheetDone).toBe(true);
      expect(validated.data.stepGmailDone).toBe(true);
      expect(validated.data.driveFileId).toBeTruthy();
      expect(validated.data.pennylaneDraftId).toBeTruthy();

      const expectedFilename = expectedInvoiceFilename("2026-09-16", cp, "Agency Alpha", 880);
      expect(validated.data.renamedFilename).toBe(expectedFilename);
      const escapedFilename = expectedFilename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const auditRes = await api.listAuditLogs(project.id);
      assertAuditLogged(auditRes, {
        projectId: project.id,
        action: /VALIDATE/i,
        targetId: uploadedId,
        detailsContain: new RegExp(`FAC-2026-0300|${escapedFilename}`),
      });

      assertProdUntouched((await api.harness.getCalls()).data);
      assertProdUntouched(auditRes.data);
    });
  });
});
