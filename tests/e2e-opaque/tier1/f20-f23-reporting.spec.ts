/**
 * Tier 1 — Isolated Happy-Path Opaque-Box E2E Tests (F20–F23: Reporting)
 * Target count: 24 tests (6 per feature across F20, F21, F22, F23).
 * Exercises /reporting UI and /api/projects/[id]/reporting/* HTTP contracts
 * under TEST_BOUNDARY_HARNESS=1. Zero imports from src/ or prisma/.
 */

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  createApiClient,
  type ApiClient,
  type DriveNodeDto,
  type ProjectDto,
} from "../helpers/api-client";
import {
  assertAuditLogged,
  assertProdUntouched,
  assertValidXlsxBuffer,
} from "../helpers/assertions";
import {
  BASE_URL,
  INFLUENCE_PLATFORM_FOLDER_LABELS,
  INFLUENCE_PLATFORMS,
  PILOT_PROJECT,
  PROD_IDS,
  REPORTING_SLIDES_DIMENSIONS_EMU,
  REPORTING_TABS,
  uniqueTestCp,
} from "../helpers/constants";
import {
  computeExpectedInfluenceTotals,
  EXPECTED_FORTNITE_SUMMARY,
  EXPECTED_REPORTING_SLIDES_PATTERN,
  EXPECTED_REPORTING_TABS,
  FORTNITE_CREATOR_CSV_BUFFER,
  FORTNITE_CREATOR_ROWS,
  FORTNITE_CREATOR_XLSX_BUFFER,
  PILOT_INFLUENCE_SCREENSHOTS,
  PILOT_VERBATIMS,
  SCREENSHOT_MISSING_SHARES_YTSHORTS,
  SNAPSHOT_MISSING_SAVES_SNAPCHAT,
} from "../fixtures/reporting-data";
import { inspectXlsxWorkbook } from "../fixtures/budget-xlsx";

const PILOT_BRAND_KIT = {
  client: PILOT_PROJECT.client,
  primaryColor: "#0055A4",
  accentColor: "#E4002B",
  secondaryColor: "#0F172A",
  fontFamily: "Montserrat",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function findNodeByCode(nodes: DriveNodeDto[], code: string): DriveNodeDto | undefined {
  return nodes.find((n) => n.code === code || n.name.startsWith(code));
}

function findReportingSlidesNode(nodes: DriveNodeDto[], slidesFileId?: string): DriveNodeDto | undefined {
  if (slidesFileId) {
    const byFileId = nodes.find((n) => n.driveFileId === slidesFileId);
    if (byFileId) return byFileId;
  }
  return (
    nodes.find((n) => n.code === "006.3.slides") ??
    nodes.find((n) => n.code.startsWith("006.3") && n.isFolder === false) ??
    nodes.find((n) => n.code === "006.3")
  );
}

function extractFortniteData(payload: unknown): {
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
  rawFile: Record<string, unknown> | undefined;
} {
  const obj = isRecord(payload) ? payload : {};
  const rows = toRecordArray(obj.rows ?? obj.metrics ?? obj.items ?? obj.fortniteMetrics);
  const summary = isRecord(obj.summary)
    ? obj.summary
    : isRecord(obj.kpis)
      ? obj.kpis
      : obj;
  const rawFile = isRecord(obj.rawFile)
    ? obj.rawFile
    : Array.isArray(obj.rawFiles) && isRecord(obj.rawFiles[0])
      ? obj.rawFiles[0]
      : undefined;
  return { rows, summary, rawFile };
}

function extractInfluenceList(payload: unknown): {
  metrics: Record<string, unknown>[];
  rawFiles: Record<string, unknown>[];
} {
  if (Array.isArray(payload)) {
    return { metrics: toRecordArray(payload), rawFiles: [] };
  }
  const obj = isRecord(payload) ? payload : {};
  const metrics = toRecordArray(obj.metrics ?? obj.items ?? obj.influenceMetrics ?? obj.data);
  const rawFiles = toRecordArray(obj.rawFiles);
  return { metrics, rawFiles };
}

function extractSingleMetric(data: unknown, raw?: unknown): {
  metric: Record<string, unknown>;
  rawFile: Record<string, unknown> | undefined;
} {
  const dataObj = isRecord(data) ? data : {};
  const rawObj = isRecord(raw) ? raw : {};
  const metric = isRecord(dataObj.metric) ? dataObj.metric : dataObj;
  const rawFile = isRecord(dataObj.rawFile)
    ? dataObj.rawFile
    : isRecord(rawObj.rawFile)
      ? rawObj.rawFile
      : undefined;
  return { metric, rawFile };
}

function flattenSheetText(rows: string[][]): string {
  return rows.map((row) => row.join(" | ")).join("\n");
}

function findMatchingNumberInRows(rows: string[][], target: number): boolean {
  const plain = String(target);
  const escapedPlain = plain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundaryRegex = new RegExp(`(?:^|[^\\d.,-])${escapedPlain}(?:$|[^\\d.,-])`);

  for (const row of rows) {
    for (const cell of row) {
      const trimmed = cell.trim();
      if (trimmed === "" || /^\d{4}-\d{2}-\d{2}/.test(trimmed) || trimmed.startsWith("=")) {
        continue;
      }

      const noSpaces = trimmed.replace(/[\u00a0\u202f\s]/g, "");
      if (noSpaces === plain) {
        return true;
      }

      const strippedThousands = noSpaces.replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1");
      if (boundaryRegex.test(strippedThousands)) {
        return true;
      }

      const cleanNumStr = strippedThousands.replace(/%$/, "").replace(/,/g, ".");
      if (/^-?\d+(\.\d+)?$/.test(cleanNumStr)) {
        const parsed = Number(cleanNumStr);
        if (Number.isFinite(parsed) && Math.abs(parsed - target) < 0.01) {
          return true;
        }
      }
    }
  }
  return false;
}

function assertReportingSlidesStructure(
  slidesResponse: Record<string, unknown>,
  expected: {
    talents: readonly string[];
    includedVerbatimHandles: readonly string[];
    excludedVerbatimHandles: readonly string[];
  }
): void {
  const serialized = JSON.stringify(slidesResponse);

  const dims = isRecord(slidesResponse.dimensionsEmu)
    ? slidesResponse.dimensionsEmu
    : isRecord(slidesResponse.dimensions)
      ? slidesResponse.dimensions
      : undefined;
  if (dims) {
    expect(Number(dims.width)).toBe(REPORTING_SLIDES_DIMENSIONS_EMU.width);
    expect(Number(dims.height)).toBe(REPORTING_SLIDES_DIMENSIONS_EMU.height);
  }

  expect(serialized).not.toMatch(/\{\{[^}]+\}\}/);

  const slidesArray = toRecordArray(
    slidesResponse.slides ?? slidesResponse.slidesSummary ?? slidesResponse.pages
  );
  const slideCorpus =
    slidesArray.length > 0
      ? slidesArray
          .map((s) => `${String(s.title ?? "")} ${String(s.type ?? "")} ${JSON.stringify(s)}`)
          .join("\n")
      : serialized;

  const requiredSections: ReadonlyArray<{ label: string; regex: RegExp }> = [
    { label: "Couverture", regex: /Couverture|Cover/i },
    { label: "Temps forts", regex: /Temps forts/i },
    { label: "Chronologie", regex: /Chronologie/i },
    { label: "Expérience", regex: /Expérience/i },
    { label: "Chiffres Fortnite", regex: /Chiffres.*Fortnite|Fortnite/i },
    { label: "Chiffres cumulés", regex: /Chiffres cumulés/i },
    { label: "Ce que la communauté en dit", regex: /Ce que la communauté en dit/i },
  ];
  for (const section of requiredSections) {
    expect(slideCorpus, `Missing required slide section: ${section.label}`).toMatch(section.regex);
  }

  const matchedSlideIndices = new Set<number>();
  for (const talent of expected.talents) {
    if (slidesArray.length > 0) {
      const talentSlideIdx = slidesArray.findIndex((s, idx) => {
        if (matchedSlideIndices.has(idx)) return false;
        const title = String(s.title ?? "");
        const headerScope = `${title} ${String(s.type ?? "")}`;
        const sText = `${headerScope} ${JSON.stringify(s)}`;
        return (
          !/Chiffres cumul[ée]s|CUMULATIVE/i.test(headerScope) &&
          new RegExp(talent, "i").test(sText) &&
          /vues/i.test(sText) &&
          /likes/i.test(sText) &&
          /interactions/i.test(sText)
        );
      });
      expect(
        talentSlideIdx,
        `Missing dedicated individual talent slide for ${talent} with vues/likes/interactions`
      ).toBeGreaterThanOrEqual(0);
      matchedSlideIndices.add(talentSlideIdx);
    } else {
      expect(slideCorpus, `Missing individual talent slide for ${talent}`).toMatch(
        new RegExp(talent, "i")
      );
    }
  }
  if (slidesArray.length > 0) {
    expect(matchedSlideIndices.size).toBe(expected.talents.length);
  }

  expect(slideCorpus).toMatch(/vues/i);
  expect(slideCorpus).toMatch(/likes/i);
  expect(slideCorpus).toMatch(/interactions/i);
  for (const label of INFLUENCE_PLATFORM_FOLDER_LABELS) {
    const shortLabel = label === "YouTube Shorts" ? "YouTube" : label;
    expect(slideCorpus, `Missing network breakdown ${shortLabel}`).toMatch(
      new RegExp(shortLabel, "i")
    );
  }

  for (const handle of expected.includedVerbatimHandles) {
    expect(slideCorpus, `Expected selected verbatim ${handle} in slides`).toContain(handle);
  }
  for (const excluded of expected.excludedVerbatimHandles) {
    expect(slideCorpus, `Excluded verbatim ${excluded} must not appear in slides`).not.toContain(
      excluded
    );
  }

  if (slidesArray.length > 0) {
    expect(slidesArray.length).toBeGreaterThanOrEqual(
      EXPECTED_REPORTING_SLIDES_PATTERN.length - 1 + expected.talents.length
    );
  }
}

