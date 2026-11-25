import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { AppHttpError, PreconditionError } from "@/lib/errors";
import { stageInvoicePdf } from "@/lib/invoices/ingest";
import {
  buildValidatedInvoiceFilename,
  validateInvoicePipeline,
} from "@/lib/invoices/validate";
import { CpConflictError } from "@/lib/isolation/cp-guard";
import { createInMemoryGoogleDouble } from "../doubles/in-memory-google";

const INVOICE_FILENAME_REGEX =
  /^[^_]+_\d+_[^_]+_\d{4}-\d{2}-\d{2}\.pdf$/;

function makePdf(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Length 20 >>\nstream\nBT (CP 326027) Tj ET\nendstream\nendobj\n%%EOF\n",
    "latin1"
  );
}

describe("M2 1-Click Invoice Validation Pipeline (Drive 001.3, Sheet Cumulation + Note, Pennylane Draft)", () => {
  let tempDir: string;
  let prisma: PrismaClient;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-m2-validate-"));
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

  it("sanitizes filenames strictly matching InvoiceNumber_CP_Presta_YYYY-MM-DD.pdf", () => {
    const f1 = buildValidatedInvoiceFilename({
      invoiceNumber: "FAC-2026-042",
      invoiceDate: "2026-09-22",
      codeProjet: "326027",
      vendorName: "L'Atelier ../Éphémère & Co",
      amountHt: 1250.5,
    });
    expect(f1).toBe("FAC-2026-042_326027_LAtelierÉphémèreCo_2026-09-22.pdf");
    expect(INVOICE_FILENAME_REGEX.test(f1)).toBe(true);

    const f2 = buildValidatedInvoiceFilename({
      invoiceNumber: "F 001/B",
      invoiceDate: "2026-11-24",
      codeProjet: "326027",
      vendorName: "Studio_Test",
      amountHt: 1000,
    });
    expect(f2).toBe("F001-B_326027_StudioTest_2026-11-24.pdf");
    expect(INVOICE_FILENAME_REGEX.test(f2)).toBe(true);
  });

  it("enforces cross-project 404, CP-conflict 409, and Google 412 before any mutations", async () => {
    const projA = await prisma.project.create({
      data: {
        codeProjet: "326027",
        client: "CE",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });
    const projB = await prisma.project.create({
      data: {
        codeProjet: "326018",
        client: "Autre",
        nomJeu: "LoL",
        isSandbox: true,
      },
    });
    const lineA = await prisma.budgetLine.create({
      data: {
        projectId: projA.id,
        category: "PROD",
        objet: "Dev",
        preOpTotalHt: 5000,
      },
    });

    const conflictInv = await prisma.invoice.create({
      data: {
        projectId: projA.id,
        budgetLineId: lineA.id,
        originalFilename: "bad.pdf",
        vendorName: "Bad",
        invoiceNumber: "B-1",
        amountHt: 500,
        detectedCodeProjet: "326018",
        cpConflict: true,
        status: "CONFLICT_BLOCKED",
      },
    });

    const gateway = createInMemoryGoogleDouble();

    // Cross-project 404
    await expect(
      validateInvoicePipeline({
        prisma,
        getGoogleGateway: async () => gateway,
        projectId: projB.id,
        invoiceId: conflictInv.id,
      })
    ).rejects.toMatchObject({ httpStatus: 404 });

    // CP-conflict 409
    await expect(
      validateInvoicePipeline({
        prisma,
        getGoogleGateway: async () => gateway,
        projectId: projA.id,
        invoiceId: conflictInv.id,
      })
    ).rejects.toThrow(CpConflictError);
    expect(gateway.drive.createCalls).toHaveLength(0);

    // 412 GOOGLE_NOT_CONNECTED before DB writes
    const cleanInv = await prisma.invoice.create({
      data: {
        projectId: projA.id,
        budgetLineId: lineA.id,
        originalFilename: "ok.pdf",
        vendorName: "Studio",
        invoiceNumber: "F-1",
        amountHt: 500,
        status: "PENDING_VALIDATION",
      },
    });

    await expect(
      validateInvoicePipeline({
        prisma,
        getGoogleGateway: async () => {
          throw new PreconditionError("GOOGLE_NOT_CONNECTED", "Not connected");
        },
        projectId: projA.id,
        invoiceId: cleanInv.id,
        rawInput: { amountHt: 999 },
      })
    ).rejects.toThrow(PreconditionError);

    const unchanged = await prisma.invoice.findUniqueOrThrow({
      where: { id: cleanInv.id },
    });
    expect(unchanged.amountHt).toBe(500);
    expect(unchanged.stepDriveDone).toBe(false);
  });

  it("executes 3-step validation, cumulates Acompte + Solde HT & notes, recovers from partial Sheet failure without double-counting, and is idempotent", async () => {
    // Configure encrypted Pennylane settings in AppSetting
    await prisma.appSetting.upsert({
      where: { key: "PENNYLANE_EMAIL" },
      update: { valueEnc: encryptSecret("pennylane-test@suppliers.pennylane.com"), isSecret: false },
      create: { key: "PENNYLANE_EMAIL", valueEnc: encryptSecret("pennylane-test@suppliers.pennylane.com"), isSecret: false },
    });
    await prisma.appSetting.upsert({
      where: { key: "DEFAULT_CC_EMAILS" },
      update: { valueEnc: encryptSecret("Souléimane, Louis, Paul"), isSecret: false },
      create: { key: "DEFAULT_CC_EMAILS", valueEnc: encryptSecret("Souléimane, Louis, Paul"), isSecret: false },
    });

    const project = await prisma.project.create({
      data: {
        codeProjet: "326077",
        client: "Caisse d'Épargne",
        nomJeu: "Fortnite",
        isSandbox: true,
        budgetSheetId: "sbx_budget_sheet_77",
      },
    });

    const line = await prisma.budgetLine.create({
      data: {
        projectId: project.id,
        category: "PRODUCTION",
        objet: "Développement Map",
        expenseType: "Externe",
        saleTotalHt: 10000,
        preOpTotalHt: 5000,
        sheetRowIndex: 14,
      },
    });

    const inv1 = await prisma.invoice.create({
      data: {
        projectId: project.id,
        budgetLineId: line.id,
        originalFilename: "acompte.pdf",
        vendorName: "Studio Alpha",
        invoiceNumber: "F-001",
        invoiceDate: "2026-09-10",
        amountHt: 1000,
        tvaAmount: 200,
        amountTtc: 1200,
        invoiceType: "ACOMPTE",
        prestationLabel: "Acompte Map",
        status: "PENDING_VALIDATION",
      },
    });
    await stageInvoicePdf(project.id, inv1.id, makePdf());

    const inv2 = await prisma.invoice.create({
      data: {
        projectId: project.id,
        budgetLineId: line.id,
        originalFilename: "solde.pdf",
        vendorName: "Studio Alpha",
        invoiceNumber: "F-002",
        invoiceDate: "2026-09-25",
        amountHt: 1500.5,
        tvaAmount: 300.1,
        amountTtc: 1800.6,
        invoiceType: "SOLDE",
        prestationLabel: "Solde Map",
        status: "PENDING_VALIDATION",
      },
    });
    await stageInvoicePdf(project.id, inv2.id, makePdf());

    const gateway = createInMemoryGoogleDouble();
    const sheetUpdates: Array<{ range: string; values: unknown[][] }> = [];
    const cellNotes: Array<{
      sheetId: number;
      rowIndex: number;
      columnIndex: number;
      note: string;
    }> = [];
    const drafts: Array<{
      to: string;
      cc?: string[];
      subject: string;
      attachmentNames: string[];
    }> = [];

    let failSheetOnce = false;
    gateway.sheets.getSpreadsheet = async () => ({
      sheets: [{ properties: { sheetId: 1432840320, title: "Postes de dépenses" } }],
    });
    gateway.sheets.updateValues = async (p) => {
      if (failSheetOnce) {
        failSheetOnce = false;
        throw new Error("Transient Sheets 503");
      }
      sheetUpdates.push({ range: p.range, values: p.values });
    };
    gateway.sheets.updateCellNote = async (p) => {
      cellNotes.push({
        sheetId: p.sheetId,
        rowIndex: p.rowIndex,
        columnIndex: p.columnIndex,
        note: p.note,
      });
    };
    gateway.gmail.createDraft = async (p) => {
      drafts.push({
        to: p.to,
        cc: p.cc,
        subject: p.subject,
        attachmentNames: (p.attachments ?? []).map((a) => a.filename),
      });
      return { draftId: `draft_${drafts.length}`, messageId: `msg_${drafts.length}` };
    };

    // Validate Invoice 1 (Acompte 1000 €)
    const val1 = await validateInvoicePipeline({
      prisma,
      getGoogleGateway: async () => gateway,
      projectId: project.id,
      invoiceId: inv1.id,
    });

    expect(val1.invoice.status).toBe("VALIDATED");
    expect(val1.invoice.renamedFilename).toBe(
      "F-001_326077_StudioAlpha_2026-09-10.pdf"
    );
    expect(sheetUpdates[0].range).toBe("'Postes de dépenses'!P14:S14");
    expect(sheetUpdates[0].values[0][3]).toBe(1000);
    expect(cellNotes[0]).toEqual({
      sheetId: 1432840320,
      rowIndex: 13, // 0-based (14 - 1)
      columnIndex: 18, // S (0-based)
      note: "Factures cumulées : F-001",
    });
    expect(drafts[0]).toMatchObject({
      to: "pennylane-test@suppliers.pennylane.com",
      subject: "Facture | Studio Alpha - Acompte Map | CP 326077",
      attachmentNames: ["F-001_326077_StudioAlpha_2026-09-10.pdf"],
    });
    expect(drafts[0].cc?.join(", ")).toContain("Souleimane <souleimane@gamersorigin.com>");
    expect(drafts[0].cc?.join(", ")).toContain("Louis");
    expect(drafts[0].cc?.join(", ")).toContain("Paul");
    expect(drafts[0].cc?.every((c) => c.includes("@"))).toBe(true);
    expect(
      drafts[0].cc?.every((c) => /^[\x20-\x7e]+$/.test(c))
    ).toBe(true);

    // Partial failure test on Invoice 2: Drive succeeds, Sheet throws -> retry skips Drive and does NOT double-count HT
    failSheetOnce = true;
    await expect(
      validateInvoicePipeline({
        prisma,
        getGoogleGateway: async () => gateway,
        projectId: project.id,
        invoiceId: inv2.id,
      })
    ).rejects.toThrow("Transient Sheets 503");

    const midInv2 = await prisma.invoice.findUniqueOrThrow({
      where: { id: inv2.id },
    });
    expect(midInv2.stepDriveDone).toBe(true);
    expect(midInv2.stepSheetDone).toBe(false);
    expect(midInv2.stepGmailDone).toBe(false);
    const driveUploadsAfterFailure = gateway.drive.createCalls.length;

    // Retry Invoice 2
    const val2 = await validateInvoicePipeline({
      prisma,
      getGoogleGateway: async () => gateway,
      projectId: project.id,
      invoiceId: inv2.id,
    });
    expect(val2.invoice.status).toBe("VALIDATED");
    // No duplicate Drive upload on retry!
    expect(gateway.drive.createCalls.length).toBe(driveUploadsAfterFailure);

    const updatedLine = await prisma.budgetLine.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(updatedLine.postOpTotalHt).toBe(2500.5);
    expect(updatedLine.invoiceNumbersNote).toBe(
      "Factures cumulées : F-001, F-002"
    );
    expect(cellNotes[1].note).toBe("Factures cumulées : F-001, F-002");

    // Idempotent re-validation of inv2 emits ZERO extra Drive/Sheet/Gmail calls
    const beforeCounts = {
      drive: gateway.drive.createCalls.length,
      sheet: sheetUpdates.length,
      drafts: drafts.length,
    };
    const idempotent = await validateInvoicePipeline({
      prisma,
      getGoogleGateway: async () => gateway,
      projectId: project.id,
      invoiceId: inv2.id,
    });
    expect(idempotent.alreadyValidated).toBe(true);
    expect(gateway.drive.createCalls.length).toBe(beforeCounts.drive);
    expect(sheetUpdates.length).toBe(beforeCounts.sheet);
    expect(drafts.length).toBe(beforeCounts.drafts);

    // Duplicate VALIDATED invoice guard (409)
    const dupInv = await prisma.invoice.create({
      data: {
        projectId: project.id,
        budgetLineId: line.id,
        originalFilename: "dup.pdf",
        vendorName: "Studio Alpha",
        invoiceNumber: "f-002",
        amountHt: 1500.5,
        status: "PENDING_VALIDATION",
      },
    });
    await expect(
      validateInvoicePipeline({
        prisma,
        getGoogleGateway: async () => gateway,
        projectId: project.id,
        invoiceId: dupInv.id,
      })
    ).rejects.toThrow(AppHttpError);

    fs.rmSync(path.join(process.cwd(), ".data", "invoices", project.id), {
      recursive: true,
      force: true,
    });
  });

  it("propagates Sheets getSpreadsheet errors without falling back to sheetId=0, recomputes amountTtc proportionally, and logs CP_CONFLICT_OVERRIDDEN", async () => {
    const project = await prisma.project.create({
      data: {
        codeProjet: "326055",
        client: "Caisse d'Épargne",
        nomJeu: "Fortnite",
        isSandbox: true,
        budgetSheetId: "sbx_sheet_55",
      },
    });

    const line = await prisma.budgetLine.create({
      data: {
        projectId: project.id,
        category: "PRODUCTION",
        objet: "Sonorisation",
        expenseType: "Externe",
        saleTotalHt: 5000,
        preOpTotalHt: 3000,
        sheetRowIndex: 15,
      },
    });

    const inv = await prisma.invoice.create({
      data: {
        projectId: project.id,
        budgetLineId: line.id,
        originalFilename: "son.pdf",
        vendorName: "Audio Lab",
        invoiceNumber: "AUD-10",
        invoiceDate: "2026-10-01",
        amountHt: 1000,
        tvaAmount: 200,
        amountTtc: 1200,
        invoiceType: "UNIQUE",
        prestationLabel: "Mixage",
        status: "PENDING_VALIDATION",
      },
    });
    await stageInvoicePdf(project.id, inv.id, makePdf());

    const gateway = createInMemoryGoogleDouble();
    let failGetSpreadsheetOnce = true;
    const sheetUpdates: Array<{ range: string; values: unknown[][] }> = [];
    const cellNotes: Array<{ sheetId: number; rowIndex: number; note: string }> = [];

    gateway.sheets.getSpreadsheet = async () => {
      if (failGetSpreadsheetOnce) {
        failGetSpreadsheetOnce = false;
        throw new Error("Transient getSpreadsheet 503");
      }
      return {
        sheets: [{ properties: { sheetId: 1432840320, title: "Postes de dépenses" } }],
      };
    };
    gateway.sheets.updateValues = async (p) => {
      sheetUpdates.push({ range: p.range, values: p.values });
    };
    gateway.sheets.updateCellNote = async (p) => {
      cellNotes.push({ sheetId: p.sheetId, rowIndex: p.rowIndex, note: p.note });
    };

    // Edit amountHt -> 1500 without amountTtc; getSpreadsheet fails cleanly before updateValues/updateCellNote
    await expect(
      validateInvoicePipeline({
        prisma,
        getGoogleGateway: async () => gateway,
        projectId: project.id,
        invoiceId: inv.id,
        rawInput: { amountHt: 1500 },
      })
    ).rejects.toThrow("Transient getSpreadsheet 503");

    expect(sheetUpdates).toHaveLength(0);
    expect(cellNotes).toHaveLength(0);

    const midInv = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(midInv.stepDriveDone).toBe(true);
    expect(midInv.stepSheetDone).toBe(false);
    expect(midInv.amountHt).toBe(1500);
    expect(midInv.amountTtc).toBe(1800); // Proportional 1500 * (1200/1000)
    expect(midInv.tvaAmount).toBe(300);

    const driveCountBeforeRetry = gateway.drive.createCalls.length;

    // Retry completes cleanly without duplicate Drive upload and uses real sheetId 1432840320
    const retried = await validateInvoicePipeline({
      prisma,
      getGoogleGateway: async () => gateway,
      projectId: project.id,
      invoiceId: inv.id,
    });

    expect(retried.invoice.status).toBe("VALIDATED");
    expect(gateway.drive.createCalls.length).toBe(driveCountBeforeRetry);
    expect(cellNotes[0].sheetId).toBe(1432840320);

    const reloadedLine = await prisma.budgetLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(reloadedLine.postOpTotalHt).toBe(1500);

    // If overrideCpConflict: true is explicitly passed via API, CP_CONFLICT_OVERRIDDEN is audited
    const conflictInv = await prisma.invoice.create({
      data: {
        projectId: project.id,
        budgetLineId: line.id,
        originalFilename: "override.pdf",
        vendorName: "Other",
        invoiceNumber: "OVR-1",
        invoiceDate: "2026-10-05",
        amountHt: 100,
        tvaAmount: 20,
        amountTtc: 120,
        detectedCodeProjet: "326018",
        cpConflict: true,
        status: "CONFLICT_BLOCKED",
      },
    });
    await stageInvoicePdf(project.id, conflictInv.id, makePdf());

    await validateInvoicePipeline({
      prisma,
      getGoogleGateway: async () => gateway,
      projectId: project.id,
      invoiceId: conflictInv.id,
      rawInput: { overrideCpConflict: true },
    });

    const overrideAudit = await prisma.auditLog.findFirst({
      where: {
        projectId: project.id,
        action: "CP_CONFLICT_OVERRIDDEN",
        targetId: conflictInv.id,
      },
    });
    expect(overrideAudit).not.toBeNull();

    fs.rmSync(path.join(process.cwd(), ".data", "invoices", project.id), {
      recursive: true,
      force: true,
    });
  });
});
