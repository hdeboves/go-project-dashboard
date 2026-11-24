/**
 * Tier 2 — Boundary, Corner Case & Negative Opaque-Box E2E Tests (F20–F23: Reporting)
 * Target count: 24 tests (6 per feature across F20, F21, F22, F23).
 * Uses Category-Partition & Boundary Value Analysis against /api/projects/[id]/reporting/*
 * and /reporting UI under TEST_BOUNDARY_HARNESS=1. Zero imports from src/ or prisma/.
 */

import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import {
  createApiClient,
  type ApiClient,
  type DriveNodeDto,
  type ProjectDto,
} from "../helpers/api-client";
import {
  assertCpConflictBlocked,
  assertPreconditionMissing,
  assertProdUntouched,
  assertValidXlsxBuffer,
} from "../helpers/assertions";
import {
  CONFLICT_CP_CRISTALINE,
  PILOT_PROJECT,
  PROD_IDS,
  uniqueTestCp,
} from "../helpers/constants";
import {
  buildMinimalPngBuffer,
  EXPECTED_REPORTING_TABS,
  FORTNITE_CREATOR_CSV_BUFFER,
  FORTNITE_CREATOR_CSV_MALFORMED,
  PILOT_INFLUENCE_SCREENSHOTS,
  PILOT_VERBATIMS,
} from "../fixtures/reporting-data";
import { buildMalformedBudgetXlsx } from "../fixtures/budget-xlsx";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function extractFortniteRows(payload: unknown): Record<string, unknown>[] {
  const obj = isRecord(payload) ? payload : {};
  return toRecordArray(obj.rows ?? obj.metrics ?? obj.items ?? obj.fortniteMetrics);
}

function extractInfluenceMetrics(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return toRecordArray(payload);
  }
  const obj = isRecord(payload) ? payload : {};
  return toRecordArray(obj.metrics ?? obj.items ?? obj.influenceMetrics ?? obj.data);
}

function extractSingleMetric(data: unknown): Record<string, unknown> {
  const obj = isRecord(data) ? data : {};
  return isRecord(obj.metric) ? obj.metric : obj;
}

function findReportingSlidesNode(nodes: DriveNodeDto[], slidesFileId?: string): DriveNodeDto | undefined {
  if (slidesFileId) {
    const byId = nodes.find((n) => n.driveFileId === slidesFileId);
    if (byId) return byId;
  }
  return (
    nodes.find((n) => n.code === "006.3.slides") ??
    nodes.find((n) => n.code.startsWith("006.3") && n.isFolder === false) ??
    nodes.find((n) => n.code === "006.3")
  );
}

async function createProvisionedReportingProject(
  api: ApiClient,
  workerIndex: number,
  suffix = "RepBva",
  talents: readonly string[] = [],
  overrideCp?: string
): Promise<{ project: ProjectDto; nodes: DriveNodeDto[] }> {
  const cp = overrideCp ?? uniqueTestCp(workerIndex);
  const created = await api.createProject({
    codeProjet: cp,
    client: `Client ${suffix} ${cp}`,
    nomJeu: `Fortnite ${suffix} ${uniqueTestCp(workerIndex + 7)}`,
    isSandbox: true,
  });
  expect(created.status, `Failed creating project ${cp}: ${JSON.stringify(created.raw)}`).toBe(201);
  const project = created.data;

  const provisioned = await api.provisionDriveTree(project.id);
  expect([200, 201]).toContain(provisioned.status);

  for (const talentName of talents) {
    const tRes = await api.addTalent(project.id, { talentName });
    expect([200, 201]).toContain(tRes.status);
  }

  const treeRes = await api.getDriveTree(project.id);
  expect(treeRes.status).toBe(200);
  return { project, nodes: treeRes.data };
}