async function createProvisionedReportingProject(
  api: ApiClient,
  workerIndex: number,
  suffix = "Rep",
  talents: readonly string[] = []
): Promise<{ project: ProjectDto; nodes: DriveNodeDto[] }> {
  const cp = uniqueTestCp(workerIndex);
  const created = await api.createProject({
    codeProjet: cp,
    client: `Client ${suffix} ${cp}`,
    nomJeu: `Fortnite ${suffix}`,
    isSandbox: true,
    brandKit: PILOT_BRAND_KIT,
  });
  expect(created.status, `Failed creating project ${cp}: ${JSON.stringify(created.raw)}`).toBe(201);
  const project = created.data;

  const provisioned = await api.provisionDriveTree(project.id);
  expect([200, 201]).toContain(provisioned.status);

  for (const talentName of talents) {
    const talRes = await api.addTalent(project.id, { talentName });
    expect([200, 201]).toContain(talRes.status);
  }

  const treeRes = await api.getDriveTree(project.id);
  expect(treeRes.status).toBe(200);
  return { project, nodes: treeRes.data };
}

async function seedFullPilotReportingDataset(
  api: ApiClient,
  projectId: string,
  options: { verifyAll?: boolean } = {}
): Promise<{ metricIds: string[] }> {
  const fRes = await api.uploadFortniteReport(projectId, {
    name: "fortnite_creator_portal.csv",
    mimeType: "text/csv",
    buffer: FORTNITE_CREATOR_CSV_BUFFER,
  });
  expect([200, 201]).toContain(fRes.status);

  const metricIds: string[] = [];
  for (const shot of PILOT_INFLUENCE_SCREENSHOTS) {
    const infRes = await api.uploadInfluenceScreenshot(
      projectId,
      {
        name: shot.filename,
        mimeType: shot.mimeType,
        buffer: shot.buffer,
      },
      {
        talentName: shot.talentName,
        platform: shot.platform,
        contentUrl: shot.contentUrl,
        sparkCode: shot.sparkCode,
      }
    );
    expect([200, 201]).toContain(infRes.status);
    const { metric } = extractSingleMetric(infRes.data, infRes.raw);
    const metricId = String(metric.id ?? "");
    expect(metricId).toBeTruthy();
    metricIds.push(metricId);

    if (options.verifyAll !== false) {
      const patchRes = await api.updateInfluenceMetric(projectId, metricId, {
        views: shot.expectedMetrics.views,
        likes: shot.expectedMetrics.likes,
        comments: shot.expectedMetrics.comments,
        shares: shot.expectedMetrics.shares,
        reposts: shot.expectedMetrics.reposts,
        saves: shot.expectedMetrics.saves,
        verifiedByHuman: true,
      });
      expect(patchRes.status).toBe(200);
    }
  }

  for (const v of PILOT_VERBATIMS) {
    const vRes = await api.createVerbatim(projectId, v);
    expect([200, 201]).toContain(vRes.status);
  }

  return { metricIds };
}

async function attachErrorTracking(page: Page): Promise<{
  pageErrors: string[];
  consoleErrors: string[];
  serverErrors: string[];
}> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("response", (res) => {
    if (res.status() >= 500) {
      serverErrors.push(`${res.status()} ${res.url()}`);
    }
  });
  return { pageErrors, consoleErrors, serverErrors };
}

