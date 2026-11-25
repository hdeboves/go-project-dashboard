import fs from "node:fs";
import path from "node:path";
import type { BudgetLine, Invoice, PrismaClient, Project } from "@prisma/client";
import { round2 } from "@/lib/budget/calculator";
import { AppHttpError } from "@/lib/errors";
import {
  type CpConflictResult,
  CpConflictError,
  checkCodeProjetConflict,
} from "@/lib/isolation/cp-guard";
import type { GeminiPort, InvoiceExtractionOutput } from "@/lib/ports";
import {
  extractTextFromPdfBuffer,
  validatePdfBuffer,
} from "@/lib/invoices/pdf-text";

export class InvoiceCpConflictError extends CpConflictError {
  readonly invoice: Invoice;

  constructor(result: CpConflictResult, invoice: Invoice) {
    super(result);
    this.name = "InvoiceCpConflictError";
    this.invoice = invoice;
  }
}

export interface IngestInvoiceResult {
  invoice: Invoice;
  isDuplicate: boolean;
  duplicateOfInvoiceId: string | null;
  suggestedBudgetLineId: string | null;
  extracted: InvoiceExtractionOutput;
}

function normalizeTokenText(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeInvoiceNumber(
  num: string | null | undefined
): string {
  return (num ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function getStagedInvoicePdfPath(
  projectId: string,
  invoiceId: string
): string {
  return path.join(
    process.cwd(),
    ".data",
    "invoices",
    projectId,
    `${invoiceId}.pdf`
  );
}

export async function stageInvoicePdf(
  projectId: string,
  invoiceId: string,
  pdfBuffer: Buffer
): Promise<string> {
  const filePath = getStagedInvoicePdfPath(projectId, invoiceId);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, pdfBuffer);
  return filePath;
}

export async function readStagedInvoicePdf(
  projectId: string,
  invoiceId: string,
  extractedJson?: string | null
): Promise<Buffer | null> {
  const candidates: string[] = [];
  if (extractedJson) {
    try {
      const parsed = JSON.parse(extractedJson) as { localPdfPath?: string };
      if (parsed.localPdfPath) {
        candidates.push(parsed.localPdfPath);
      }
    } catch {
      // ignore invalid JSON
    }
  }
  candidates.push(getStagedInvoicePdfPath(projectId, invoiceId));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return await fs.promises.readFile(candidate);
      }
    } catch {
      // try next
    }
  }
  return null;
}