test.describe("Tier 2 — Reporting Boundary & Negative Cases (F20–F23)", () => {
  test.beforeEach(async ({ request }) => {
    const api = createApiClient(request);
    await api.harness.restoreConfigured();
  });

  // ===========================================================================
  // F20 Boundaries (5 connected tests here + 1 in 412 serial group = 6)
  // ===========================================================================
  test.describe("Tier 2 — F20 Boundaries: Fortnite Creator Portal Ingestion", () => {
    test("T2-F20-01 Malformed Fortnite CSV with missing required columns is rejected with 0 rows stored", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F20Malformed"
      );

      const res = await api.uploadFortniteReport(project.id, {
        name: "malformed_fortnite.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(FORTNITE_CREATOR_CSV_MALFORMED, "utf8"),
      });
      expect([400, 422]).toContain(res.status);
      expect(res.ok).toBe(false);

      const after = await api.getFortniteReporting(project.id);
      expect(after.status).toBe(200);
      expect(extractFortniteRows(after.data)).toEqual([]);
    });

    test("T2-F20-02 Empty 0-byte CSV and header-only CSV (0 data rows) fail cleanly without 500", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F20EmptyCsv"
      );

      const zeroByte = await api.uploadFortniteReport(project.id, {
        name: "empty_0_bytes.csv",
        mimeType: "text/csv",
        buffer: Buffer.alloc(0),
      });
      expect([400, 422]).toContain(zeroByte.status);
      expect(zeroByte.status).not.toBe(500);

      const headerOnly = await api.uploadFortniteReport(project.id, {
        name: "header_only.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "date,unique_players,sessions,avg_playtime_sec,retention_d1,peak_concurrent\n",
          "utf8"
        ),
      });
      expect([400, 422]).toContain(headerOnly.status);
      expect(headerOnly.status).not.toBe(500);

      const after = await api.getFortniteReporting(project.id);
      expect(after.status).toBe(200);
      expect(extractFortniteRows(after.data)).toEqual([]);
    });

    test("T2-F20-03 Invalid calendar date in Fortnite CSV row is atomically rejected", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F20BadDate"
      );

      const badDateCsv = Buffer.from(
        [
          "date,unique_players,sessions,avg_playtime_sec,retention_d1,peak_concurrent",
          "2026-09-01,12400,18500,1140,24.5,920",
          "2026-02-30,10000,15000,900,20.0,800",
        ].join("\n"),
        "utf8"
      );
      const resBadCal = await api.uploadFortniteReport(project.id, {
        name: "bad_calendar_date.csv",
        mimeType: "text/csv",
        buffer: badDateCsv,
      });
      expect([400, 422]).toContain(resBadCal.status);

      const nonDateCsv = Buffer.from(
        [
          "date,unique_players,sessions,avg_playtime_sec,retention_d1,peak_concurrent",
          "invalid-date,10000,15000,900,20.0,800",
        ].join("\n"),
        "utf8"
      );
      const resInvalidText = await api.uploadFortniteReport(project.id, {
        name: "invalid_date_text.csv",
        mimeType: "text/csv",
        buffer: nonDateCsv,
      });
      expect([400, 422]).toContain(resInvalidText.status);

      const after = await api.getFortniteReporting(project.id);
      expect(after.status).toBe(200);
      expect(extractFortniteRows(after.data)).toEqual([]);
    });

    test("T2-F20-04 Negative metrics and retention_d1 > 100% are rejected cleanly", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F20NegMetrics"
      );

      const negativePlayersCsv = Buffer.from(
        "date,unique_players,sessions,avg_playtime_sec,retention_d1,peak_concurrent\n2026-09-01,-10,100,600,25.0,50\n",
        "utf8"
      );
      const negRes = await api.uploadFortniteReport(project.id, {
        name: "negative_players.csv",
        mimeType: "text/csv",
        buffer: negativePlayersCsv,
      });
      expect([400, 422]).toContain(negRes.status);

      const overRetentionCsv = Buffer.from(
        "date,unique_players,sessions,avg_playtime_sec,retention_d1,peak_concurrent\n2026-09-01,500,800,600,145,50\n",
        "utf8"
      );
      const overRes = await api.uploadFortniteReport(project.id, {
        name: "over_retention.csv",
        mimeType: "text/csv",
        buffer: overRetentionCsv,
      });
      expect([400, 422]).toContain(overRes.status);

      const after = await api.getFortniteReporting(project.id);
      expect(extractFortniteRows(after.data)).toEqual([]);
    });

    test("T2-F20-05 Non-CSV/non-XLSX binary payload rejected and French semicolon CSV handled without 500", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F20Binary"
      );

      const pngAsXlsx = await api.uploadFortniteReport(project.id, {
        name: "fake_fortnite.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: buildMinimalPngBuffer(),
      });
      expect([400, 415, 422]).toContain(pngAsXlsx.status);

      const corruptXlsx = await api.uploadFortniteReport(project.id, {
        name: "corrupt_fortnite.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: buildMalformedBudgetXlsx(),
      });
      expect([400, 415, 422]).toContain(corruptXlsx.status);

      const semicolonCsv = Buffer.from(
        [
          "date;unique_players;sessions;avg_playtime_sec;retention_d1;peak_concurrent",
          "2026-09-01;12400;18500;1140;24.5;920",
        ].join("\n"),
        "utf8"
      );
      const semiRes = await api.uploadFortniteReport(project.id, {
        name: "french_semicolon.csv",
        mimeType: "text/csv",
        buffer: semicolonCsv,
      });
      expect(semiRes.status).not.toBe(500);
      expect([200, 201, 400, 422]).toContain(semiRes.status);
      if (semiRes.ok) {
        const after = await api.getFortniteReporting(project.id);
        const rows = extractFortniteRows(after.data);
        expect(rows.length).toBe(1);
        expect(Number(rows[0].uniquePlayers)).toBe(12400);
      }
    });
  });

  // ===========================================================================
  // F21 Boundaries (5 connected tests here + 1 in 412 serial group = 6)
  // ===========================================================================
  test.describe("Tier 2 — F21 Boundaries: Influence Vision & Human Control", () => {
    test("T2-F21-02 Zero views (views = 0) computes finite engagementRate = 0 without NaN/Infinity", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21ZeroViews",
        ["Kalut"]
      );

      const zeroViewPng = buildMinimalPngBuffer({
        commentText: "Kalut TikTok Vues=0 Likes=0 Coms=0 Partages=0 Enreg=0",
      });
      const upRes = await api.uploadInfluenceScreenshot(
        project.id,
        { name: "zero_views.png", mimeType: "image/png", buffer: zeroViewPng },
        { talentName: "Kalut", platform: "TIKTOK" }
      );
      expect([200, 201]).toContain(upRes.status);
      const uploadedMetric = extractSingleMetric(upRes.data);
      const metricId = String(uploadedMetric.id ?? "");
      expect(metricId).toBeTruthy();

      const patchRes = await api.updateInfluenceMetric(project.id, metricId, {
        views: 0,
        likes: 100,
        comments: 5,
        verifiedByHuman: true,
      });
      expect(patchRes.status).toBe(200);
      const patched = extractSingleMetric(patchRes.data);
      expect(Number(patched.views)).toBe(0);
      expect(Number.isFinite(Number(patched.engagementRate))).toBe(true);
      expect(Number(patched.engagementRate)).toBe(0);
    });

    test("T2-F21-03 Negative metric values rejected on human verification PATCH without overwriting stored values", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21NegPatch",
        ["Kalut"]
      );
      const kalut = PILOT_INFLUENCE_SCREENSHOTS[0];

      const upRes = await api.uploadInfluenceScreenshot(
        project.id,
        { name: kalut.filename, mimeType: kalut.mimeType, buffer: kalut.buffer },
        { talentName: kalut.talentName, platform: kalut.platform }
      );
      expect([200, 201]).toContain(upRes.status);
      const metricId = String(extractSingleMetric(upRes.data).id ?? "");

      const badPatch = await api.updateInfluenceMetric(project.id, metricId, {
        views: -5,
        likes: -1,
        verifiedByHuman: true,
      });
      expect([400, 422]).toContain(badPatch.status);
      expect(badPatch.ok).toBe(false);

      const listAfter = await api.getInfluenceReporting(project.id);
      const stored = extractInfluenceMetrics(listAfter.data).find((m) => m.id === metricId);
      expect(Number(stored?.views)).toBe(kalut.expectedMetrics.views);
      expect(Number(stored?.likes)).toBe(kalut.expectedMetrics.likes);
      expect(stored?.verifiedByHuman).toBe(false);
    });

    test("T2-F21-04 Unsupported platform, non-image MIME, and corrupt image buffer rejected cleanly", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21BadUpload",
        ["Kalut"]
      );
      const kalut = PILOT_INFLUENCE_SCREENSHOTS[0];

      const badPlatform = await api.uploadInfluenceScreenshot(
        project.id,
        { name: kalut.filename, mimeType: kalut.mimeType, buffer: kalut.buffer },
        { talentName: "Kalut", platform: "MYSPACE" }
      );
      expect([400, 422]).toContain(badPlatform.status);

      const badMime = await api.uploadInfluenceScreenshot(
        project.id,
        { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("plain text", "utf8") },
        { talentName: "Kalut", platform: "TIKTOK" }
      );
      expect([400, 415, 422]).toContain(badMime.status);

      const corruptPng = await api.uploadInfluenceScreenshot(
        project.id,
        {
          name: "corrupt_screenshot.png",
          mimeType: "image/png",
          buffer: Buffer.from("CORRUPT_PNG_BYTES_INVALID", "utf8"),
        },
        { talentName: "Kalut", platform: "TIKTOK" }
      );
      expect([400, 415, 422]).toContain(corruptPng.status);

      const after = await api.getInfluenceReporting(project.id);
      expect(extractInfluenceMetrics(after.data)).toEqual([]);
    });

    test("T2-F21-05 Cross-project IDOR blocked on PATCH /reporting/influence/:metricId", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project: projectA } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21IdorA",
        ["Kalut"]
      );
      const { project: projectB } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex + 30,
        "F21IdorB",
        ["Kalut"]
      );
      const kalut = PILOT_INFLUENCE_SCREENSHOTS[0];

      const upA = await api.uploadInfluenceScreenshot(
        projectA.id,
        { name: kalut.filename, mimeType: kalut.mimeType, buffer: kalut.buffer },
        { talentName: kalut.talentName, platform: kalut.platform }
      );
      expect([200, 201]).toContain(upA.status);
      const metricIdA = String(extractSingleMetric(upA.data).id ?? "");
      expect(metricIdA).toBeTruthy();

      const idorRes = await api.updateInfluenceMetric(projectB.id, metricIdA, {
        views: 999999,
        verifiedByHuman: true,
      });
      expect([403, 404]).toContain(idorRes.status);
      expect(idorRes.ok).toBe(false);

      const getA = await api.getInfluenceReporting(projectA.id);
      const storedA = extractInfluenceMetrics(getA.data).find((m) => m.id === metricIdA);
      expect(Number(storedA?.views)).toBe(kalut.expectedMetrics.views);
      expect(storedA?.verifiedByHuman).toBe(false);
    });

    test("T2-F21-06 Empty talentName rejected and CP conflict (326018 in 326027) blocked", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21CpGuard",
        ["Kalut"],
        PILOT_PROJECT.codeProjet
      );
      const kalut = PILOT_INFLUENCE_SCREENSHOTS[0];

      const emptyTalent = await api.uploadInfluenceScreenshot(
        project.id,
        { name: kalut.filename, mimeType: kalut.mimeType, buffer: kalut.buffer },
        { talentName: "   ", platform: "TIKTOK" }
      );
      expect([400, 422]).toContain(emptyTalent.status);

      const cpConflictRes = await api.uploadInfluenceScreenshot(
        project.id,
        {
          name: `influence_${CONFLICT_CP_CRISTALINE.codeProjet}_kalut.png`,
          mimeType: "image/png",
          buffer: buildMinimalPngBuffer({
            commentText: `Facture CP ${CONFLICT_CP_CRISTALINE.codeProjet} Cristaline Kalut TikTok Vues=1000`,
          }),
        },
        {
          talentName: `Talent_${CONFLICT_CP_CRISTALINE.codeProjet}`,
          platform: "TIKTOK",
        }
      );
      assertCpConflictBlocked(
        cpConflictRes,
        CONFLICT_CP_CRISTALINE.codeProjet,
        PILOT_PROJECT.codeProjet
      );

      const after = await api.getInfluenceReporting(project.id);
      expect(extractInfluenceMetrics(after.data)).toEqual([]);
    });
  });

  // ===========================================================================
  // F22 Boundaries (5 connected tests here + 1 in 412 serial group = 6)
  // ===========================================================================
  test.describe("Tier 2 — F22 Boundaries: Consolidation & .xlsx Export", () => {
    test("T2-F22-01 Empty project consolidation and .xlsx export handle zero rows without 500 or NaN", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F22EmptyProj"
      );

      const consRes = await api.consolidateReporting(project.id);
      expect(consRes.status).not.toBe(500);
      expect([200, 201, 400, 422]).toContain(consRes.status);

      const xlsxRes = await api.exportReportingXlsx(project.id);
      expect(xlsxRes.status).not.toBe(500);
      expect([200, 400, 422]).toContain(xlsxRes.status);
      if (xlsxRes.ok) {
        const { sheets } = assertValidXlsxBuffer(xlsxRes.buffer, EXPECTED_REPORTING_TABS);
        for (const tab of EXPECTED_REPORTING_TABS) {
          const text = sheets[tab].map((r) => r.join(" ")).join("\n");
          expect(text).not.toMatch(/\bNaN\b|\bInfinity\b/);
        }
      }
    });

    test("T2-F22-02 Consolidation guards or excludes unverified Influence rows (verifiedByHuman=false)", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F22Unverified",
        ["Kalut"]
      );
      const kalut = PILOT_INFLUENCE_SCREENSHOTS[0];

      const upRes = await api.uploadInfluenceScreenshot(
        project.id,
        { name: kalut.filename, mimeType: kalut.mimeType, buffer: kalut.buffer },
        { talentName: kalut.talentName, platform: kalut.platform }
      );
      expect([200, 201]).toContain(upRes.status);
      expect(extractSingleMetric(upRes.data).verifiedByHuman).toBe(false);

      const consRes = await api.consolidateReporting(project.id);
      expect(consRes.status).not.toBe(500);
      if (!consRes.ok) {
        expect([400, 409, 422]).toContain(consRes.status);
      } else {
        const xlsxRes = await api.exportReportingXlsx(project.id);
        expect(xlsxRes.status).toBe(200);
        const { sheets } = assertValidXlsxBuffer(xlsxRes.buffer, EXPECTED_REPORTING_TABS);
        const talentText = sheets["Influence par Talent"].map((r) => r.join(" ")).join("\n");
        expect(talentText).not.toContain("245000");
      }
    });

    test("T2-F22-03 Blank verbatim quote rejected and duplicate identical verbatim deduplicated or rejected", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F22DupVerb"
      );

      const blankRes = await api.createVerbatim(project.id, {
        authorHandle: "@blank_user",
        platform: "TIKTOK",
        quote: "   ",
        likesCount: 10,
        selectedForSlides: true,
      });
      expect([400, 422]).toContain(blankRes.status);

      const vPayload = PILOT_VERBATIMS[0];
      const first = await api.createVerbatim(project.id, vPayload);
      expect([200, 201]).toContain(first.status);

      const duplicate = await api.createVerbatim(project.id, vPayload);
      expect([200, 201, 400, 409]).toContain(duplicate.status);

      const listed = await api.listVerbatims(project.id);
      expect(listed.status).toBe(200);
      const matching = listed.data.filter((v) => v.authorHandle === vPayload.authorHandle);
      expect(matching.length).toBe(1);
    });

    test("T2-F22-04 XML-reserved characters, French accents, and emojis survive .xlsx export intact", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F22XmlEscape"
      );

      const trickyQuote =
        'Super map Caisse d\'Épargne & GO <Fortnite> "Top 1" \'2026\' 🔥 éèêàç';
      const trickyHandle = "@xml_&_émoji_test";
      const vRes = await api.createVerbatim(project.id, {
        authorHandle: trickyHandle,
        platform: "TIKTOK",
        talentName: "Kalut & Co",
        quote: trickyQuote,
        likesCount: 77,
        selectedForSlides: true,
      });
      expect([200, 201]).toContain(vRes.status);

      const consRes = await api.consolidateReporting(project.id);
      expect([200, 201]).toContain(consRes.status);

      const xlsxRes = await api.exportReportingXlsx(project.id);
      expect(xlsxRes.status).toBe(200);
      const { sheets } = assertValidXlsxBuffer(xlsxRes.buffer, EXPECTED_REPORTING_TABS);

      const verbatimText = sheets["Verbatims"].map((r) => r.join(" | ")).join("\n");
      expect(verbatimText).toContain(trickyHandle);
      expect(verbatimText).toContain("& GO <Fortnite>");
      expect(verbatimText).toContain("éèêàç");
      expect(verbatimText).toContain("🔥");
    });

    test("T2-F22-06 Consolidation never mutates PROD Reporting Sheet 1C136EAzwoOUJI1DypSzBjr-vO6riZk3ncRKbI_9XAY0", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F22ProdGuard",
        ["Kalut"]
      );

      await api.uploadFortniteReport(project.id, {
        name: "fortnite_prod_guard.csv",
        mimeType: "text/csv",
        buffer: FORTNITE_CREATOR_CSV_BUFFER,
      });
      await api.harness.resetCalls();

      const consRes = await api.consolidateReporting(project.id);
      expect([200, 201]).toContain(consRes.status);

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);
      const audit = await api.listAuditLogs(project.id);
      assertProdUntouched(audit.data);

      const forbiddenCalls = calls.data.filter(
        (c) =>
          String(c.targetId ?? c.spreadsheetId ?? "") === PROD_IDS.PROD_REPORTING_SHEET &&
          /update|append|write|delete|batch/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(forbiddenCalls).toEqual([]);
    });
  });

  // ===========================================================================
  // F23 Boundaries (5 connected tests here + 1 in 412 serial group = 6)
  // ===========================================================================
  test.describe("Tier 2 — F23 Boundaries: Slides Generation & [EXT] Publish Gate", () => {
    test("T2-F23-01 [EXT] publish blocked when 006.3 is BROUILLON_INTERNE, EN_REVUE, or confirmValidation=false", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F23Gate"
      );

      await api.uploadFortniteReport(project.id, {
        name: "fortnite_gate.csv",
        mimeType: "text/csv",
        buffer: FORTNITE_CREATOR_CSV_BUFFER,
      });
      await api.consolidateReporting(project.id);

      const genRes = await api.generateReportingSlides(project.id);
      expect([200, 201]).toContain(genRes.status);
      const slidesFileId = String(genRes.data.slidesFileId ?? "");

      const tree1 = await api.getDriveTree(project.id);
      const node0063 = findReportingSlidesNode(tree1.data, slidesFileId) as DriveNodeDto;
      expect(node0063).toBeDefined();

      // Draft status -> blocked
      await api.updateDriveNode(project.id, node0063.id, {
        validationStatus: "BROUILLON_INTERNE",
      });
      const draftPub = await api.publishReportingExt(project.id, { confirmValidation: true });
      expect([400, 403, 409]).toContain(draftPub.status);
      expect(draftPub.ok).toBe(false);

      // In Review -> blocked
      await api.updateDriveNode(project.id, node0063.id, { validationStatus: "EN_REVUE" });
      const reviewPub = await api.publishReportingExt(project.id, { confirmValidation: true });
      expect([400, 403, 409]).toContain(reviewPub.status);
      expect(reviewPub.ok).toBe(false);

      // Validé Client but confirmValidation: false -> blocked
      await api.updateDriveNode(project.id, node0063.id, { validationStatus: "VALIDE_CLIENT" });
      const unconfirmedPub = await api.publishReportingExt(project.id, {
        confirmValidation: false,
      });
      expect([400, 403, 409]).toContain(unconfirmedPub.status);
      expect(unconfirmedPub.ok).toBe(false);

      const treeAfter = await api.getDriveTree(project.id);
      const nodeAfter = findReportingSlidesNode(treeAfter.data, slidesFileId);
      expect(nodeAfter?.extMirrorFileId ?? null).toBeFalsy();
    });

    test("T2-F23-03 Slide generation with 0 talents succeeds cleanly with zero cumulative KPIs and no NaN/500", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F23ZeroTalents"
      );

      await api.uploadFortniteReport(project.id, {
        name: "fortnite_only.csv",
        mimeType: "text/csv",
        buffer: FORTNITE_CREATOR_CSV_BUFFER,
      });
      await api.consolidateReporting(project.id);

      const slidesRes = await api.generateReportingSlides(project.id);
      expect([200, 201]).toContain(slidesRes.status);
      const serialized = JSON.stringify(slidesRes.data);
      expect(serialized).not.toMatch(/\bNaN\b|\bInfinity\b/);

      const slidesArray = toRecordArray(
        slidesRes.data.slides ?? slidesRes.data.slidesSummary ?? slidesRes.data.pages
      );
      const talentSlides = slidesArray.filter((s) =>
        /Contenus\s*-/i.test(`${String(s.title ?? "")} ${String(s.type ?? "")}`)
      );
      expect(talentSlides.length).toBe(0);
    });

    test("T2-F23-04 Long verbatims (>500 chars) and >6 selected verbatims succeed while excluding unselected quotes", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F23LongVerb"
      );

      const longQuote = `Incroyable map Fortnite Caisse d'Épargne ! ${"A".repeat(520)} fin.`;
      const longRes = await api.createVerbatim(project.id, {
        authorHandle: "@long_author_0",
        platform: "TIKTOK",
        quote: longQuote,
        likesCount: 500,
        selectedForSlides: true,
      });
      expect([200, 201]).toContain(longRes.status);

      for (let i = 1; i <= 7; i += 1) {
        const res = await api.createVerbatim(project.id, {
          authorHandle: `@selected_user_${i}`,
          platform: "INSTAGRAM",
          quote: `Super expérience numéro ${i}`,
          likesCount: 100 + i,
          selectedForSlides: true,
        });
        expect([200, 201]).toContain(res.status);
      }

      const excludedRes = await api.createVerbatim(project.id, {
        authorHandle: "@excluded_secret_handle",
        platform: "SNAPCHAT",
        quote: "Commentaire interne non sélectionné pour les slides",
        likesCount: 5,
        selectedForSlides: false,
      });
      expect([200, 201]).toContain(excludedRes.status);

      await api.consolidateReporting(project.id);
      const slidesRes = await api.generateReportingSlides(project.id);
      expect([200, 201]).toContain(slidesRes.status);

      const serialized = JSON.stringify(slidesRes.data);
      expect(serialized).not.toContain("@excluded_secret_handle");
      expect(serialized).not.toContain("Commentaire interne non sélectionné");
    });

    test("T2-F23-05 PROD Reporting Slides 1969-5uTXrKOlfOnEcYDfANfvl4trkn9wQNVPFJEckRU is never mutated", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F23ProdSlides"
      );

      await api.uploadFortniteReport(project.id, {
        name: "fortnite_prod_slides.csv",
        mimeType: "text/csv",
        buffer: FORTNITE_CREATOR_CSV_BUFFER,
      });
      await api.consolidateReporting(project.id);
      await api.harness.resetCalls();

      const genRes = await api.generateReportingSlides(project.id);
      expect([200, 201]).toContain(genRes.status);
      const slidesFileId = String(genRes.data.slidesFileId ?? "");
      expect(slidesFileId).not.toBe(PROD_IDS.PROD_REPORTING_SLIDES);

      const tree = await api.getDriveTree(project.id);
      const node0063 = findReportingSlidesNode(tree.data, slidesFileId) as DriveNodeDto;
      await api.updateDriveNode(project.id, node0063.id, { validationStatus: "VALIDE_CLIENT" });
      await api.publishReportingExt(project.id, { confirmValidation: true });

      const calls = await api.harness.getCalls();
      assertProdUntouched(calls.data);
      const prodSlidesMutations = calls.data.filter(
        (c) =>
          String(c.targetId ?? c.presentationId ?? "") === PROD_IDS.PROD_REPORTING_SLIDES &&
          /update|batch|delete|move|patch|write/i.test(String(c.operation ?? c.method ?? ""))
      );
      expect(prodSlidesMutations).toEqual([]);
    });

    test("T2-F23-06 publish-ext before any Slides deck exists in 006.3 fails cleanly without orphan EXT files", async ({
      request,
    }, testInfo) => {
      const api = createApiClient(request);
      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F23NoDeck"
      );

      const pubRes = await api.publishReportingExt(project.id, { confirmValidation: true });
      expect([400, 404, 409]).toContain(pubRes.status);
      expect(pubRes.ok).toBe(false);

      const treeAfter = await api.getDriveTree(project.id);
      const extReportingNodes = treeAfter.data.filter(
        (n) => n.code.startsWith("006.3") && Boolean(n.extMirrorFileId)
      );
      expect(extReportingNodes).toEqual([]);
    });
  });
});

