import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PreconditionError } from "@/lib/errors";
import {
  InvoiceCpConflictError,
  processInvoicePdfIngestion,
} from "@/lib/invoices/ingest";
import {
  extractTextFromPdfBuffer,
  validatePdfBuffer,
} from "@/lib/invoices/pdf-text";
import {
  runGmailInvoiceScanJob,
  scanProjectGmailInvoices,
} from "@/lib/invoices/scan-job";
import {
  createInMemoryGeminiDouble,
  createInMemoryGoogleDouble,
} from "../doubles/in-memory-google";

function makeMinimalPdf(text: string, compressStream = false): Buffer {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const streamBody = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  if (!compressStream) {
    return Buffer.from(
      `%PDF-1.4\n1 0 obj\n<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream\nendobj\n%%EOF\n`,
      "latin1"
    );
  }
  const compressed = zlib.deflateSync(Buffer.from(streamBody, "latin1"));
  const header = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
    "latin1"
  );
  const footer = Buffer.from(`\nendstream\nendobj\n%%EOF\n`, "latin1");
  return Buffer.concat([header, compressed, footer]);
}

describe("M2 Invoice PDF Extraction, CP Conflict Guard & Gmail Scan", () => {
  let tempDir: string;
  let prisma: PrismaClient;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-m2-ingest-"));
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

  it("validates PDF binary & MIME and extracts text from both raw and FlateDecode PDF streams", () => {
    expect(() =>
      validatePdfBuffer(Buffer.from("\x89PNG\r\n\x1a\nfake"), "image/png", "img.png")
    ).toThrow(/non supporté/i);

    expect(() =>
      validatePdfBuffer(
        Buffer.from("%PDF-1.4\ncorrupt_truncated_bytes"),
        "application/pdf",
        "bad.pdf"
      )
    ).toThrow(/corrompue|incomplète/i);

    const plainPdf = makeMinimalPdf("Facture Studio Alpha CP 326018", false);
    validatePdfBuffer(plainPdf, "application/pdf", "scan_recu_01.pdf");
    expect(extractTextFromPdfBuffer(plainPdf)).toContain("CP 326018");

    const flatePdf = makeMinimalPdf("Projet code_projet: 326018 Montant 900 EUR", true);
    validatePdfBuffer(flatePdf, "application/pdf", "scan_recu_02.pdf");
    expect(extractTextFromPdfBuffer(flatePdf)).toContain("326018");
  });

  it("enforces 412 GEMINI_KEY_MISSING, quarantines CP-conflict PDFs as CONFLICT_BLOCKED (409), flags duplicates, and suggests BudgetLine", async () => {
    await prisma.project.deleteMany({ where: { codeProjet: "326027" } });
    const project = await prisma.project.create({
      data: {
        codeProjet: "326027",
        client: "Caisse d'Épargne",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    const line = await prisma.budgetLine.create({
      data: {
        projectId: project.id,
        category: "PRODUCTION",
        objet: "Développement Map Fortnite",
        realisePar: "Studio Alpha",
        expenseType: "Externe",
        saleTotalHt: 15000,
        preOpTotalHt: 10000,
      },
    });

    const validPdf = makeMinimalPdf("Facture F-2026-01 CP 326027 Studio Alpha");

    // 412 before any DB writes
    await expect(
      processInvoicePdfIngestion({
        prisma,
        getGeminiClient: async () => {
          throw new PreconditionError("GEMINI_KEY_MISSING", "Missing Gemini");
        },
        project,
        pdfBuffer: validPdf,
        filename: "facture_alpha.pdf",
        mimeType: "application/pdf",
      })
    ).rejects.toThrow(PreconditionError);
    expect(await prisma.invoice.count({ where: { projectId: project.id } })).toBe(0);

    // CP conflict in compressed PDF stream caught even if Gemini returns active CP 326027!
    const gemini = createInMemoryGeminiDouble();
    const conflictPdf = makeMinimalPdf("Facture autre projet CP 326018", true);

    await expect(
      processInvoicePdfIngestion({
        prisma,
        getGeminiClient: async () => gemini,
        project,
        pdfBuffer: conflictPdf,
        filename: "scan_recu_01.pdf",
        mimeType: "application/pdf",
      })
    ).rejects.toThrow(InvoiceCpConflictError);

    const blockedRow = await prisma.invoice.findFirstOrThrow({
      where: { projectId: project.id, status: "CONFLICT_BLOCKED" },
    });
    expect(blockedRow.cpConflict).toBe(true);
    expect(blockedRow.detectedCodeProjet).toBe("326018");
    expect(blockedRow.driveFileId).toBeNull();

    const auditConflict = await prisma.auditLog.findFirst({
      where: {
        projectId: project.id,
        action: "CP_CONFLICT_BLOCKED",
        targetId: blockedRow.id,
      },
    });
    expect(auditConflict).not.toBeNull();

    // Clean ingestion with deterministic vendor/token BudgetLine suggestion & local PDF staging
    gemini.extractInvoiceFromPdf = async () => ({
      prestataire: "Studio Alpha",
      numeroFacture: "FAC-2026-100",
      dateFacture: "2026-11-24",
      montantHT: 1000,
      tvaRate: 20,
      montantTTC: 1200,
      typeFacture: "ACOMPTE",
      codeProjetDetecte: "326027",
      prestationSummary: "Développement Map Fortnite lot 1",
      suggestedBudgetLineId: null,
      suggestedBudgetLineLabel: null,
      confidence: 0.96,
      rawWarnings: [],
      extractedRawTextSnippet: "CP 326027",
    });

    const ingested1 = await processInvoicePdfIngestion({
      prisma,
      getGeminiClient: async () => gemini,
      project,
      pdfBuffer: validPdf,
      filename: "facture_alpha_01.pdf",
      mimeType: "application/pdf",
    });
    expect(ingested1.isDuplicate).toBe(false);
    expect(ingested1.suggestedBudgetLineId).toBe(line.id);
    expect(ingested1.invoice.tvaAmount).toBe(200);
    expect(ingested1.invoice.status).toBe("PENDING_VALIDATION");

    const stagedPath = path.join(
      process.cwd(),
      ".data",
      "invoices",
      project.id,
      `${ingested1.invoice.id}.pdf`
    );
    expect(fs.existsSync(stagedPath)).toBe(true);

    // Duplicate invoiceNumber detection
    const ingestedDup = await processInvoicePdfIngestion({
      prisma,
      getGeminiClient: async () => gemini,
      project,
      pdfBuffer: validPdf,
      filename: "facture_alpha_01_bis.pdf",
      mimeType: "application/pdf",
    });
    expect(ingestedDup.isDuplicate).toBe(true);
    expect(ingestedDup.duplicateOfInvoiceId).toBe(ingested1.invoice.id);

    // Cleanup staged PDFs for test project
    fs.rmSync(path.join(process.cwd(), ".data", "invoices", project.id), {
      recursive: true,
      force: true,
    });
  });

  it("scans Gmail excluding '- Factures', quarantines conflicts without aborting batch, deduplicates gmailMessageId, and runs F24 scan job", async () => {
    const project = await prisma.project.create({
      data: {
        codeProjet: "326099",
        client: "Test Scan",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    const gateway = createInMemoryGoogleDouble();
    const gemini = createInMemoryGeminiDouble();
    gemini.extractInvoiceFromPdf = async (input) => ({
      prestataire: "Prestataire Gmail",
      numeroFacture: input.filename === "ok.pdf" ? "G-101" : "G-999",
      dateFacture: "2026-11-24",
      montantHT: 500,
      tvaRate: 20,
      montantTTC: 600,
      typeFacture: "UNIQUE",
      codeProjetDetecte: "326099",
      prestationSummary: "Montage vidéo",
      suggestedBudgetLineId: null,
      suggestedBudgetLineLabel: null,
      confidence: 0.9,
      rawWarnings: [],
      extractedRawTextSnippet: "CP 326099",
    });

    const queriesObserved: string[] = [];
    const labeledMessages: Array<{ id: string; addLabelIds?: string[] }> = [];

    gateway.gmail.listMessages = async (p) => {
      queriesObserved.push(p.q ?? "");
      return {
        messages: [
          { id: "msg_already_labeled" },
          { id: "msg_conflict" },
          { id: "msg_ok" },
        ],
      };
    };

    gateway.gmail.getMessage = async (id) => ({
      id,
      subject: `Facture ${id}`,
      from: "fournisseur@example.com",
      to: "hugo@gamersorigin.com",
      date: "2026-11-24",
      snippet: "",
      textBody: "",
      htmlBody: "",
      labelIds: id === "msg_already_labeled" ? ["lbl_- Factures"] : [],
      attachments: [
        {
          attachmentId: `att_${id}`,
          filename: id === "msg_ok" ? "ok.pdf" : "conflict.pdf",
          mimeType: "application/pdf",
          size: 512,
        },
      ],
    });

    gateway.gmail.getAttachment = async ({ messageId }) =>
      messageId === "msg_conflict"
        ? makeMinimalPdf("Facture CP 326018", false)
        : makeMinimalPdf("Facture CP 326099", false);

    gateway.gmail.modifyMessageLabels = async (p) => {
      labeledMessages.push({ id: p.messageId, addLabelIds: p.addLabelIds });
    };

    const scan1 = await scanProjectGmailInvoices({
      prisma,
      getGoogleGateway: async () => gateway,
      getGeminiClient: async () => gemini,
      projectId: project.id,
    });

    expect(queriesObserved[0]).toContain('-label:"- Factures"');
    expect(scan1.ingestedCount).toBe(1);
    expect(scan1.conflictCount).toBe(1);
    expect(scan1.skippedDuplicates).toBe(1);
    expect(labeledMessages.map((m) => m.id)).toEqual(["msg_conflict", "msg_ok"]);

    // Second run deduplicates existing gmailMessageId in DB
    const scan2 = await scanProjectGmailInvoices({
      prisma,
      getGoogleGateway: async () => gateway,
      getGeminiClient: async () => gemini,
      projectId: project.id,
    });
    expect(scan2.ingestedCount).toBe(0);
    expect(scan2.conflictCount).toBe(0);
    expect(scan2.skippedDuplicates).toBe(3);

    // F24 cron job wrapper logs CRON_GMAIL_INVOICE_SCAN
    const jobRes = await runGmailInvoiceScanJob({
      prisma,
      getGoogleGateway: async () => gateway,
      getGeminiClient: async () => gemini,
      projectId: project.id,
    });
    expect(jobRes.ok).toBe(true);
    expect(jobRes.results[0].status).toBe("ok");

    fs.rmSync(path.join(process.cwd(), ".data", "invoices", project.id), {
      recursive: true,
      force: true,
    });
  });
});
