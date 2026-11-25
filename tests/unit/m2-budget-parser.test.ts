import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBudgetXlsxBuffer } from "@/lib/budget/parser";
import {
  importBudgetFromSheetCopy,
  importBudgetFromXlsx,
  syncBudgetFromAttachedSheet,
} from "@/lib/budget/service";
import { PILOT_SANDBOX_CONFIG } from "@/lib/drive/tree-service";
import { AppHttpError, PreconditionError } from "@/lib/errors";
import { createInMemoryGoogleDouble } from "../doubles/in-memory-google";

async function buildProdLikeXlsxBuffer(opts?: {
  shiftRows?: boolean;
  includeStaleVue?: boolean;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  if (opts?.includeStaleVue !== false) {
    const vue = wb.addWorksheet("Vue d'ensemble");
    vue.getCell("C2").value = "Cristaline x Fortnite";
    vue.getCell("C3").value = "Année : 2026";
    vue.getCell("C4").value = "Code projet :";
    vue.getCell("D4").value = "";
  }

  const ws = wb.addWorksheet("Postes de dépenses");
  const offset = opts?.shiftRows ? -3 : 0;
  const rBanner = 8 + offset;
  const rCat1 = 9 + offset;
  const rHead1 = 11 + offset;
  const rLine1 = 12 + offset;
  const rLine2 = 13 + offset;
  const rCat2 = 15 + offset;
  const rHead2 = 16 + offset;
  const rLine3 = 17 + offset;
  const rOrphan = 18 + offset;

  ws.getCell(rBanner, 1).value = "Prix de vente";
  ws.mergeCells(rBanner, 1, rBanner, 8);
  ws.getCell(rBanner, 10).value = "Couts réels pré-opération";
  ws.getCell(rBanner, 16).value = "Couts réels post-opération";

  // Category 1 (merged C:H)
  ws.getCell(rCat1, 3).value = "PRODUCTION";
  ws.mergeCells(rCat1, 3, rCat1, 8);
  ws.getCell(rCat1, 10).value = "TOTAL";
  ws.getCell(rCat1, 12).value = { formula: `SUM(L${rLine1}:L${rLine2})`, result: 11250.5 };
  ws.getCell(rCat1, 16).value = "TOTAL";

  const writeHeaders = (rowNum: number) => {
    ws.getCell(rowNum, 3).value = "Objet";
    ws.getCell(rowNum, 4).value = "Réalisé par";
    ws.getCell(rowNum, 5).value = "Quantité";
    ws.getCell(rowNum, 6).value = "Jours";
    ws.getCell(rowNum, 7).value = "Coût/unité (€)";
    ws.getCell(rowNum, 8).value = "Prix (€)";
    ws.getCell(rowNum, 10).value = "Type de dépenses";
    ws.getCell(rowNum, 11).value = "Coût réel/u (€)";
    ws.getCell(rowNum, 12).value = "Coût réel (€)";
    ws.getCell(rowNum, 16).value = "Qté";
    ws.getCell(rowNum, 17).value = "Jours";
    ws.getCell(rowNum, 18).value = "Coût réel/u (€)";
    ws.getCell(rowNum, 19).value = "Coût réel (€)";
  };

  writeHeaders(rHead1);

  // Line 1: French formatted number + { formula, result }
  ws.getCell(rLine1, 3).value = "Développement Map Fortnite";
  ws.getCell(rLine1, 4).value = "Studio Alpha";
  ws.getCell(rLine1, 5).value = 1;
  ws.getCell(rLine1, 6).value = 10;
  ws.getCell(rLine1, 7).value = "1 500,00 €";
  ws.getCell(rLine1, 8).value = { formula: `E${rLine1}*F${rLine1}*G${rLine1}`, result: 15000 };
  ws.getCell(rLine1, 10).value = "Externe";
  ws.getCell(rLine1, 11).value = "1 000,00 €";
  ws.getCell(rLine1, 12).value = { formula: `K${rLine1}*E${rLine1}*F${rLine1}`, result: 10000 };
  ws.getCell(rLine1, 16).value = 1;
  ws.getCell(rLine1, 17).value = 1;
  ws.getCell(rLine1, 18).value = "1 250,50 €";
  ws.getCell(rLine1, 19).value = { formula: `P${rLine1}*Q${rLine1}*R${rLine1}` }; // unevaluated formula!

  // Line 2: Unevaluated formula E*F*G & RH Internes
  ws.getCell(rLine2, 3).value = "Chefferie de projet";
  ws.getCell(rLine2, 4).value = "Hugo";
  ws.getCell(rLine2, 5).value = 1;
  ws.getCell(rLine2, 6).value = 5;
  ws.getCell(rLine2, 7).value = 500;
  ws.getCell(rLine2, 8).value = { formula: `E${rLine2}*F${rLine2}*G${rLine2}` };
  ws.getCell(rLine2, 10).value = "RH Internes";
  ws.getCell(rLine2, 11).value = 250.1;
  ws.getCell(rLine2, 12).value = { formula: `K${rLine2}*E${rLine2}*F${rLine2}` };
  ws.getCell(rLine2, 16).value = 0;
  ws.getCell(rLine2, 17).value = 0;
  ws.getCell(rLine2, 18).value = 0;
  ws.getCell(rLine2, 19).value = 0;

  // Category 2 + repeated header + zero pre-op line (Visuels Print R24) + orphan blank-Objet row (R77)
  ws.getCell(rCat2, 3).value = "COMMUNICATION";
  ws.getCell(rCat2, 10).value = "TOTAL";
  ws.getCell(rCat2, 16).value = "TOTAL";
  writeHeaders(rHead2);

  ws.getCell(rLine3, 3).value = "Visuels Print";
  ws.getCell(rLine3, 4).value = "Imprimeur";
  ws.getCell(rLine3, 5).value = 1;
  ws.getCell(rLine3, 6).value = 1;
  ws.getCell(rLine3, 7).value = 0;
  ws.getCell(rLine3, 8).value = 50000; // Fixed-price override like R65
  ws.getCell(rLine3, 10).value = "Externe";
  ws.getCell(rLine3, 11).value = 0;
  ws.getCell(rLine3, 12).value = 0;
  ws.getCell(rLine3, 16).value = 1;
  ws.getCell(rLine3, 17).value = 1;
  ws.getCell(rLine3, 18).value = 2671.5;
  ws.getCell(rLine3, 19).value = 2671.5;

  // Orphan row with blank Objet (like R77)
  ws.getCell(rOrphan, 3).value = "";
  ws.getCell(rOrphan, 10).value = "Externe";
  ws.getCell(rOrphan, 11).value = 1500;
  ws.getCell(rOrphan, 12).value = 0;

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe("M2 Budget 3-Block Parser & Sheet Import Service", () => {
  let tempDir: string;
  let prisma: PrismaClient;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-m2-parser-"));
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

  it("parses PROD-like 3-block .xlsx with formulas, French numbers, merged category headers, zero pre-op, orphan row skip, and stale header warning", async () => {
    const buffer = await buildProdLikeXlsxBuffer({ includeStaleVue: true });
    const parsed = await parseBudgetXlsxBuffer(buffer, {
      codeProjet: "326027",
      client: "Caisse d'Épargne",
      nomJeu: "Fortnite",
    });

    expect(parsed.lines).toHaveLength(3);
    expect(parsed.lines[0]).toMatchObject({
      category: "PRODUCTION",
      objet: "Développement Map Fortnite",
      expenseType: "Externe",
      saleTotalHt: 15000,
      preOpTotalHt: 10000,
      postOpTotalHt: 1250.5,
      sheetRowIndex: 12,
    });
    expect(parsed.lines[1]).toMatchObject({
      category: "PRODUCTION",
      objet: "Chefferie de projet",
      expenseType: "RH Internes",
      saleTotalHt: 2500,
      preOpTotalHt: 1250.5,
      postOpTotalHt: 0,
      sheetRowIndex: 13,
    });
    expect(parsed.lines[2]).toMatchObject({
      category: "COMMUNICATION",
      objet: "Visuels Print",
      saleTotalHt: 50000,
      preOpTotalHt: 0,
      postOpTotalHt: 2671.5,
      sheetRowIndex: 17,
    });
    expect(parsed.warnings.some((w) => w.includes("Vue d'ensemble"))).toBe(true);
    expect(parsed.warnings.some((w) => w.includes("Cristaline"))).toBe(true);
  });

  it("handles shifted banner and header rows cleanly", async () => {
    const buffer = await buildProdLikeXlsxBuffer({ shiftRows: true });
    const parsed = await parseBudgetXlsxBuffer(buffer);
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.layout.bannerRowIndex).toBe(4); // Row 5 -> 0-based 4
    expect(parsed.layout.headerRowIndex).toBe(7); // Row 8 -> 0-based 7
    expect(parsed.lines[0].sheetRowIndex).toBe(9);
  });

  it("rejects malformed/corrupt .xlsx and missing 3-block structure with 422", async () => {
    await expect(
      parseBudgetXlsxBuffer(Buffer.from("not-an-xlsx-file"))
    ).rejects.toThrow(AppHttpError);

    try {
      await parseBudgetXlsxBuffer(Buffer.from("PK\x03\x04corrupt_zip_content"));
    } catch (err) {
      expect((err as AppHttpError).httpStatus).toBe(422);
    }

    const badWb = new ExcelJS.Workbook();
    const ws = badWb.addWorksheet("AutreOnglet");
    ws.getCell("A1").value = "Pas de budget";
    const badBuf = Buffer.from(await badWb.xlsx.writeBuffer());
    await expect(parseBudgetXlsxBuffer(badBuf)).rejects.toMatchObject({
      httpStatus: 422,
      code: "INVALID_BUDGET_STRUCTURE",
    });
  });

  it("enforces 412 before DB writes, uploads .xlsx with conversion to 001.1, copies PROD sheet via SandboxGuard, and reconciles BudgetLine IDs", async () => {
    await prisma.project.deleteMany({ where: { codeProjet: "326027" } });
    const project = await prisma.project.create({
      data: {
        codeProjet: "326027",
        client: "Caisse d'Épargne",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    const buffer = await buildProdLikeXlsxBuffer();

    // 412 precondition check leaves zero DB writes
    await expect(
      importBudgetFromXlsx({
        prisma,
        getGoogleGateway: async () => {
          throw new PreconditionError("GOOGLE_NOT_CONNECTED", "Not connected");
        },
        projectId: project.id,
        buffer,
        filename: "budget_ce.xlsx",
      })
    ).rejects.toThrow(PreconditionError);
    expect(
      await prisma.budgetLine.count({ where: { projectId: project.id } })
    ).toBe(0);

    // Connected Google double
    const gateway = createInMemoryGoogleDouble();
    const createCallsWithSourceMime: Array<{
      mimeType: string;
      sourceMimeType?: string;
    }> = [];
    const origCreateFile = gateway.drive.createFile.bind(gateway.drive);
    gateway.drive.createFile = async (p: {
      name: string;
      parentId: string;
      mimeType: string;
      body: Buffer | string;
      sourceMimeType?: string;
    }) => {
      createCallsWithSourceMime.push({
        mimeType: p.mimeType,
        sourceMimeType: p.sourceMimeType,
      });
      return origCreateFile(p);
    };

    const updatedMatrices: unknown[][][] = [];
    gateway.sheets.updateValues = async (p) => {
      updatedMatrices.push(p.values);
    };

    const res = await importBudgetFromXlsx({
      prisma,
      getGoogleGateway: async () => gateway,
      projectId: project.id,
      buffer,
      filename: "Budget_CE_2026.xlsx",
    });

    expect(res.ok).toBe(true);
    expect(res.lines).toHaveLength(3);
    expect(createCallsWithSourceMime[0]).toEqual({
      mimeType: "application/vnd.google-apps.spreadsheet",
      sourceMimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(updatedMatrices.length).toBe(1);

    // Project metadata MUST NOT be mutated by stale Vue d'ensemble header
    const reloadedProject = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    expect(reloadedProject.codeProjet).toBe("326027");
    expect(reloadedProject.client).toBe("Caisse d'Épargne");
    expect(reloadedProject.budgetSheetId).toBe(res.budgetSheetId);

    // Link an invoice to line[0] and verify re-import preserves line[0].id
    const line0Id = res.lines[0].id;
    const inv = await prisma.invoice.create({
      data: {
        projectId: project.id,
        budgetLineId: line0Id,
        originalFilename: "facture.pdf",
      },
    });

    // Sync from attached Sheet
    gateway.sheets.getValues = async () => updatedMatrices[0];
    const synced = await syncBudgetFromAttachedSheet({
      prisma,
      getGoogleGateway: async () => gateway,
      projectId: project.id,
    });
    expect(synced.lines[0].id).toBe(line0Id);
    const reloadedInv = await prisma.invoice.findUniqueOrThrow({
      where: { id: inv.id },
    });
    expect(reloadedInv.budgetLineId).toBe(line0Id);

    // PROD copy via SandboxGuard into 001.1
    const copiedRes = await importBudgetFromSheetCopy({
      prisma,
      getGoogleGateway: async () => gateway,
      projectId: project.id,
      sourceSheetId: PILOT_SANDBOX_CONFIG.prodTemplates.budgetSheetId,
    });
    expect(copiedRes.ok).toBe(true);
    expect(gateway.drive.copyCalls[0].sourceFileId).toBe(
      PILOT_SANDBOX_CONFIG.prodTemplates.budgetSheetId
    );
  });
});