// =============================================================================
// Serial Unconfigured Preconditions (412) Isolated Group (4 tests: 1 per F20–F23)
// =============================================================================
test.describe.serial("Tier 2 — Reporting Unconfigured Preconditions (412)", () => {
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

  test("T2-F20-06 Unknown projectId returns 404 and unconfigured Google Drive returns 412 on Fortnite upload", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const created = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "F20 412 Client",
      nomJeu: "Fortnite 412",
      isSandbox: true,
    });
    expect(created.status).toBe(201);

    const res412 = await api.uploadFortniteReport(created.data.id, {
      name: "fortnite_unconfigured.csv",
      mimeType: "text/csv",
      buffer: FORTNITE_CREATOR_CSV_BUFFER,
    });
    assertPreconditionMissing(res412, "GOOGLE_NOT_CONNECTED");

    try {
      await api.harness.restoreConfigured();
      const res404 = await api.uploadFortniteReport("nonexistent-reporting-project-999", {
        name: "fortnite_unknown_proj.csv",
        mimeType: "text/csv",
        buffer: FORTNITE_CREATOR_CSV_BUFFER,
      });
      expect(res404.status).toBe(404);
    } finally {
      await api.harness.setUnconfigured({ google: true, gemini: true });
    }
  });

  test("T2-F21-01 Missing GEMINI_API_KEY returns 412 GEMINI_KEY_MISSING with zero dummy Influence metrics", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    try {
      await api.harness.setState({
        googleConnected: true,
        googleClientConfigured: true,
        geminiConfigured: false,
      });

      const { project } = await createProvisionedReportingProject(
        api,
        testInfo.workerIndex,
        "F21NoGemini",
        ["Kalut"]
      );
      const kalut = PILOT_INFLUENCE_SCREENSHOTS[0];

      const res = await api.uploadInfluenceScreenshot(
        project.id,
        { name: kalut.filename, mimeType: kalut.mimeType, buffer: kalut.buffer },
        { talentName: kalut.talentName, platform: kalut.platform }
      );
      assertPreconditionMissing(res, "GEMINI_KEY_MISSING");

      const after = await api.getInfluenceReporting(project.id);
      expect(after.status).toBe(200);
      expect(extractInfluenceMetrics(after.data)).toEqual([]);
    } finally {
      await api.harness.setUnconfigured({ google: true, gemini: true });
    }
  });

  test("T2-F22-05 Unconfigured Google OAuth2 returns 412 GOOGLE_NOT_CONNECTED on consolidateReporting", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const created = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "F22 412 Client",
      nomJeu: "Fortnite 412",
      isSandbox: true,
    });
    expect(created.status).toBe(201);

    const res = await api.consolidateReporting(created.data.id);
    assertPreconditionMissing(res, "GOOGLE_NOT_CONNECTED");
  });

  test("T2-F23-02 Unconfigured Google OAuth2 returns 412 GOOGLE_NOT_CONNECTED on generate-slides and publish-ext", async ({
    request,
  }, testInfo) => {
    const api = createApiClient(request);
    const created = await api.createProject({
      codeProjet: uniqueTestCp(testInfo.workerIndex),
      client: "F23 412 Client",
      nomJeu: "Fortnite 412",
      isSandbox: true,
    });
    expect(created.status).toBe(201);

    const genRes = await api.generateReportingSlides(created.data.id);
    assertPreconditionMissing(genRes, "GOOGLE_NOT_CONNECTED");

    const pubRes = await api.publishReportingExt(created.data.id, { confirmValidation: true });
    assertPreconditionMissing(pubRes, "GOOGLE_NOT_CONNECTED");
  });
});
