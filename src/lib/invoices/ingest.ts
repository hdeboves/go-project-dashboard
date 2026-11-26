import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BudgetLine, Invoice, PrismaClient, Project } from "@prisma/client";
import { round2 } from "@/lib/budget/calculator";
import { AppHttpError } from "@/lib/errors";
import {
  type CpConflictResult,
  CpConflictError,
  checkCodeProjetConflict,
} from "@/lib/isolation/cp-guard";
import type {
  GeminiPort,
  GoogleWorkspacePort,
  InvoiceExtractionOutput,
} from "@/lib/ports";
import {
  extractInvoiceFieldsFromText,
  isOwnCompanyName,
  matchQuoteForInvoice,
} from "@/lib/invoices/local-extractor";
import { computeNextInvoiceNumberFromDrive } from "@/lib/invoices/numbering";
import { normalizeProjectCodesList } from "@/lib/invoices/accounting-email";
import {
  extractRichTextFromPdfBuffer,
  validatePdfBuffer,
} from "@/lib/invoices/pdf-text";
import { buildValidatedInvoiceFilename } from "@/lib/shared/filenames";
import { findValidVendorVigilance } from "@/lib/vendors/vendor-service";

export function stripInvoiceBinaries<
  T extends {
    extractedJson?: string | null;
    pdfData?: unknown;
    vigilancePdfData?: unknown;
  },
>(invoice: T): Omit<T, "pdfData" | "vigilancePdfData"> {
  const copy = { ...invoice } as Record<string, unknown>;
  delete copy.pdfData;
  delete copy.vigilancePdfData;
  if (typeof copy.extractedJson === "string" && copy.extractedJson.includes("pdfBase64")) {
    try {
      const parsed = JSON.parse(copy.extractedJson) as Record<string, unknown>;
      delete parsed.pdfBase64;
      delete parsed.localPdfPath;
      copy.extractedJson = JSON.stringify(parsed);
    } catch {
      // keep as-is
    }
  }
  return copy as Omit<T, "pdfData" | "vigilancePdfData">;
}

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

const MAX_DB_PDF_BYTES = 10 * 1024 * 1024;

function getWritableDataRoot(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), "go-project-hub-data");
  }
  return path.join(process.cwd(), ".data");
}

export function getStagedInvoicePdfPath(
  projectId: string,
  invoiceId: string
): string {
  return path.join(
    getWritableDataRoot(),
    "invoices",
    projectId,
    `${invoiceId}.pdf`
  );
}

export async function stageInvoicePdf(
  projectId: string,
  invoiceId: string,
  pdfBuffer: Buffer
): Promise<string | null> {
  const filePath = getStagedInvoicePdfPath(projectId, invoiceId);
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, pdfBuffer);
    return filePath;
  } catch {
    // Fallback cleanly to /tmp if primary path is read-only
    try {
      const tmpPath = path.join(
        os.tmpdir(),
        "go-project-hub-data",
        "invoices",
        projectId,
        `${invoiceId}.pdf`
      );
      await fs.promises.mkdir(path.dirname(tmpPath), { recursive: true });
      await fs.promises.writeFile(tmpPath, pdfBuffer);
      return tmpPath;
    } catch {
      return null;
    }
  }
}

