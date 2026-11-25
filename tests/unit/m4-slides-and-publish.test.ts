import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateDriveNodeStatus } from "@/lib/drive/sync-service";
import {
  PILOT_SANDBOX_CONFIG,
  provisionProjectTree,
  provisionTalentFolders,
} from "@/lib/drive/tree-service";
import {
  generateReportingSlides,
  publishReportingToExternal,
} from "@/lib/reporting/slides-generator";
import { SLIDES_DIMENSIONS_EMU } from "@/lib/reporting/types";
import { createInMemoryGoogleDouble } from "../doubles/in-memory-google";

describe("M4 Branded Slides Generator (006.3) & [EXT] Publish Gate", () => {
  let tempDir: string;
  let prisma: PrismaClient;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-m4-slides-test-"));
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

  afterAll(async () => {
    await prisma.$disconnect();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("generates 0 talent slides when 0 talents exist and respects 16:9 EMU & selected-only verbatims", async () => {
    const google = createInMemoryGoogleDouble();
    const project = await prisma.project.create({
      data: {
        codeProjet: "326095",
        client: "Zero Talent Client",
        nomJeu: "Fortnite Zero",
        isSandbox: true,
      },
    });
    await provisionProjectTree(prisma, google.drive, project.id);

    await prisma.verbatim.createMany({
      data: [
        {
          projectId: project.id,
          authorHandle: "@included_1",
          platform: "TIKTOK",
          quote: `Longue citation positive ${"A".repeat(520)}`,
          likesCount: 50,
          selectedForSlides: true,
        },
        {
          projectId: project.id,
          authorHandle: "@excluded_1",
          platform: "SNAPCHAT",
          quote: "Ne doit pas apparaître dans les slides",
          likesCount: 10,
          selectedForSlides: false,
        },
      ],
    });

    const res = await generateReportingSlides(prisma, google, project.id);
    expect(res.dimensionsEmu).toEqual(SLIDES_DIMENSIONS_EMU);
    expect(res.slidesFileId).not.toBe(
      PILOT_SANDBOX_CONFIG.prodTemplates.reportingTemplateSlidesId
    );
    expect(res.slides.filter((s) => s.type === "TALENT")).toHaveLength(0);

    const serialized = JSON.stringify(res);
    expect(serialized).not.toMatch(/\{\{[^}]+\}\}/);
    expect(serialized).toContain("@included_1");
    expect(serialized).not.toContain("@excluded_1");
    expect(serialized).not.toContain("Ne doit pas apparaître");
  });

  it("enforces VALIDE_CLIENT publish gate, detaches LINKED charts to NOT_LINKED_IMAGE, and preserves extMirrorFileId across regenerations", async () => {
    const google = createInMemoryGoogleDouble();
    const embedCalls: Array<{ linkingMode?: string; chartId: number }> = [];
    const batchCalls: Array<{ requests: Record<string, unknown>[] }> = [];

    // Spy on slides port while keeping sandbox-safe in-memory behavior
    google.slides.getPresentation = async () => ({
      slides: [
        {
          objectId: "slide_fn",
          pageElements: [
            {
              objectId: "chart_obj_1",
              sheetsChart: {
                spreadsheetId: "sheet_1",
                chartId: 77,
                linkingMode: "LINKED",
              },
            },
          ],
        },
      ],
    });
    google.slides.embedSheetsChart = async (params) => {
      embedCalls.push({
        linkingMode: params.linkingMode,
        chartId: params.chartId,
      });
    };
    google.slides.batchUpdate = async (params) => {
      batchCalls.push({ requests: params.requests });
      return {};
    };

    const project = await prisma.project.create({
      data: {
        codeProjet: "326096",
        client: "Caisse d'Épargne",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });
    await provisionProjectTree(prisma, google.drive, project.id);
    await provisionTalentFolders(prisma, google.drive, project.id, "Kalut");

    await prisma.influenceMetric.create({
      data: {
        projectId: project.id,
        talentName: "Kalut",
        platform: "TIKTOK",
        views: 245000,
        likes: 18400,
        comments: 420,
        shares: 1150,
        saves: 890,
        engagementRate: 8.51,
        verifiedByHuman: true,
      },
    });

    // Publish before deck exists -> 404
    await expect(
      publishReportingToExternal(prisma, google, project.id, {
        confirmValidation: true,
      })
    ).rejects.toMatchObject({ httpStatus: 404 });

    const gen1 = await generateReportingSlides(prisma, google, project.id);
    expect(gen1.slides.filter((s) => s.type === "TALENT")).toHaveLength(1);
    expect(JSON.stringify(gen1.slides)).toContain("Contenus - Kalut");
    expect(JSON.stringify(gen1.slides)).toContain("Chiffres cumulés");

    // Blocked when BROUILLON_INTERNE
    await expect(
      publishReportingToExternal(prisma, google, project.id, {
        confirmValidation: true,
      })
    ).rejects.toMatchObject({ httpStatus: 403 });

    // Blocked when confirmValidation is false even after VALIDE_CLIENT
    await updateDriveNodeStatus(prisma, {
      projectId: project.id,
      nodeId: gen1.nodeId,
      validationStatus: "VALIDE_CLIENT",
    });
    await expect(
      publishReportingToExternal(prisma, google, project.id, {
        confirmValidation: false,
      })
    ).rejects.toMatchObject({ httpStatus: 400 });

    const pub1 = await publishReportingToExternal(prisma, google, project.id, {
      confirmValidation: true,
    });
    expect(pub1.chartsLinkingMode).toBe("NOT_LINKED_IMAGE");
    expect(pub1.detachedChartsCount).toBe(1);
    expect(embedCalls.some((c) => c.linkingMode === "NOT_LINKED_IMAGE")).toBe(
      true
    );
    expect(
      batchCalls.some((b) =>
        JSON.stringify(b.requests).includes("deleteObject")
      )
    ).toBe(true);

    // Regenerate deck -> extMirrorFileId preserved and updated in-place on re-publish
    const gen2 = await generateReportingSlides(prisma, google, project.id);
    expect(gen2.nodeId).toBe(gen1.nodeId);

    const pub2 = await publishReportingToExternal(prisma, google, project.id, {
      confirmValidation: true,
    });
    expect(pub2.extMirrorFileId).toBe(pub1.extMirrorFileId);
    expect(pub2.method).toBe("files.update");
  });
});
