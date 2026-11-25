import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncProjectToExternal, updateDriveNodeStatus } from "@/lib/drive/sync-service";
import { provisionProjectTree } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import { PROD_IMMUTABLE_IDS } from "@/lib/google/sandbox-guard";
import type { GoogleWorkspacePort, SheetsPort } from "@/lib/ports";
import {
  createRetroTask,
  deleteRetroTask,
  syncSheetToDb,
  updateRetroTask,
} from "@/lib/retroplanning/retro-service";
import {
  parseParSemaineGridData,
  parseParSemaineValues,
  readTasksFromRetroSheet,
  writeTaskToRetroSheet,
} from "@/lib/retroplanning/sheet-codec";
import { createInMemoryGoogleDouble } from "../doubles/in-memory-google";

function makeStatefulSheetsDouble(): {
  sheets: SheetsPort;
  valuesByRange: Map<string, unknown[][]>;
  updateCalls: Array<{ range: string; values: unknown[][] }>;
  appendCalls: Array<{ range: string; values: unknown[][] }>;
  clearCalled: boolean;
} {
  const valuesByRange = new Map<string, unknown[][]>();
  const updateCalls: Array<{ range: string; values: unknown[][] }> = [];
  const appendCalls: Array<{ range: string; values: unknown[][] }> = [];
  const sheetRows: unknown[][] = [];

  const state = {
    clearCalled: false,
    valuesByRange,
    updateCalls,
    appendCalls,
    sheets: {
      async getSpreadsheet() {
        return {
          sheets: [
            {
              properties: { title: "Par semaine", sheetId: 1925928995 },
            },
          ],
        };
      },
      async getValues() {
        return sheetRows.map((r) => [...r]);
      },
      async updateValues(params: { range: string; values: unknown[][] }) {
        updateCalls.push({ range: params.range, values: params.values });
        const m = /!A(\d+):/.exec(params.range);
        const startRow = m ? Number.parseInt(m[1], 10) : 2;
        for (let i = 0; i < params.values.length; i++) {
          sheetRows[startRow - 1 + i] = [...params.values[i]];
        }
      },
      async appendValues(params: { range: string; values: unknown[][] }) {
        appendCalls.push({ range: params.range, values: params.values });
        const m = /!A(\d+):/.exec(params.range);
        const startRow = m ? Number.parseInt(m[1], 10) : sheetRows.length + 1;
        for (let i = 0; i < params.values.length; i++) {
          sheetRows[startRow - 1 + i] = [...params.values[i]];
        }
      },
      async batchUpdate() {
        return {};
      },
      async updateCellNote() {},
      async addChart() {
        return { chartId: 1 };
      },
    } satisfies SheetsPort,
  };
  return state;
}