export async function readStagedInvoicePdf(
  projectId: string,
  invoiceId: string,
  extractedJson?: string | null
): Promise<Buffer | null> {
  const candidates: string[] = [];
  if (extractedJson) {
    try {
      const parsed = JSON.parse(extractedJson) as {
        localPdfPath?: string;
        pdfBase64?: string;
      };
      if (typeof parsed.pdfBase64 === "string" && parsed.pdfBase64.length > 0) {
        return Buffer.from(parsed.pdfBase64, "base64");
      }
      if (parsed.localPdfPath) {
        candidates.push(parsed.localPdfPath);
      }
    } catch {
      // ignore invalid JSON
    }
  }
  candidates.push(getStagedInvoicePdfPath(projectId, invoiceId));
  candidates.push(
    path.join(
      os.tmpdir(),
      "go-project-hub-data",
      "invoices",
      projectId,
      `${invoiceId}.pdf`
    )
  );

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

function sanitizeAndEnrichExtraction(params: {
  geminiOutput: InvoiceExtractionOutput;
  localOutput: ReturnType<typeof extractInvoiceFieldsFromText>;
}): InvoiceExtractionOutput {
  const { geminiOutput, localOutput } = params;
  const warnings = [...(geminiOutput.rawWarnings ?? [])];

  // Never allow our own buyer identity (GamersOrigin / L'Intrus) as the vendor/prestataire!
  let prestataire = (geminiOutput.prestataire ?? "").trim();
  if (
    !prestataire ||
    isOwnCompanyName(prestataire) ||
    /^prestataire(?:\s+[àa]\s+v[ée]rifier)?$/i.test(prestataire)
  ) {
    if (
      localOutput.prestataire &&
      !isOwnCompanyName(localOutput.prestataire) &&
      localOutput.prestataire !== "Prestataire à vérifier"
    ) {
      prestataire = localOutput.prestataire;
    } else if (isOwnCompanyName(prestataire)) {
      prestataire = "";
      warnings.push(
        "Le nom détecté correspondait à GamersOrigin / L'Intrus (client) : vérifiez le nom du prestataire."
      );
    }
  }

  const numeroFacture =
    (geminiOutput.numeroFacture ?? "").trim() || localOutput.numeroFacture;
  const dateFacture =
    (geminiOutput.dateFacture ?? "").trim() || localOutput.dateFacture;
  const montantHT =
    geminiOutput.montantHT > 0 ? geminiOutput.montantHT : localOutput.montantHT;
  const montantTTC =
    geminiOutput.montantTTC > 0
      ? geminiOutput.montantTTC
      : localOutput.montantTTC;
  const tvaRate =
    geminiOutput.montantHT > 0 ? geminiOutput.tvaRate : localOutput.tvaRate;
  const prestationSummary =
    geminiOutput.prestationSummary &&
    geminiOutput.prestationSummary.trim() !== "" &&
    geminiOutput.prestationSummary.trim().toLowerCase() !== "prestation"
      ? geminiOutput.prestationSummary.trim()
      : localOutput.prestationSummary;

  const mergedCodes = normalizeProjectCodesList([
    geminiOutput.codeProjetDetecte,
    ...(geminiOutput.detectedProjectCodes ?? []),
    ...localOutput.detectedProjectCodes,
  ]);

  return {
    ...geminiOutput,
    prestataire: prestataire || "Prestataire à vérifier",
    numeroFacture,
    dateFacture,
    montantHT,
    tvaRate,
    montantTTC,
    prestationSummary,
    codeProjetDetecte:
      geminiOutput.codeProjetDetecte ?? localOutput.codeProjetDetecte,
    detectedProjectCodes: mergedCodes,
    suggestedQuoteId:
      geminiOutput.suggestedQuoteId ?? localOutput.suggestedQuoteId,
    rawWarnings: warnings,
  };
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
  getGoogleGateway?: (projectId?: string) => Promise<GoogleWorkspacePort>;
  project: Project;
  pdfBuffer: Buffer;
  filename: string;
  mimeType?: string | null;
  requestedBudgetLineId?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  gmailMessageId?: string | null;
  attachmentId?: string | null;
  uploadedById?: string | null;
  useSequentialInvoiceNumber?: boolean;
  quarantineOnConflictWithoutThrowing?: boolean;
  allowManualFallback?: boolean;
}): Promise<IngestInvoiceResult> {
  const {
    prisma,
    getGeminiClient,
    getGoogleGateway,
    project,
    pdfBuffer,
    filename,
    mimeType,
    requestedBudgetLineId,
    emailSubject,
    emailBody,
    gmailMessageId,
    attachmentId,
    uploadedById,
    useSequentialInvoiceNumber,
    quarantineOnConflictWithoutThrowing,
    allowManualFallback,
  } = params;

  // 1. Validate PDF MIME & magic bytes / structure BEFORE any DB writes
  validatePdfBuffer(pdfBuffer, mimeType, filename);

  // 2. Rich layout-preserving PDF text extraction (unpdf + deterministic fallback)
  const localPdfText = await extractRichTextFromPdfBuffer(pdfBuffer);

  // 3. Fetch project budget lines, quotes, and agency project codes for extraction & matching
  const [budgetLines, quotes, agencyProjects] = await Promise.all([
    prisma.budgetLine.findMany({
      where: { projectId: project.id },
      orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
    }),
    prisma.quote.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        quoteNumber: true,
        vendorName: true,
        amountHt: true,
        budgetLineId: true,
      },
    }),
    prisma.project.findMany({
      where: { isArchived: false },
      select: { codeProjet: true },
    }),
  ]);

  const knownProjectCodes = Array.from(
    new Set(agencyProjects.map((p) => p.codeProjet).filter(Boolean))
  );

  const localExtraction = extractInvoiceFieldsFromText({
    pdfText: localPdfText,
    filename,
    activeCodeProjet: project.codeProjet,
    knownProjectCodes,
    budgetLines,
    quotes,
    warningReason:
      "Extraction locale effectuée (IA Gemini indisponible) : vérifiez les champs pré-remplis.",
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

  // 4. Gemini multimodal extraction (with rich local extraction merge & safe fallback!)
  const geminiInput = {
    pdfBuffer,
    filename,
    emailSubject: emailSubject ?? undefined,
    projectContext: {
      codeProjet: project.codeProjet,
      client: project.client,
      nomJeu: project.nomJeu,
    },
    allProjectCodes: knownProjectCodes,
    budgetLines: budgetLines.map((l) => ({
      id: l.id,
      category: l.category,
      objet: l.objet,
      realisePar: l.realisePar,
      preOpTotalHt: l.preOpTotalHt,
    })),
    quotes,
  };

  let extracted: InvoiceExtractionOutput;
  if (allowManualFallback) {
    try {
      const gemini = await getGeminiClient();
      const geminiRaw = await gemini.extractInvoiceFromPdf(geminiInput);
      extracted = sanitizeAndEnrichExtraction({
        geminiOutput: geminiRaw,
        localOutput: localExtraction,
      });
    } catch {
      extracted = localExtraction;
    }
  } else {
    const gemini = await getGeminiClient();
    const geminiRaw = await gemini.extractInvoiceFromPdf(geminiInput);
    extracted = sanitizeAndEnrichExtraction({
      geminiOutput: geminiRaw,
      localOutput: localExtraction,
    });
  }

  const pdfBytes =
    pdfBuffer.length <= MAX_DB_PDF_BYTES ? new Uint8Array(pdfBuffer) : undefined;

  const amountHt = round2(Math.max(0, extracted.montantHT));
  let tvaAmount = 0;
  let amountTtc = amountHt;

  if (useSequentialInvoiceNumber) {
    // Interactive uploads track Montant HT only (TVA removed by user request)
    tvaAmount = 0;
    amountTtc = amountHt;
    extracted.tvaRate = 0;
    extracted.montantTTC = amountHt;
  } else {
    const rawTvaRate = Number.isFinite(extracted.tvaRate)
      ? Math.max(0, extracted.tvaRate)
      : 0;
    tvaAmount = round2(Math.max(0, extracted.montantTTC - amountHt));
    if (
      tvaAmount === 0 &&
      rawTvaRate > 0 &&
      amountHt > 0 &&
      extracted.montantTTC <= amountHt
    ) {
      tvaAmount = round2(amountHt * (rawTvaRate / 100));
    }
    amountTtc =
      extracted.montantTTC > 0
        ? round2(extracted.montantTTC)
        : round2(amountHt + tvaAmount);
  }

  // Keep supplier's raw invoice reference, and allocate atomic sequential 1..N number if requested
  const supplierInvoiceNumber = (extracted.numeroFacture ?? "").trim();
  const existingProjectInvoices = await prisma.invoice.findMany({
    where: {
      projectId: project.id,
      status: { not: "REJECTED" },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      invoiceNumber: true,
      supplierInvoiceNumber: true,
    },
  });

  let assignedInvoiceNumber = supplierInvoiceNumber;
  if (useSequentialInvoiceNumber) {
    const seqResult = await computeNextInvoiceNumberFromDrive({
      prisma,
      projectId: project.id,
      uploadedById,
      getGoogleGateway,
    });
    assignedInvoiceNumber = seqResult.nextNumber;
  }

  // Auto-attach valid Vendor URSSAF attestation (< 6 months old) from Coffre Prestataires
  const validVendorVigilance = await findValidVendorVigilance(
    prisma,
    extracted.prestataire
  ).catch(() => null);

  // Auto-match Quote from PDF text / vendor / HT amount
  const matchedQuote = matchQuoteForInvoice(quotes, {
    pdfText: `${localPdfText}\n${extracted.extractedRawTextSnippet ?? ""}`,
    vendorName: extracted.prestataire,
    amountHt,
  });
  const suggestedQuoteId =
    extracted.suggestedQuoteId ?? matchedQuote?.id ?? null;

  // 6. Deterministic Zero-Mix CP Conflict Guardrail
  const combinedText = [
    filename,
    emailSubject,
    emailBody,
    localPdfText,
    extracted.extractedRawTextSnippet,
    extracted.prestationSummary,
    extracted.prestataire,
    supplierInvoiceNumber,
  ]
    .filter(Boolean)
    .join("\n");

  const cpCheck = checkCodeProjetConflict(
    project.codeProjet,
    extracted.codeProjetDetecte,
    combinedText
  );

  const detectedProjectCodes = normalizeProjectCodesList(
    [
      ...cpCheck.detectedCps,
      ...(extracted.detectedProjectCodes ?? []),
      extracted.codeProjetDetecte,
    ],
    project.codeProjet
  );

  const autoRenamedFilename = buildValidatedInvoiceFilename({
    invoiceNumber: assignedInvoiceNumber,
    invoiceDate: extracted.dateFacture,
    codeProjet: detectedProjectCodes.join("-"),
    vendorName: extracted.prestataire,
    amountHt,
  });

  if (cpCheck.hasConflict) {
    const blocked = await prisma.invoice.create({
      data: {
        projectId: project.id,
        uploadedById: uploadedById ?? null,
        budgetLineId: matchedQuote?.budgetLineId ?? null,
        quoteId: suggestedQuoteId,
        gmailMessageId: gmailMessageId ?? null,
        originalFilename: filename,
        renamedFilename: autoRenamedFilename,
        vendorName: extracted.prestataire,
        invoiceNumber: assignedInvoiceNumber,
        supplierInvoiceNumber: supplierInvoiceNumber || null,
        invoiceDate: extracted.dateFacture,
        amountHt,
        tvaAmount,
        amountTtc,
        invoiceType: extracted.typeFacture,
        prestationLabel: extracted.prestationSummary,
        detectedCodeProjet:
          cpCheck.conflictingCps[0] ?? extracted.codeProjetDetecte ?? null,
        projectCodesJson: JSON.stringify(detectedProjectCodes),
        vigilanceDriveFileId: validVendorVigilance?.vigilanceDriveFileId ?? null,
        vigilanceFilename: validVendorVigilance?.vigilanceFilename ?? null,
        ...(pdfBytes ? { pdfData: pdfBytes } : {}),
        cpConflict: true,
        status: "CONFLICT_BLOCKED",
        extractedJson: JSON.stringify({
          ...extracted,
          supplierInvoiceNumber: supplierInvoiceNumber || null,
          localPdfTextSnippet: localPdfText.slice(0, 500),
          cpCheck,
          attachmentId: attachmentId ?? null,
        }),
      },
    });

    await stageInvoicePdf(project.id, blocked.id, pdfBuffer);

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

  // 7. Duplicate supplier invoiceNumber detection within project (indexed, zero extractedJson scan!)
  const normSupplierNum = normalizeInvoiceNumber(supplierInvoiceNumber);
  let duplicateOf: { id: string; status: string } | null = null;
  if (normSupplierNum) {
    duplicateOf =
      existingProjectInvoices.find(
        (inv) =>
          normalizeInvoiceNumber(inv.invoiceNumber) === normSupplierNum ||
          normalizeInvoiceNumber(inv.supplierInvoiceNumber) === normSupplierNum
      ) ?? null;
  }

  const isDuplicate = Boolean(duplicateOf);
  const warnings = [...(extracted.rawWarnings ?? [])];
  if (isDuplicate && duplicateOf) {
    warnings.push(
      `Doublon détecté : le N° Facture ${supplierInvoiceNumber} existe déjà sur ce projet (statut ${duplicateOf.status}).`
    );
  }
  if (!localPdfText.trim() && amountHt === 0) {
    warnings.push(
      "PDF sans texte extractible et montant HT nul : vérifiez les champs avant validation."
    );
  }

  // 8. Suggest BudgetLine (prioritize requested, quote-linked, Gemini, vendor/keyword match, or single line)
  const suggestedBudgetLineId =
    suggestBudgetLineForInvoice(budgetLines, {
      requestedBudgetLineId: requestedBudgetLineId ?? matchedQuote?.budgetLineId,
      geminiSuggestedId: extracted.suggestedBudgetLineId,
      geminiSuggestedLabel: extracted.suggestedBudgetLineLabel,
      vendorName: extracted.prestataire,
      prestationSummary: extracted.prestationSummary,
      filename,
    }) ?? (budgetLines.length === 1 ? budgetLines[0].id : null);

  // 9. Create Invoice with per-user owner, sequential 1..N number, and auto-renamed filename
  const created = await prisma.invoice.create({
    data: {
      projectId: project.id,
      uploadedById: uploadedById ?? null,
      budgetLineId: suggestedBudgetLineId,
      quoteId: suggestedQuoteId,
      gmailMessageId: gmailMessageId ?? null,
      originalFilename: filename,
      renamedFilename: autoRenamedFilename,
      vendorName: extracted.prestataire,
      invoiceNumber: assignedInvoiceNumber,
      supplierInvoiceNumber: supplierInvoiceNumber || null,
      invoiceDate: extracted.dateFacture,
      amountHt,
      tvaAmount,
      amountTtc,
      invoiceType: extracted.typeFacture,
      prestationLabel: extracted.prestationSummary,
      detectedCodeProjet:
        extracted.codeProjetDetecte ??
        (cpCheck.detectedCps[0] || project.codeProjet),
      projectCodesJson: JSON.stringify(detectedProjectCodes),
      vigilanceDriveFileId: validVendorVigilance?.vigilanceDriveFileId ?? null,
      vigilanceFilename: validVendorVigilance?.vigilanceFilename ?? null,
      ...(pdfBytes ? { pdfData: pdfBytes } : {}),
      cpConflict: false,
      status: "PENDING_VALIDATION",
      extractedJson: JSON.stringify({
        ...extracted,
        supplierInvoiceNumber: supplierInvoiceNumber || null,
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
        supplierInvoiceNumber: supplierInvoiceNumber || null,
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