test.describe("Tier 1 — Connected Reporting Tests (F20–F23)", () => {
  test.beforeEach(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.restoreConfigured();
  });

  // ===========================================================================
  // F20 — Fortnite Creator Portal CSV/Excel Ingestion (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F20: Fortnite Creator Portal CSV/Excel Ingestion", () => {
    test("T1-F20-01 CSV upload ingests 4 Fortnite days into 006.1.1 with AuditLog and zero PROD mutations", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project, nodes } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F20Csv"
      );
      await api.harness.resetCalls();

      const res = await api.uploadFortniteReport(project.id, {
        name: "fortnite_creator_portal_2026_09.csv",
        mimeType: "text/csv",
        buffer: FORTNITE_CREATOR_CSV_BUFFER,
      });
      expect([200, 201]).toContain(res.status);

      const { rows, summary, rawFile } = extractFortniteData(res.data);
      expect(rows.length).toBe(FORTNITE_CREATOR_ROWS.length);
      expect(Number(summary.totalUniquePlayers)).toBe(EXPECTED_FORTNITE_SUMMARY.totalUniquePlayers);

      const folder00611 = findNodeByCode(nodes, "006.1.1");
      expect(folder00611?.name).toContain("01_Fortnite_Creator_Portal");
      if (rawFile) {
        expect(rawFile.driveFileId).toBeTruthy();
        expect(rawFile.processed).toBe(true);
      }

      const treeAfter = await api.getDriveTree(project.id);
      expect(treeAfter.status).toBe(200);
      assertProdUntouched(treeAfter.data);

      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit, {
        action: /FORTNITE|REPORTING/i,
        projectId: project.id,
      });

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);

      if (!rawFile) {
        const uploadedInTree = treeAfter.data.some(
          (n) =>
            n.isFolder === false &&
            (n.code.startsWith("006.1.1") ||
              n.parentNodeId === folder00611?.id ||
              /fortnite/i.test(n.name))
        );
        const uploadedInCalls = calls.data.some(
          (c) =>
            /create|upload/i.test(String(c.operation ?? c.method ?? "")) &&
            (!folder00611?.driveFileId ||
              String(c.parentId ?? c.destinationParentId ?? JSON.stringify(c)).includes(
                folder00611.driveFileId
              ))
        );
        expect(
          uploadedInTree || uploadedInCalls,
          "Expected Fortnite upload targeting 006.1.1 in DriveTree or Gateway calls"
        ).toBe(true);
      }
    });

    test("T1-F20-02 XLSX upload parses Creator Portal columns and computes exact Fortnite KPIs", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F20Xlsx"
      );

      const res = await api.uploadFortniteReport(project.id, {
        name: "fortnite_creator_portal_2026_09.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: FORTNITE_CREATOR_XLSX_BUFFER,
      });
      expect([200, 201]).toContain(res.status);

      const { rows, summary } = extractFortniteData(res.data);
      expect(rows.length).toBe(4);
      expect(Number(summary.totalUniquePlayers)).toBe(EXPECTED_FORTNITE_SUMMARY.totalUniquePlayers);
      expect(Number(summary.totalSessions)).toBe(EXPECTED_FORTNITE_SUMMARY.totalSessions);
      expect(Number(summary.avgPlaytimeSec)).toBeCloseTo(
        EXPECTED_FORTNITE_SUMMARY.avgPlaytimeSec,
        1
      );
      expect(Number(summary.avgRetentionD1)).toBeCloseTo(
        EXPECTED_FORTNITE_SUMMARY.avgRetentionD1,
        1
      );
      expect(Number(summary.maxPeakConcurrent)).toBe(EXPECTED_FORTNITE_SUMMARY.maxPeakConcurrent);
    });

    test("T1-F20-03 GET /reporting/fortnite persists daily metrics and summary across requests", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F20Persist"
      );

      const upload = await api.uploadFortniteReport(project.id, {
        name: "fortnite_persist.csv",
        mimeType: "text/csv",
        buffer: FORTNITE_CREATOR_CSV_BUFFER,
      });
      expect([200, 201]).toContain(upload.status);

      const fetched = await api.getFortniteReporting(project.id);
      expect(fetched.status).toBe(200);

      const { rows, summary } = extractFortniteData(fetched.data);
      expect(rows.length).toBe(4);
      const serializedRows = JSON.stringify(rows);
      for (const expectedRow of FORTNITE_CREATOR_ROWS) {
        expect(serializedRows).toContain(expectedRow.date);
      }
      expect(Number(summary.totalUniquePlayers)).toBe(53500);
      expect(Number(summary.totalSessions)).toBe(79000);
      expect(Number(summary.avgPlaytimeSec)).toBeCloseTo(1200, 1);
      expect(Number(summary.avgRetentionD1)).toBeCloseTo(25.1, 1);
      expect(Number(summary.maxPeakConcurrent)).toBe(1340);
    });

    test("T1-F20-04 /reporting UI uploads Fortnite CSV and displays persisted KPI cards across reload", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F20Ui"
      );

      const errors = await attachErrorTracking(page);
      const navRes = await page.goto(`${BASE_URL}/reporting?projectId=${project.id}`);
      expect(navRes?.status()).toBe(200);

      const csvInput = page
        .locator(
          'input[type="file"][data-testid*="fortnite"], input[type="file"][accept*=".csv"], input[type="file"][accept*="csv"]'
        )
        .first();
      await expect(csvInput).toBeAttached();
      await csvInput.setInputFiles({
        name: "fortnite_ui_upload.csv",
        mimeType: "text/csv",
        buffer: FORTNITE_CREATOR_CSV_BUFFER,
      });

      const submitBtn = page
        .locator("button")
        .filter({ hasText: /Importer.*Fortnite|Charger.*CSV|Importer le fichier|Importer CSV/i })
        .first();
      if (
        (await submitBtn.isVisible().catch(() => false)) &&
        (await submitBtn.isEnabled().catch(() => false))
      ) {
        await submitBtn.click();
      }

      await expect(page.locator("body")).toContainText(/53[\s\u00a0\u202f,.]?500/);
      await expect(page.locator("body")).toContainText(/79[\s\u00a0\u202f,.]?000/);
      await expect(page.locator("body")).toContainText(/25[.,]1/);
      await expect(page.locator("body")).toContainText(/1[\s\u00a0\u202f,.]?340/);

      await page.reload();
      await expect(page.locator("body")).toContainText(/53[\s\u00a0\u202f,.]?500/);
      await expect(page.locator("body")).toContainText(/1[\s\u00a0\u202f,.]?340/);
      expect(errors.pageErrors).toEqual([]);
      expect(errors.consoleErrors).toEqual([]);
      expect(errors.serverErrors).toEqual([]);
    });

    test("T1-F20-05 Multi-project isolation scopes Fortnite metrics strictly by projectId", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project: projectA } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F20ScopeA"
      );
      const { project: projectB } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex + 20,
        "F20ScopeB"
      );

      const upA = await api.uploadFortniteReport(projectA.id, {
        name: "fortnite_proj_a.csv",
        mimeType: "text/csv",
        buffer: FORTNITE_CREATOR_CSV_BUFFER,
      });
      expect([200, 201]).toContain(upA.status);

      const getA = await api.getFortniteReporting(projectA.id);
      const getB = await api.getFortniteReporting(projectB.id);
      expect(getA.status).toBe(200);
      expect(getB.status).toBe(200);

      const dataA = extractFortniteData(getA.data);
      const dataB = extractFortniteData(getB.data);
      expect(dataA.rows.length).toBe(4);
      expect(Number(dataA.summary.totalUniquePlayers)).toBe(53500);
      expect(dataB.rows.length).toBe(0);
      expect(Number(dataB.summary.totalUniquePlayers ?? 0)).toBe(0);
    });

    test("T1-F20-06 Incremental Fortnite upload appends new day and updates maxPeakConcurrent", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F20Incr"
      );

      const first = await api.uploadFortniteReport(project.id, {
        name: "fortnite_batch_1.csv",
        mimeType: "text/csv",
        buffer: FORTNITE_CREATOR_CSV_BUFFER,
      });
      expect([200, 201]).toContain(first.status);

      const extraDayCsv = Buffer.from(
        "date,unique_players,sessions,avg_playtime_sec,retention_d1,peak_concurrent\n2026-09-05,16500,24000,1380,28.0,2100\n",
        "utf8"
      );
      const second = await api.uploadFortniteReport(project.id, {
        name: "fortnite_batch_2.csv",
        mimeType: "text/csv",
        buffer: extraDayCsv,
      });
      expect([200, 201]).toContain(second.status);

      const after = await api.getFortniteReporting(project.id);
      expect(after.status).toBe(200);
      const { rows, summary } = extractFortniteData(after.data);
      expect(rows.length).toBe(5);
      expect(Number(summary.totalUniquePlayers)).toBe(53500 + 16500);
      expect(Number(summary.maxPeakConcurrent)).toBe(2100);
      expect(JSON.stringify(rows)).toContain("2026-09-01");
      expect(JSON.stringify(rows)).toContain("2026-09-05");
    });
  });

  // ===========================================================================
  // F21 — Influence WhatsApp Screenshot Gemini Vision + Control UI (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F21: Influence WhatsApp Screenshot Gemini Vision & Verification", () => {
    test("T1-F21-01 4-platform WhatsApp PNG upload extracts Vision metrics into 006.1.2 with verifiedByHuman=false", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21Vision4",
        PILOT_PROJECT.talents
      );
      await api.harness.resetCalls();

      for (const shot of PILOT_INFLUENCE_SCREENSHOTS) {
        const res = await api.uploadInfluenceScreenshot(
          project.id,
          {
            name: shot.filename,
            mimeType: shot.mimeType,
            buffer: shot.buffer,
          },
          {
            talentName: shot.talentName,
            platform: shot.platform,
            contentUrl: shot.contentUrl,
            sparkCode: shot.sparkCode,
          }
        );
        expect([200, 201]).toContain(res.status);

        const { metric } = extractSingleMetric(res.data, res.raw);
        expect(metric.talentName).toBe(shot.talentName);
        expect(metric.platform).toBe(shot.platform);
        expect(metric.verifiedByHuman).toBe(false);
        expect(Number(metric.views)).toBe(shot.expectedMetrics.views);
        expect(Number(metric.likes)).toBe(shot.expectedMetrics.likes);
        expect(Number(metric.comments)).toBe(shot.expectedMetrics.comments);
        expect(Number(metric.engagementRate)).toBeCloseTo(
          shot.expectedMetrics.engagementRate,
          2
        );
      }

      const listed = await api.getInfluenceReporting(project.id);
      expect(listed.status).toBe(200);
      const { metrics } = extractInfluenceList(listed.data);
      expect(metrics.length).toBe(4);

      const tree = await api.getDriveTree(project.id);
      assertProdUntouched(tree.data);

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);
    });

    test("T1-F21-02 Missing optional platform metrics (YT Shorts no shares, Snapchat no saves) compute Engagement % accurately", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21MissingOpt",
        ["Aksianka", "Wig"]
      );

      const ytRes = await api.uploadInfluenceScreenshot(
        project.id,
        {
          name: SCREENSHOT_MISSING_SHARES_YTSHORTS.filename,
          mimeType: SCREENSHOT_MISSING_SHARES_YTSHORTS.mimeType,
          buffer: SCREENSHOT_MISSING_SHARES_YTSHORTS.buffer,
        },
        {
          talentName: SCREENSHOT_MISSING_SHARES_YTSHORTS.talentName,
          platform: SCREENSHOT_MISSING_SHARES_YTSHORTS.platform,
        }
      );
      expect([200, 201]).toContain(ytRes.status);
      const ytMetric = extractSingleMetric(ytRes.data, ytRes.raw).metric;
      expect(ytMetric.shares ?? null).toBeNull();
      expect(ytMetric.reposts ?? null).toBeNull();
      expect(ytMetric.saves ?? null).toBeNull();
      expect(Number(ytMetric.engagementRate)).toBeCloseTo(7.05, 2);

      const snapRes = await api.uploadInfluenceScreenshot(
        project.id,
        {
          name: SNAPSHOT_MISSING_SAVES_SNAPCHAT.filename,
          mimeType: SNAPSHOT_MISSING_SAVES_SNAPCHAT.mimeType,
          buffer: SNAPSHOT_MISSING_SAVES_SNAPCHAT.buffer,
        },
        {
          talentName: SNAPSHOT_MISSING_SAVES_SNAPCHAT.talentName,
          platform: SNAPSHOT_MISSING_SAVES_SNAPCHAT.platform,
        }
      );
      expect([200, 201]).toContain(snapRes.status);
      const snapMetric = extractSingleMetric(snapRes.data, snapRes.raw).metric;
      expect(snapMetric.reposts ?? null).toBeNull();
      expect(snapMetric.saves ?? null).toBeNull();
      expect(Number(snapMetric.shares)).toBe(310);
      expect(Number(snapMetric.engagementRate)).toBeCloseTo(5.99, 2);
    });

    test("T1-F21-03 PATCH /reporting/influence/:metricId saves human edits, recalculates engagementRate, and sets verifiedByHuman=true", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21Patch",
        ["Kalut"]
      );
      const kalut = PILOT_INFLUENCE_SCREENSHOTS[0];

      const upRes = await api.uploadInfluenceScreenshot(
        project.id,
        { name: kalut.filename, mimeType: kalut.mimeType, buffer: kalut.buffer },
        { talentName: kalut.talentName, platform: kalut.platform }
      );
      expect([200, 201]).toContain(upRes.status);
      const metricId = String(extractSingleMetric(upRes.data, upRes.raw).metric.id ?? "");
      expect(metricId).toBeTruthy();

      const patchRes = await api.updateInfluenceMetric(project.id, metricId, {
        views: 250000,
        likes: 19000,
        comments: 420,
        shares: 1150,
        reposts: null,
        saves: 1000,
        verifiedByHuman: true,
      });
      expect(patchRes.status).toBe(200);

      const updated = extractSingleMetric(patchRes.data, patchRes.raw).metric;
      expect(updated.verifiedByHuman).toBe(true);
      expect(Number(updated.views)).toBe(250000);
      expect(Number(updated.likes)).toBe(19000);
      expect(Number(updated.saves)).toBe(1000);
      // (19000 + 420 + 1150 + 0 + 1000) / 250000 * 100 = 8.628 -> 8.63
      expect(Number(updated.engagementRate)).toBeCloseTo(8.63, 2);

      const getAfter = await api.getInfluenceReporting(project.id);
      const stored = extractInfluenceList(getAfter.data).metrics.find((m) => m.id === metricId);
      expect(stored?.verifiedByHuman).toBe(true);
      expect(Number(stored?.views)).toBe(250000);
    });

    test("T1-F21-04 /reporting UI side-by-side verification displays image preview alongside editable inputs and persists reload", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21SideBySide",
        ["Kalut"]
      );
      const kalut = PILOT_INFLUENCE_SCREENSHOTS[0];

      const upRes = await api.uploadInfluenceScreenshot(
        project.id,
        { name: kalut.filename, mimeType: kalut.mimeType, buffer: kalut.buffer },
        {
          talentName: kalut.talentName,
          platform: kalut.platform,
          contentUrl: kalut.contentUrl,
          sparkCode: kalut.sparkCode,
        }
      );
      expect([200, 201]).toContain(upRes.status);

      const errors = await attachErrorTracking(page);
      await page.goto(`${BASE_URL}/reporting?projectId=${project.id}`);
      await expect(page.locator("body")).toContainText("Kalut");

      const previewImg = page
        .locator(
          'main img[alt*="Kalut"], main img[data-testid*="screenshot"], main img[src*="reporting"], main img[src^="data:"], main img[src^="blob:"], [data-testid*="influence-preview"] img'
        )
        .first();
      await expect(previewImg).toBeVisible();
      expect(
        await previewImg.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)
      ).toBe(true);

      const likesInput = page
        .locator(
          'input[name="likes"], input[data-testid*="likes"], label:has-text("Likes") input, label:has-text("Likes") + input'
        )
        .or(page.getByLabel(/likes/i))
        .first();
      await expect(likesInput).toBeVisible();
      await likesInput.fill("19500");

      const verifyBtn = page
        .locator("button")
        .filter({ hasText: /Valider|Vérifier|Enregistrer/i })
        .first();
      await expect(verifyBtn).toBeVisible();
      const [patchRes] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/reporting/influence/") && r.request().method() === "PATCH"
        ),
        verifyBtn.click(),
      ]);
      expect(patchRes.status()).toBe(200);
      await expect(page.locator("body")).toContainText(/Vérifié|Validé/i);

      await page.reload();
      await expect(likesInput).toHaveValue("19500");
      await expect(page.locator("body")).toContainText(/Vérifié|Validé/i);
      expect(errors.pageErrors).toEqual([]);
      expect(errors.consoleErrors).toEqual([]);
      expect(errors.serverErrors).toEqual([]);
    });

    test("T1-F21-05 Raw WhatsApp screenshot in 006.1.2 remains immutable after metric edits", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21Immutable",
        ["Allyson"]
      );
      const allyson = PILOT_INFLUENCE_SCREENSHOTS[2];

      const upRes = await api.uploadInfluenceScreenshot(
        project.id,
        { name: allyson.filename, mimeType: allyson.mimeType, buffer: allyson.buffer },
        { talentName: allyson.talentName, platform: allyson.platform }
      );
      expect([200, 201]).toContain(upRes.status);
      const extracted = extractSingleMetric(upRes.data, upRes.raw);
      const metricId = String(extracted.metric.id ?? "");
      const initialRawFileId = String(
        extracted.metric.rawFileId ?? extracted.rawFile?.id ?? ""
      );
      const initialDriveFileId = String(extracted.rawFile?.driveFileId ?? "");

      await api.harness.resetCalls();

      const patchRes = await api.updateInfluenceMetric(project.id, metricId, {
        views: 100000,
        likes: 7500,
        verifiedByHuman: true,
      });
      expect(patchRes.status).toBe(200);

      const listAfter = await api.getInfluenceReporting(project.id);
      const afterObj = extractInfluenceList(listAfter.data);
      const updatedMetric = afterObj.metrics.find((m) => m.id === metricId);
      if (initialRawFileId) {
        expect(String(updatedMetric?.rawFileId ?? "")).toBe(initialRawFileId);
      }

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);
      if (initialDriveFileId) {
        const mutatingRawCalls = calls.data.filter(
          (c) =>
            /update|delete|patch|move/i.test(String(c.operation ?? c.method ?? "")) &&
            String(c.targetId ?? c.fileId ?? "") === initialDriveFileId
        );
        expect(mutatingRawCalls).toEqual([]);
      }
    });

    test("T1-F21-06 contentUrl and sparkCode persist in Influence API and /reporting UI", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21Spark",
        ["Kalut"]
      );
      const kalut = PILOT_INFLUENCE_SCREENSHOTS[0];

      const upRes = await api.uploadInfluenceScreenshot(
        project.id,
        { name: kalut.filename, mimeType: kalut.mimeType, buffer: kalut.buffer },
        {
          talentName: kalut.talentName,
          platform: kalut.platform,
          contentUrl: kalut.contentUrl,
          sparkCode: kalut.sparkCode,
        }
      );
      expect([200, 201]).toContain(upRes.status);

      const listed = await api.getInfluenceReporting(project.id);
      expect(listed.status).toBe(200);
      const stored = extractInfluenceList(listed.data).metrics[0];
      expect(stored?.contentUrl).toBe(kalut.contentUrl);
      expect(stored?.sparkCode).toBe(kalut.sparkCode);

      const errors = await attachErrorTracking(page);
      await page.goto(`${BASE_URL}/reporting?projectId=${project.id}`);
      await expect(page.locator("body")).toContainText(kalut.sparkCode ?? "#SPARK-KALUT-01");
      await expect(page.locator("body")).toContainText(/tiktok\.com\/@kalut/i);
      expect(errors.pageErrors).toEqual([]);
      expect(errors.consoleErrors).toEqual([]);
      expect(errors.serverErrors).toEqual([]);
    });
  });

  // ===========================================================================
  // F22 — Reporting Excel/Sheets Consolidation (006.2) & .xlsx Export (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F22: Reporting Consolidation (006.2) & .xlsx Export", () => {
    test("T1-F22-01 Verbatims CRUD creates and lists selectedForSlides true/false entries", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F22Verbatims"
      );

      for (const v of PILOT_VERBATIMS) {
        const res = await api.createVerbatim(project.id, v);
        expect([200, 201]).toContain(res.status);
      }

      const listed = await api.listVerbatims(project.id);
      expect(listed.status).toBe(200);
      expect(listed.data.length).toBe(4);

      const selected = listed.data.filter((v) => v.selectedForSlides === true);
      const unselected = listed.data.filter((v) => v.selectedForSlides === false);
      expect(selected.length).toBe(3);
      expect(unselected.length).toBe(1);
      expect(unselected[0].authorHandle).toBe("@snap_gamer75");
    });

    test("T1-F22-02 POST /reporting/consolidate updates 006.2 Sheet with AuditLog and zero PROD mutation", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F22Consolidate",
        PILOT_PROJECT.talents
      );
      await seedFullPilotReportingDataset(api, project.id);
      await api.harness.resetCalls();

      const consRes = await api.consolidateReporting(project.id);
      expect([200, 201]).toContain(consRes.status);

      const sheetId = String(
        consRes.data.reportingSheetId ?? consRes.data.sheetId ?? project.reportingSheetId ?? ""
      );
      expect(sheetId).toBeTruthy();
      expect(sheetId).not.toBe(PROD_IDS.PROD_REPORTING_SHEET);

      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit, {
        action: /CONSOLIDAT|REPORTING/i,
        projectId: project.id,
      });

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);
      const prodSheetCalls = calls.data.filter(
        (c) =>
          /update|append|write|batch/i.test(String(c.operation ?? c.method ?? "")) &&
          String(c.targetId ?? c.spreadsheetId ?? "") === PROD_IDS.PROD_REPORTING_SHEET
      );
      expect(prodSheetCalls).toEqual([]);
    });

    test("T1-F22-03 GET /reporting/export-xlsx returns valid PKZIP workbook with exact 4 tabs", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F22Export",
        PILOT_PROJECT.talents
      );
      await seedFullPilotReportingDataset(api, project.id);
      await api.consolidateReporting(project.id);

      const xlsxRes = await api.exportReportingXlsx(project.id);
      expect(xlsxRes.status).toBe(200);
      expect(xlsxRes.headers["content-type"]).toContain("spreadsheetml");
      assertValidXlsxBuffer(xlsxRes.buffer, EXPECTED_REPORTING_TABS);
    });

    test("T1-F22-04 Exported .xlsx mathematically reconciles Influence par Talent == Cumulé Réseaux == expected totals", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F22Reconcile",
        PILOT_PROJECT.talents
      );
      await seedFullPilotReportingDataset(api, project.id);
      await api.consolidateReporting(project.id);

      const xlsxRes = await api.exportReportingXlsx(project.id);
      expect(xlsxRes.status).toBe(200);

      const { sheets } = assertValidXlsxBuffer(xlsxRes.buffer, EXPECTED_REPORTING_TABS);
      const expectedTotals = computeExpectedInfluenceTotals(PILOT_INFLUENCE_SCREENSHOTS);
      const expectedNonLikeInteractions =
        expectedTotals.totalComments +
        expectedTotals.totalShares +
        expectedTotals.totalReposts +
        expectedTotals.totalSaves;

      // Tab 1: Synthèse Fortnite
      const fortniteRows = sheets["Synthèse Fortnite"];
      expect(fortniteRows.length).toBeGreaterThanOrEqual(5);
      expect(findMatchingNumberInRows(fortniteRows, EXPECTED_FORTNITE_SUMMARY.totalUniquePlayers)).toBe(
        true
      );
      expect(findMatchingNumberInRows(fortniteRows, EXPECTED_FORTNITE_SUMMARY.totalSessions)).toBe(
        true
      );
      expect(findMatchingNumberInRows(fortniteRows, EXPECTED_FORTNITE_SUMMARY.maxPeakConcurrent)).toBe(
        true
      );

      // Tab 2: Influence par Talent (per-talent row pairing + totals)
      const talentRows = sheets["Influence par Talent"];
      const talentText = flattenSheetText(talentRows);
      for (const shot of PILOT_INFLUENCE_SCREENSHOTS) {
        expect(talentText).toContain(shot.talentName);
        const matchingTalentRows = talentRows.filter((row) =>
          new RegExp(shot.talentName, "i").test(row.join(" "))
        );
        expect(
          matchingTalentRows.length,
          `Missing row for talent ${shot.talentName} in Influence par Talent`
        ).toBeGreaterThanOrEqual(1);
        expect(
          findMatchingNumberInRows(matchingTalentRows, shot.expectedMetrics.views),
          `Talent row for ${shot.talentName} missing views ${shot.expectedMetrics.views}`
        ).toBe(true);
        expect(
          findMatchingNumberInRows(matchingTalentRows, shot.expectedMetrics.likes),
          `Talent row for ${shot.talentName} missing likes ${shot.expectedMetrics.likes}`
        ).toBe(true);
      }
      expect(findMatchingNumberInRows(talentRows, expectedTotals.totalViews)).toBe(true);
      expect(findMatchingNumberInRows(talentRows, expectedTotals.totalLikes)).toBe(true);

      // Tab 3: Cumulé Réseaux (per-platform subtotals + grand totals)
      const networkRows = sheets["Cumulé Réseaux"];
      const networkText = flattenSheetText(networkRows);
      for (const platform of INFLUENCE_PLATFORMS) {
        const label =
          platform === "TIKTOK"
            ? "TikTok"
            : platform === "YOUTUBE_SHORTS"
              ? "YouTube"
              : platform === "INSTAGRAM"
                ? "Instagram"
                : "Snapchat";
        const platformRegex = new RegExp(`${platform}|${label}`, "i");
        expect(networkText).toMatch(platformRegex);
        const matchingPlatformRows = networkRows.filter((row) =>
          platformRegex.test(row.join(" "))
        );
        expect(
          matchingPlatformRows.length,
          `Missing row for platform ${platform} in Cumulé Réseaux`
        ).toBeGreaterThanOrEqual(1);
        expect(
          findMatchingNumberInRows(matchingPlatformRows, expectedTotals.byPlatform[platform].views),
          `Platform row ${platform} missing views subtotal ${expectedTotals.byPlatform[platform].views}`
        ).toBe(true);
        expect(
          findMatchingNumberInRows(matchingPlatformRows, expectedTotals.byPlatform[platform].likes),
          `Platform row ${platform} missing likes subtotal ${expectedTotals.byPlatform[platform].likes}`
        ).toBe(true);
      }
      expect(findMatchingNumberInRows(networkRows, expectedTotals.totalViews)).toBe(true);
      expect(findMatchingNumberInRows(networkRows, expectedTotals.totalLikes)).toBe(true);
      expect(
        findMatchingNumberInRows(networkRows, expectedNonLikeInteractions) ||
          findMatchingNumberInRows(
            networkRows,
            expectedTotals.totalLikes + expectedNonLikeInteractions
          )
      ).toBe(true);

      // Tab 4: Verbatims
      const verbatimText = flattenSheetText(sheets["Verbatims"]);
      for (const v of PILOT_VERBATIMS) {
        expect(verbatimText).toContain(v.authorHandle);
        expect(verbatimText).toContain(v.quote);
      }
    });

    test("T1-F22-05 /reporting UI displays 4-tab preview and 1-click .xlsx download produces valid workbook", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F22UiExport",
        PILOT_PROJECT.talents
      );
      await seedFullPilotReportingDataset(api, project.id);
      await api.consolidateReporting(project.id);

      const errors = await attachErrorTracking(page);
      await page.goto(`${BASE_URL}/reporting?projectId=${project.id}`);

      for (const tabName of REPORTING_TABS) {
        await expect(page.locator("body")).toContainText(tabName);
      }

      const exportBtn = page
        .locator("button, a")
        .filter({ hasText: /Exporter.*\.xlsx|Télécharger.*\.xlsx|\.xlsx/i })
        .first();
      await expect(exportBtn).toBeVisible();

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        exportBtn.click(),
      ]);
      const downloadedPath = await download.path();
      expect(downloadedPath).toBeTruthy();
      const buf = await readFile(downloadedPath as string);
      assertValidXlsxBuffer(buf, EXPECTED_REPORTING_TABS);
      expect(errors.pageErrors).toEqual([]);
      expect(errors.consoleErrors).toEqual([]);
      expect(errors.serverErrors).toEqual([]);
    });

    test("T1-F22-06 Re-running consolidation after metric and verbatim updates is idempotent with zero duplicates", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F22Idemp",
        PILOT_PROJECT.talents
      );
      const { metricIds } = await seedFullPilotReportingDataset(api, project.id);

      const firstCons = await api.consolidateReporting(project.id);
      expect([200, 201]).toContain(firstCons.status);
      const sheetId1 = String(firstCons.data.reportingSheetId ?? firstCons.data.sheetId ?? "");

      const patchRes = await api.updateInfluenceMetric(project.id, metricIds[0], {
        views: 300000,
        verifiedByHuman: true,
      });
      expect(patchRes.status).toBe(200);

      const extraVerbatim = await api.createVerbatim(project.id, {
        authorHandle: "@fifth_player",
        platform: "TIKTOK",
        talentName: "Kalut",
        quote: "Cinquième retour positif sur la map !",
        likesCount: 88,
        selectedForSlides: true,
      });
      expect([200, 201]).toContain(extraVerbatim.status);

      const secondCons = await api.consolidateReporting(project.id);
      expect([200, 201]).toContain(secondCons.status);
      const sheetId2 = String(secondCons.data.reportingSheetId ?? secondCons.data.sheetId ?? "");
      if (sheetId1 && sheetId2) {
        expect(sheetId2).toBe(sheetId1);
      }

      const xlsxRes = await api.exportReportingXlsx(project.id);
      const { sheets } = assertValidXlsxBuffer(xlsxRes.buffer, EXPECTED_REPORTING_TABS);

      const kalutRows = sheets["Influence par Talent"].filter((row) =>
        row.join(" ").includes("Kalut")
      );
      const aksiankaRows = sheets["Influence par Talent"].filter((row) =>
        row.join(" ").includes("Aksianka")
      );
      expect(kalutRows.length).toBe(1);
      expect(aksiankaRows.length).toBe(1);
      expect(findMatchingNumberInRows(kalutRows, 300000)).toBe(true);
      expect(findMatchingNumberInRows(kalutRows, 245000)).toBe(false);
      expect(findMatchingNumberInRows(sheets["Influence par Talent"], 245000)).toBe(false);

      const verbatimHandles = sheets["Verbatims"]
        .map((r) => r.join(" "))
        .filter((line) => line.includes("@neox_fn"));
      expect(verbatimHandles.length).toBe(1);
      expect(flattenSheetText(sheets["Verbatims"])).toContain("@fifth_player");
    });
  });

  // ===========================================================================
  // F23 — Branded Google Slides Reporting Generator (006.3) & [EXT] Pub (6 tests)
  // ===========================================================================
  test.describe("Tier 1 — F23: Branded Slides Reporting Generator (006.3) & [EXT] Publish", () => {
    test("T1-F23-01 generate-slides creates 16:9 branded deck in 006.3 without touching PROD template", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F23Gen",
        PILOT_PROJECT.talents
      );
      await seedFullPilotReportingDataset(api, project.id);
      await api.consolidateReporting(project.id);
      await api.harness.resetCalls();

      const slidesRes = await api.generateReportingSlides(project.id);
      expect([200, 201]).toContain(slidesRes.status);

      const slidesFileId = String(
        slidesRes.data.slidesFileId ?? slidesRes.data.driveFileId ?? ""
      );
      expect(slidesFileId).toBeTruthy();
      expect(slidesFileId).not.toBe(PROD_IDS.PROD_REPORTING_SLIDES);

      const dims = isRecord(slidesRes.data.dimensionsEmu)
        ? slidesRes.data.dimensionsEmu
        : isRecord(slidesRes.data.dimensions)
          ? slidesRes.data.dimensions
          : undefined;
      if (dims) {
        expect(Number(dims.width)).toBe(REPORTING_SLIDES_DIMENSIONS_EMU.width);
        expect(Number(dims.height)).toBe(REPORTING_SLIDES_DIMENSIONS_EMU.height);
      }

      const tree = await api.getDriveTree(project.id);
      const node0063 = findReportingSlidesNode(tree.data, slidesFileId);
      expect(node0063).toBeDefined();
      assertProdUntouched(tree.data);

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);
      expect(
        node0063?.driveFileId === slidesFileId ||
          calls.data.some((c) => JSON.stringify(c).includes(slidesFileId)),
        "Expected generated slidesFileId to be linked to 006.3 node or recorded in Gateway calls"
      ).toBe(true);
    });

    test("T1-F23-02 Generated deck contains all required sections, 1 slide per Talent, and selected-only Verbatims", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F23Struct",
        PILOT_PROJECT.talents
      );
      await seedFullPilotReportingDataset(api, project.id);
      await api.consolidateReporting(project.id);

      const slidesRes = await api.generateReportingSlides(project.id);
      expect([200, 201]).toContain(slidesRes.status);

      assertReportingSlidesStructure(slidesRes.data, {
        talents: PILOT_PROJECT.talents,
        includedVerbatimHandles: ["@neox_fn", "@lulu_build", "@enzo_rp"],
        excludedVerbatimHandles: ["@snap_gamer75"],
      });
    });

    test("T1-F23-03 Slide Chiffres cumulés strictly reconciles with 006.2 .xlsx totals", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F23Reconcile",
        PILOT_PROJECT.talents
      );
      await seedFullPilotReportingDataset(api, project.id);
      await api.consolidateReporting(project.id);

      const [slidesRes, xlsxRes] = await Promise.all([
        api.generateReportingSlides(project.id),
        api.exportReportingXlsx(project.id),
      ]);
      expect([200, 201]).toContain(slidesRes.status);
      expect(xlsxRes.status).toBe(200);

      const { sheets } = inspectXlsxWorkbook(xlsxRes.buffer);
      const expectedTotals = computeExpectedInfluenceTotals(PILOT_INFLUENCE_SCREENSHOTS);
      expect(findMatchingNumberInRows(sheets["Cumulé Réseaux"], expectedTotals.totalViews)).toBe(
        true
      );
      expect(findMatchingNumberInRows(sheets["Cumulé Réseaux"], expectedTotals.totalLikes)).toBe(
        true
      );

      const slidesArray = toRecordArray(
        slidesRes.data.slides ?? slidesRes.data.slidesSummary ?? slidesRes.data.pages
      );
      let cumulativeScopeText: string;
      if (slidesArray.length > 0) {
        const cumulativeSlide =
          slidesArray.find((s) =>
            /Chiffres cumul[ée]s|CUMULATIVE/i.test(`${String(s.title ?? "")} ${String(s.type ?? "")}`)
          ) ?? slidesArray.find((s) => /Chiffres cumul[ée]s/i.test(JSON.stringify(s)));
        expect(
          cumulativeSlide,
          "Expected Chiffres cumulés slide entry in slides array"
        ).toBeDefined();
        cumulativeScopeText = JSON.stringify(cumulativeSlide);
      } else {
        cumulativeScopeText = JSON.stringify(slidesRes.data);
      }

      let normalizedSlides = cumulativeScopeText;
      let prev = "";
      while (normalizedSlides !== prev) {
        prev = normalizedSlides;
        normalizedSlides = normalizedSlides
          .replace(/(\d)[\s\u00a0\u202f]+(?=\d{3}(?:\D|$))/g, "$1")
          .replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1");
      }
      expect(normalizedSlides).toMatch(
        new RegExp(`(?:^|\\D)${expectedTotals.totalViews}(?:$|\\D)`)
      );
      expect(normalizedSlides).toMatch(
        new RegExp(`(?:^|\\D)${expectedTotals.totalLikes}(?:$|\\D)`)
      );

      const nonLikeInteractions =
        expectedTotals.totalComments +
        expectedTotals.totalShares +
        expectedTotals.totalReposts +
        expectedTotals.totalSaves;
      const nonLikeRegex = new RegExp(`(?:^|\\D)${nonLikeInteractions}(?:$|\\D)`);
      const totalInterRegex = new RegExp(
        `(?:^|\\D)${expectedTotals.totalLikes + nonLikeInteractions}(?:$|\\D)`
      );
      expect(
        nonLikeRegex.test(normalizedSlides) || totalInterRegex.test(normalizedSlides),
        `Expected ${nonLikeInteractions} or ${expectedTotals.totalLikes + nonLikeInteractions} on Chiffres cumulés slide`
      ).toBe(true);
    });

    test("T1-F23-04 Validé Client approval + publish-ext delivers file to [EXT]/04. Reporting Final (EXT.04)", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F23PublishExt",
        PILOT_PROJECT.talents
      );
      await seedFullPilotReportingDataset(api, project.id);
      await api.consolidateReporting(project.id);

      const slidesRes = await api.generateReportingSlides(project.id);
      expect([200, 201]).toContain(slidesRes.status);
      const slidesFileId = String(slidesRes.data.slidesFileId ?? "");

      const treeBefore = await api.getDriveTree(project.id);
      const node0063 = findReportingSlidesNode(treeBefore.data, slidesFileId);
      expect(node0063).toBeDefined();

      const validateRes = await api.updateDriveNode(project.id, (node0063 as DriveNodeDto).id, {
        validationStatus: "VALIDE_CLIENT",
      });
      expect(validateRes.status).toBe(200);

      const pubRes = await api.publishReportingExt(project.id, { confirmValidation: true });
      expect([200, 201]).toContain(pubRes.status);
      const extMirrorId = String(
        pubRes.data.extMirrorFileId ?? pubRes.data.driveFileId ?? ""
      );
      expect(extMirrorId).toBeTruthy();

      const treeAfter = await api.getDriveTree(project.id);
      const updated0063 = findReportingSlidesNode(treeAfter.data, slidesFileId);
      expect(updated0063?.extMirrorFileId).toBeTruthy();
      expect(updated0063?.validationStatus).toBe("VALIDE_CLIENT");
      assertProdUntouched(treeAfter.data);

      const audit = await api.listAuditLogs(project.id);
      assertAuditLogged(audit, {
        action: /REPORTING.*PUBLISH|PUBLISH.*EXT|SYNC.*EXT/i,
        projectId: project.id,
      });
    });

    test("T1-F23-05 Re-publishing [EXT] after deck regeneration updates existing EXT.04 file in-place without duplicates", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F23Republish",
        PILOT_PROJECT.talents
      );
      await seedFullPilotReportingDataset(api, project.id);
      await api.consolidateReporting(project.id);

      const slides1 = await api.generateReportingSlides(project.id);
      expect([200, 201]).toContain(slides1.status);

      const tree1 = await api.getDriveTree(project.id);
      const node0063 = findReportingSlidesNode(
        tree1.data,
        String(slides1.data.slidesFileId ?? "")
      ) as DriveNodeDto;
      expect(node0063).toBeDefined();

      await api.updateDriveNode(project.id, node0063.id, { validationStatus: "VALIDE_CLIENT" });
      const pub1 = await api.publishReportingExt(project.id, { confirmValidation: true });
      expect([200, 201]).toContain(pub1.status);
      const firstExtId = String(pub1.data.extMirrorFileId ?? "");
      expect(firstExtId).toBeTruthy();

      await api.harness.resetCalls();
      const slides2 = await api.generateReportingSlides(project.id);
      expect([200, 201]).toContain(slides2.status);

      const treeMid = await api.getDriveTree(project.id);
      const updatedNode = findReportingSlidesNode(
        treeMid.data,
        String(slides2.data.slidesFileId ?? "")
      ) as DriveNodeDto;
      if (updatedNode.validationStatus !== "VALIDE_CLIENT") {
        await api.updateDriveNode(project.id, updatedNode.id, {
          validationStatus: "VALIDE_CLIENT",
        });
      }

      const pub2 = await api.publishReportingExt(project.id, { confirmValidation: true });
      expect([200, 201]).toContain(pub2.status);
      const secondExtId = String(pub2.data.extMirrorFileId ?? "");
      expect(secondExtId).toBe(firstExtId);

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);
      const treeFinal = await api.getDriveTree(project.id);
      const extMatches = treeFinal.data.filter((n) => n.extMirrorFileId === firstExtId);
      expect(extMatches.length).toBe(1);
    });

    test("T1-F23-06 /reporting UI generates Slides deck and publishes to [EXT] after Validé Client", async ({
      page,
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F23Ui",
        PILOT_PROJECT.talents
      );
      await seedFullPilotReportingDataset(api, project.id);
      await api.consolidateReporting(project.id);

      const errors = await attachErrorTracking(page);
      await page.goto(`${BASE_URL}/reporting?projectId=${project.id}`);

      const genBtn = page
        .locator("button")
        .filter({ hasText: /Générer.*Slides|Générer.*Reporting/i })
        .first();
      await expect(genBtn).toBeVisible();
      await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/reporting/generate-slides") &&
            res.request().method() === "POST" &&
            [200, 201].includes(res.status())
        ),
        genBtn.click(),
      ]);

      await expect(page.locator("body")).toContainText(/Chiffres cumulés|006\.3|Slides généré/i);

      const statusSelect = page
        .locator('select[name="validationStatus"], select[data-testid*="validation"]')
        .first();
      const validateBtn = page
        .locator("button, label")
        .filter({ hasText: /Validé Client/i })
        .first();
      if (await statusSelect.isVisible().catch(() => false)) {
        const [patchNodeRes] = await Promise.all([
          page.waitForResponse(
            (r) => r.url().includes("/drive/nodes/") && r.request().method() === "PATCH"
          ),
          statusSelect.selectOption("VALIDE_CLIENT"),
        ]);
        expect(patchNodeRes.status()).toBe(200);
      } else if (await validateBtn.isVisible().catch(() => false)) {
        const [patchNodeRes] = await Promise.all([
          page.waitForResponse(
            (r) => r.url().includes("/drive/nodes/") && r.request().method() === "PATCH"
          ),
          validateBtn.click(),
        ]);
        expect(patchNodeRes.status()).toBe(200);
      } else {
        const tree = await api.getDriveTree(project.id);
        const node0063 = findReportingSlidesNode(tree.data);
        expect(node0063).toBeDefined();
        const updRes = await api.updateDriveNode(project.id, (node0063 as DriveNodeDto).id, {
          validationStatus: "VALIDE_CLIENT",
        });
        expect(updRes.ok).toBe(true);
        await page.reload();
      }

      const publishBtn = page
        .locator("button")
        .filter({ hasText: /Publier.*\[EXT\]|Publier.*EXT/i })
        .first();
      await expect(publishBtn).toBeVisible();
      const [pubRes] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/reporting/publish-ext") && r.request().method() === "POST"
        ),
        publishBtn.click(),
      ]);
      expect([200, 201]).toContain(pubRes.status());

      await expect(page.locator("body")).toContainText(/Publié.*\[EXT\]|04\. Reporting Final/i);

      const treeAfter = await api.getDriveTree(project.id);
      const node0063After = findReportingSlidesNode(treeAfter.data);
      expect(node0063After?.extMirrorFileId).toBeTruthy();
      expect(errors.pageErrors).toEqual([]);
      expect(errors.consoleErrors).toEqual([]);
      expect(errors.serverErrors).toEqual([]);
    });
  });
});