export function suggestBudgetLineForInvoice(
  budgetLines: readonly BudgetLine[],
  params: {
    requestedBudgetLineId?: string | null;
    geminiSuggestedId?: string | null;
    geminiSuggestedLabel?: string | null;
    vendorName?: string | null;
    prestationSummary?: string | null;
    filename?: string | null;
  }
): string | null {
  if (budgetLines.length === 0) return null;

  if (params.requestedBudgetLineId) {
    const exact = budgetLines.find((l) => l.id === params.requestedBudgetLineId);
    if (exact) return exact.id;
  }

  if (params.geminiSuggestedId) {
    const geminiMatch = budgetLines.find(
      (l) => l.id === params.geminiSuggestedId
    );
    if (geminiMatch) return geminiMatch.id;
  }

  const normVendor = normalizeTokenText(params.vendorName);
  const queryText = [
    params.prestationSummary,
    params.geminiSuggestedLabel,
    params.filename,
    params.vendorName,
  ]
    .filter(Boolean)
    .join(" ");

  const queryTokens = Array.from(
    new Set(
      normalizeTokenText(queryText)
        .split(" ")
        .filter((t) => t.length >= 3)
    )
  );

  let bestId: string | null = null;
  let bestScore = 0;

  for (const line of budgetLines) {
    let score = 0;
    const normRealisePar = normalizeTokenText(line.realisePar);
    if (
      normVendor &&
      normRealisePar &&
      (normRealisePar.includes(normVendor) || normVendor.includes(normRealisePar))
    ) {
      score += 50;
    }

    const lineHaystack = normalizeTokenText(`${line.objet} ${line.category}`);
    for (const tok of queryTokens) {
      if (lineHaystack.includes(tok)) {
        score += 15;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = line.id;
    }
  }

  return bestScore > 0 ? bestId : null;
}

export async function processInvoicePdfIngestion(params: {
  prisma: PrismaClient;
  getGeminiClient: () => Promise<GeminiPort>;
  project: Project;
  pdfBuffer: Buffer;
  filename: string;
  mimeType?: string | null;
  requestedBudgetLineId?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  gmailMessageId?: string | null;
  attachmentId?: string | null;
  quarantineOnConflictWithoutThrowing?: boolean;
}): Promise<IngestInvoiceResult> {
  const {
    prisma,
    getGeminiClient,
    project,
    pdfBuffer,
    filename,
    mimeType,
    requestedBudgetLineId,
    emailSubject,
    emailBody,
    gmailMessageId,
    attachmentId,
    quarantineOnConflictWithoutThrowing,
  } = params;

  // 1. Validate PDF MIME & magic bytes / structure BEFORE any DB writes
  validatePdfBuffer(pdfBuffer, mimeType, filename);

  // 2. Acquire Gemini client (throws 412 GEMINI_KEY_MISSING BEFORE any DB writes)
  const gemini = await getGeminiClient();

  // 3. Deterministic local PDF text extraction
  const localPdfText = extractTextFromPdfBuffer(pdfBuffer);

  // 4. Fetch project budget lines for Gemini context & suggestion
  const budgetLines = await prisma.budgetLine.findMany({
    where: { projectId: project.id },
    orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
  });

  if (requestedBudgetLineId) {
    const belongs = budgetLines.some((l) => l.id === requestedBudgetLineId);
    if (!belongs) {
      throw new AppHttpError(
        400,
        "INVALID_BUDGET_LINE",
        "La ligne budgétaire sélectionnée n'appartient pas à ce projet."
      );
    }
  }

  // 5. Gemini multimodal extraction
  const extracted = await gemini.extractInvoiceFromPdf({
    pdfBuffer,
    filename,
    emailSubject: emailSubject ?? undefined,
    projectContext: {
      codeProjet: project.codeProjet,
      client: project.client,
      nomJeu: project.nomJeu,
    },
    budgetLines: budgetLines.map((l) => ({
      id: l.id,
      category: l.category,
      objet: l.objet,
      preOpTotalHt: l.preOpTotalHt,
    })),
  });

  const amountHt = round2(Math.max(0, extracted.montantHT));
  let tvaAmount = round2(Math.max(0, extracted.montantTTC - amountHt));
  if (tvaAmount === 0 && extracted.tvaRate > 0 && amountHt > 0 && extracted.montantTTC <= amountHt) {
    tvaAmount = round2(amountHt * (extracted.tvaRate / 100));
  }
  const amountTtc =
    extracted.montantTTC > 0
      ? round2(extracted.montantTTC)
      : round2(amountHt + tvaAmount);

  // 6. Deterministic Zero-Mix CP Conflict Guardrail
  const combinedText = [
    filename,
    emailSubject,
    emailBody,
    localPdfText,
    extracted.extractedRawTextSnippet,
    extracted.prestationSummary,
    extracted.prestataire,
    extracted.numeroFacture,
  ]
    .filter(Boolean)
    .join("\n");

  const cpCheck = checkCodeProjetConflict(
    project.codeProjet,
    extracted.codeProjetDetecte,
    combinedText
  );

  if (cpCheck.hasConflict) {
    const blocked = await prisma.invoice.create({
      data: {
        projectId: project.id,
        budgetLineId: null,
        gmailMessageId: gmailMessageId ?? null,
        originalFilename: filename,
        vendorName: extracted.prestataire,
        invoiceNumber: extracted.numeroFacture,
        invoiceDate: extracted.dateFacture,
        amountHt,
        tvaAmount,
        amountTtc,
        invoiceType: extracted.typeFacture,
        prestationLabel: extracted.prestationSummary,
        detectedCodeProjet:
          cpCheck.conflictingCps[0] ?? extracted.codeProjetDetecte ?? null,
        cpConflict: true,
        status: "CONFLICT_BLOCKED",
        extractedJson: JSON.stringify({
          ...extracted,
          localPdfTextSnippet: localPdfText.slice(0, 500),
          cpCheck,
          attachmentId: attachmentId ?? null,
        }),
      },
    });

    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: gmailMessageId ? "system:gmail-scan" : "user",
        action: "CP_CONFLICT_BLOCKED",
        targetType: "INVOICE",
        targetId: blocked.id,
        detailsJson: JSON.stringify({
          filename,
          gmailMessageId: gmailMessageId ?? null,
          activeCp: cpCheck.activeCp,
          detectedCps: cpCheck.detectedCps,
          conflictingCps: cpCheck.conflictingCps,
          reason: cpCheck.reason,
        }),
      },
    });

    if (!quarantineOnConflictWithoutThrowing) {
      throw new InvoiceCpConflictError(cpCheck, blocked);
    }

    return {
      invoice: blocked,
      isDuplicate: false,
      duplicateOfInvoiceId: null,
      suggestedBudgetLineId: null,
      extracted,
    };
  }

  // 7. Duplicate invoiceNumber detection within project
  const normInvNum = normalizeInvoiceNumber(extracted.numeroFacture);
  let duplicateOf: Invoice | null = null;
  if (normInvNum) {
    const existingProjectInvoices = await prisma.invoice.findMany({
      where: {
        projectId: project.id,
        status: { not: "REJECTED" },
        invoiceNumber: { not: null },
      },
      orderBy: { createdAt: "asc" },
    });
    duplicateOf =
      existingProjectInvoices.find(
        (inv) => normalizeInvoiceNumber(inv.invoiceNumber) === normInvNum
      ) ?? null;
  }

  const isDuplicate = Boolean(duplicateOf);
  const warnings = [...(extracted.rawWarnings ?? [])];
  if (isDuplicate && duplicateOf) {
    warnings.push(
      `Doublon détecté : le N° Facture ${extracted.numeroFacture} existe déjà sur ce projet (statut ${duplicateOf.status}).`
    );
  }
  if (!localPdfText.trim() && amountHt === 0) {
    warnings.push(
      "PDF sans texte extractible et montant HT nul : vérifiez les champs avant validation."
    );
  }

  // 8. Suggest BudgetLine
  const suggestedBudgetLineId = suggestBudgetLineForInvoice(budgetLines, {
    requestedBudgetLineId,
    geminiSuggestedId: extracted.suggestedBudgetLineId,
    geminiSuggestedLabel: extracted.suggestedBudgetLineLabel,
    vendorName: extracted.prestataire,
    prestationSummary: extracted.prestationSummary,
    filename,
  });

  // 9. Create Invoice first, then stage PDF bytes in .data/invoices/<projectId>/<invoiceId>.pdf
  const created = await prisma.invoice.create({
    data: {
      projectId: project.id,
      budgetLineId: suggestedBudgetLineId,
      gmailMessageId: gmailMessageId ?? null,
      originalFilename: filename,
      vendorName: extracted.prestataire,
      invoiceNumber: extracted.numeroFacture,
      invoiceDate: extracted.dateFacture,
      amountHt,
      tvaAmount,
      amountTtc,
      invoiceType: extracted.typeFacture,
      prestationLabel: extracted.prestationSummary,
      detectedCodeProjet:
        extracted.codeProjetDetecte ??
        (cpCheck.detectedCps[0] || project.codeProjet),
      cpConflict: false,
      status: "PENDING_VALIDATION",
      extractedJson: JSON.stringify({
        ...extracted,
        rawWarnings: warnings,
        isDuplicate,
        duplicateOfInvoiceId: duplicateOf?.id ?? null,
        attachmentId: attachmentId ?? null,
      }),
    },
  });

  const localPdfPath = await stageInvoicePdf(project.id, created.id, pdfBuffer);
  const invoice = await prisma.invoice.update({
    where: { id: created.id },
    data: {
      extractedJson: JSON.stringify({
        ...extracted,
        rawWarnings: warnings,
        isDuplicate,
        duplicateOfInvoiceId: duplicateOf?.id ?? null,
        attachmentId: attachmentId ?? null,
        localPdfPath,
      }),
    },
  });

  await prisma.auditLog.create({
    data: {
      projectId: project.id,
      actor: gmailMessageId ? "system:gmail-scan" : "user",
      action: "INVOICE_INGESTED",
      targetType: "INVOICE",
      targetId: invoice.id,
      detailsJson: JSON.stringify({
        filename,
        vendorName: invoice.vendorName,
        invoiceNumber: invoice.invoiceNumber,
        amountHt: invoice.amountHt,
        isDuplicate,
        suggestedBudgetLineId,
        gmailMessageId: gmailMessageId ?? null,
      }),
    },
  });

  return {
    invoice,
    isDuplicate,
    duplicateOfInvoiceId: duplicateOf?.id ?? null,
    suggestedBudgetLineId,
    extracted,
  };
}