describe("M3 F15 — Retroplanning Sheet Codec, Bidirectional Sync, Concurrency & 002.1 Lock", () => {
  let tempDir: string;
  let prisma: PrismaClient;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-m3-retro-sync-"));
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

  it("parses rich PROD Par semaine gridData with sparse PHASES/ÉTAPES, color fills, and Row 7 date typos", () => {
    type TestCell = {
      formattedValue: string;
      effectiveFormat?: {
        backgroundColor?: { red?: number; green?: number; blue?: number };
      };
    };
    const buildCells = (count: number): TestCell[] =>
      Array.from({ length: count }, () => ({ formattedValue: "" }));

    const row5 = buildCells(145);
    const row6 = buildCells(145);
    const row7 = buildCells(145);

    row7[1] = { formattedValue: "PHASES" };
    row7[2] = { formattedValue: "ÉTAPES" };
    row7[3] = { formattedValue: "TACHES" };

    // SEMAINE 1 at col 4 (7-col block), SEMAINE 10 at col 67 (with PROD typo 24/07 au 30/08), SEMAINE 19 at col 130 (typo 26/10 au 01/10)
    row6[4] = { formattedValue: "SEMAINE 1" };
    row7[4] = { formattedValue: "22/06 au 28/06" };
    row6[67] = { formattedValue: "SEMAINE 10" };
    row7[67] = { formattedValue: "24/07 au 30/08" };
    row6[130] = { formattedValue: "SEMAINE 19" };
    row7[130] = { formattedValue: "26/10 au 01/10" };

    const taskRow1 = buildCells(145);
    taskRow1[1] = { formattedValue: "PRÉ PRODUCTION" };
    taskRow1[2] = { formattedValue: "CRÉATION DU GAMEPLAY" };
    taskRow1[3] = { formattedValue: "Concept document" };
    taskRow1[4] = {
      formattedValue: "",
      effectiveFormat: { backgroundColor: { red: 0.918, green: 0.82, blue: 0.863 } }, // #EAD1DC
    };

    // Sparse carry-forward row (blank PHASES & ÉTAPES) with dark blue #0B5394 and typo week S10
    const taskRow2 = buildCells(145);
    taskRow2[3] = { formattedValue: "Validation client gameplay" };
    taskRow2[67] = {
      formattedValue: "en cours",
      effectiveFormat: { backgroundColor: { red: 0.043, green: 0.325, blue: 0.58 } },
    };

    const rowData = [
      { values: buildCells(10) },
      { values: buildCells(10) },
      { values: buildCells(10) },
      { values: buildCells(10) },
      { values: buildCells(10) },
      { values: row5 },
      { values: row6 },
      { values: row7 },
      { values: taskRow1 },
      { values: taskRow2 },
    ];

    // Shift header rows to PROD positions (Row 6 = idx 5, Row 7 = idx 6)
    const prodRows = [
      { values: buildCells(10) },
      { values: buildCells(10) },
      { values: buildCells(10) },
      { values: buildCells(10) },
      { values: buildCells(10) },
      { values: row6 },
      { values: row7 },
      { values: taskRow1 },
      { values: taskRow2 },
    ];
    void rowData;

    const parsed = parseParSemaineGridData({
      sheets: [
        {
          properties: { title: "Par semaine", sheetId: 1925928995 },
          data: [{ rowData: prodRows }],
        },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed!.tasks).toHaveLength(2);
    expect(parsed!.tasks[0].phase).toBe("PRÉ PRODUCTION");
    expect(parsed!.tasks[0].startDate?.toISOString().slice(0, 10)).toBe("2026-06-22");
    expect(parsed!.tasks[1].phase).toBe("PRÉ PRODUCTION");
    expect(parsed!.tasks[1].etape).toBe("CRÉATION DU GAMEPLAY");
    expect(parsed!.tasks[1].status).toBe("EN_COURS");
    // S10 anchored from S1 (2026-06-22 + 9*7 = 2026-08-24), immune to "24/07 au 30/08" typo
    expect(parsed!.tasks[1].startDate?.toISOString().slice(0, 10)).toBe("2026-08-24");
  });

  it("parses compact value-grid sheets with 'x' week markers and explicit columns", () => {
    const rows = [
      ["PHASES", "ÉTAPES", "TACHES", "OWNER", "22/06 au 28/06", "29/06 au 05/07", "STATUT"],
      ["Phase 1", "Mapping", "Création map", "Louis", "x", "x", "EN_COURS"],
      ["", "", "QA map", "Hugo", "", "x", "A_FAIRE"],
    ];
    const parsed = parseParSemaineValues(rows);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].startDate?.toISOString().slice(0, 10)).toBe("2026-06-22");
    expect(parsed[0].endDate?.toISOString().slice(0, 10)).toBe("2026-07-05");
    expect(parsed[1].phase).toBe("Phase 1");
    expect(parsed[1].etape).toBe("Mapping");
    expect(parsed[1].status).toBe("A_FAIRE");
  });

  it("syncs bidirectionally with sandbox 002.1 Sheet, enforces 400/404/409, and never syncs 002.1 to [EXT]", async () => {
    const baseDouble = createInMemoryGoogleDouble();
    const stateful = makeStatefulSheetsDouble();
    const gateway: GoogleWorkspacePort = {
      ...baseDouble,
      sheets: stateful.sheets,
    };

    const project = await prisma.project.create({
      data: {
        codeProjet: "326701",
        client: "Test Retro",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });
    const projectOther = await prisma.project.create({
      data: {
        codeProjet: "326702",
        client: "Other Retro",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    await provisionProjectTree(prisma, gateway.drive, project.id);

    // 1. Validation rejects endDate < startDate and blank fields
    await expect(
      createRetroTask(
        prisma,
        project.id,
        {
          phase: "P1",
          etape: "E1",
          tache: "Invalid",
          startDate: "2026-09-10",
          endDate: "2026-09-01",
        },
        gateway
      )
    ).rejects.toThrow(AppHttpError);

    await expect(
      createRetroTask(
        prisma,
        project.id,
        { phase: "  ", etape: "E1", tache: "Blank phase" },
        gateway
      )
    ).rejects.toThrow(AppHttpError);

    // 2. Create task lazily provisions 002.1 Sheet copy in sandbox (never PROD) and writes forward
    const created = await createRetroTask(
      prisma,
      project.id,
      {
        phase: "Phase 1",
        etape: "Map",
        tache: "Build HUD v1",
        owner: "Louis",
        startDate: "2026-09-01",
        endDate: "2026-09-07",
        status: "A_FAIRE",
      },
      gateway
    );
    expect(created.sheetSynced).toBe(true);
    expect(stateful.clearCalled).toBe(false);

    const updatedProject = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    expect(updatedProject.retroplanningSheetId).toBeTruthy();
    expect(PROD_IMMUTABLE_IDS.has(updatedProject.retroplanningSheetId!)).toBe(false);

    // 3. Optimistic concurrency conflict (409) when expectedUpdatedAt is stale
    const staleExpected = new Date(
      created.task.updatedAt.getTime() - 10_000
    ).toISOString();
    const writesBeforeConflict = stateful.updateCalls.length;
    await expect(
      updateRetroTask(
        prisma,
        project.id,
        {
          id: created.task.id,
          status: "EN_COURS",
          expectedUpdatedAt: staleExpected,
        },
        gateway
      )
    ).rejects.toMatchObject({ httpStatus: 409, code: "STALE_TASK_CONFLICT" });
    expect(stateful.updateCalls.length).toBe(writesBeforeConflict);

    // 4. Valid update writes forward to Sheet (preserving Row 1)
    const updated = await updateRetroTask(
      prisma,
      project.id,
      {
        id: created.task.id,
        status: "EN_COURS",
        endDate: "2026-09-12",
        expectedUpdatedAt: created.task.updatedAt.toISOString(),
      },
      gateway
    );
    expect(updated.task.status).toBe("EN_COURS");
    expect(
      stateful.updateCalls.every((c) => !/(?:^|!)[A-Z]*1:[A-Z]*1$/.test(c.range))
    ).toBe(true);

    // 5. Cross-project IDOR rejected with 404
    await expect(
      updateRetroTask(
        prisma,
        projectOther.id,
        { id: created.task.id, status: "TERMINE" },
        gateway
      )
    ).rejects.toMatchObject({ httpStatus: 404 });

    // 6. Reverse sync from Sheet imports row updates back to DB
    await stateful.sheets.updateValues({
      spreadsheetId: updatedProject.retroplanningSheetId!,
      range: `'Par semaine'!A3:J3`,
      values: [
        [
          created.task.id,
          "Phase 1",
          "Map",
          "Build HUD v1",
          "Louis",
          "2026-09-01",
          "2026-09-14",
          "TERMINE",
          "NON",
          "",
        ],
      ],
    });
    const reverse = await syncSheetToDb(prisma, gateway, project.id);
    const refreshed = reverse.tasks.find((t) => t.id === created.task.id);
    expect(refreshed?.status).toBe("TERMINE");
    expect(refreshed?.endDate?.toISOString().slice(0, 10)).toBe("2026-09-14");

    // 7. 002.1 node marked VALIDE_CLIENT can NEVER permanently sync to [EXT]
    const node0021Sheet = await prisma.driveNode.findFirstOrThrow({
      where: { projectId: project.id, code: "002.1.sheet" },
    });
    await expect(
      updateDriveNodeStatus(prisma, {
        projectId: project.id,
        nodeId: node0021Sheet.id,
        validationStatus: "VALIDE_CLIENT",
        allowPermanentExtSync: true,
      })
    ).rejects.toMatchObject({ httpStatus: 403 });

    await updateDriveNodeStatus(prisma, {
      projectId: project.id,
      nodeId: node0021Sheet.id,
      validationStatus: "VALIDE_CLIENT",
    });
    const extSync = await syncProjectToExternal(prisma, gateway.drive, project.id);
    expect(
      extSync.syncedNodes.some((n) => n.code.startsWith("002.1"))
    ).toBe(false);

    // 8. Delete task scoped to project
    await deleteRetroTask(prisma, project.id, created.task.id);
    const remaining = await prisma.retroTask.count({
      where: { projectId: project.id },
    });
    expect(remaining).toBe(0);
  });

  it("preserves TERMINE, EN_COURS, EN_ATTENTE_CLIENT, and A_FAIRE on PROD-layout round-trip (without STATUT column)", async () => {
    const prodSheetRows: unknown[][] = [
      [],
      [],
      [],
      [],
      [],
      ["", "", "", "", "SEMAINE 1", "", "", "", "", "", ""],
      ["", "PHASES", "ÉTAPES", "TACHES", "22/06 au 28/06", "", "", "", "", "", ""],
    ];

    const prodSheets: SheetsPort = {
      async getSpreadsheet() {
        return {
          sheets: [{ properties: { title: "Par semaine", sheetId: 1925928995 } }],
        };
      },
      async getValues() {
        return prodSheetRows.map((r) => [...r]);
      },
      async updateValues(params) {
        const m = /!A(\d+):/.exec(params.range);
        const startRow = m ? Number.parseInt(m[1], 10) : 1;
        for (let i = 0; i < params.values.length; i++) {
          prodSheetRows[startRow - 1 + i] = [...params.values[i]];
        }
      },
      async appendValues(params) {
        const m = /!A(\d+):/.exec(params.range);
        const startRow = m ? Number.parseInt(m[1], 10) : prodSheetRows.length + 1;
        for (let i = 0; i < params.values.length; i++) {
          prodSheetRows[startRow - 1 + i] = [...params.values[i]];
        }
      },
      async batchUpdate() {
        return {};
      },
      async updateCellNote() {},
      async addChart() {
        return { chartId: 1 };
      },
    };

    const statuses = [
      "TERMINE",
      "EN_COURS",
      "EN_ATTENTE_CLIENT",
      "A_FAIRE",
    ] as const;
    const now = new Date();
    for (let i = 0; i < statuses.length; i++) {
      const st = statuses[i];
      await writeTaskToRetroSheet(prodSheets, "sbx_prod_layout_sheet", {
        id: `t_${st}`,
        projectId: "proj_1",
        phase: "Phase 1",
        etape: "Mapping",
        tache: `Tache ${st}`,
        owner: null,
        startDate: new Date(Date.UTC(2026, 5, 22, 12, 0, 0)),
        endDate: new Date(Date.UTC(2026, 5, 26, 12, 0, 0)),
        status: st,
        sheetRowIndex: null,
        isMilestone: false,
        milestoneType: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 1. Values fallback path (parseParSemaineValues)
    const readBack = await readTasksFromRetroSheet(prodSheets, "sbx_prod_layout_sheet");
    expect(readBack.tasks).toHaveLength(4);
    for (const st of statuses) {
      const found = readBack.tasks.find((t) => t.tache === `Tache ${st}`);
      expect(found?.status).toBe(st);
    }

    // 2. GridData path (parseParSemaineGridData) with #93C47D fill and trailing (...) annotations
    const gridRows = [
      { values: [] },
      { values: [] },
      { values: [] },
      { values: [] },
      { values: [] },
      {
        values: [
          { formattedValue: "" },
          { formattedValue: "" },
          { formattedValue: "" },
          { formattedValue: "" },
          { formattedValue: "SEMAINE 1" },
        ],
      },
      {
        values: [
          { formattedValue: "" },
          { formattedValue: "PHASES" },
          { formattedValue: "ÉTAPES" },
          { formattedValue: "TACHES" },
          { formattedValue: "22/06 au 28/06" },
        ],
      },
      {
        values: [
          { formattedValue: "" },
          { formattedValue: "Phase 1" },
          { formattedValue: "Map" },
          { formattedValue: "Grid Green Only" },
          {
            formattedValue: "x",
            effectiveFormat: {
              backgroundColor: { red: 0.576, green: 0.769, blue: 0.49 }, // #93C47D
            },
          },
        ],
      },
      {
        values: [
          { formattedValue: "" },
          { formattedValue: "Phase 1" },
          { formattedValue: "Map" },
          { formattedValue: "Grid Annotated EN_COURS" },
          {
            formattedValue: "EN_COURS (2026-06-22 -> 2026-06-26)",
            effectiveFormat: {
              backgroundColor: { red: 0.918, green: 0.82, blue: 0.863 },
            },
          },
        ],
      },
      {
        values: [
          { formattedValue: "" },
          { formattedValue: "Phase 1" },
          { formattedValue: "Map" },
          { formattedValue: "Grid Annotated TERMINE" },
          {
            formattedValue: "TERMINE (2026-06-22 -> 2026-06-26)",
            effectiveFormat: {
              backgroundColor: { red: 0.576, green: 0.769, blue: 0.49 },
            },
          },
        ],
      },
    ];

    const parsedGrid = parseParSemaineGridData({
      sheets: [
        {
          properties: { title: "Par semaine", sheetId: 1925928995 },
          data: [{ rowData: gridRows }],
        },
      ],
    });
    expect(parsedGrid).not.toBeNull();
    expect(parsedGrid!.tasks[0].status).toBe("TERMINE");
    expect(parsedGrid!.tasks[1].status).toBe("EN_COURS");
    expect(parsedGrid!.tasks[2].status).toBe("TERMINE");
  });
});
