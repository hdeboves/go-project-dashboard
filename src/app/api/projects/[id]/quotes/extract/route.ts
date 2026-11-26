import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { normalizeProjectCodesList } from "@/lib/invoices/accounting-email";
import {
  extractInvoiceFieldsFromText,
  isOwnCompanyName,
} from "@/lib/invoices/local-extractor";
import { resolveDriveQuoteBaseSequence } from "@/lib/invoices/numbering";
import {
  extractRichTextFromPdfBuffer,
  validatePdfBuffer,
} from "@/lib/invoices/pdf-text";
import { checkCodeProjetConflict } from "@/lib/isolation/cp-guard";
import { prisma } from "@/lib/prisma";
import { getParisTodayIso } from "@/lib/shared/dates";
import { findValidVendorVigilance } from "@/lib/vendors/vendor-service";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File) || file.size === 0) {
      throw new AppHttpError(
        400,
        "PDF_REQUIRED",
        "Veuillez sélectionner un devis PDF à analyser."
      );
    }

    const batchOffsetRaw = Number(formData.get("batchOffset") ?? "0");
    const batchOffset =
      Number.isFinite(batchOffsetRaw) && batchOffsetRaw > 0
        ? Math.floor(batchOffsetRaw)
        : 0;

    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    validatePdfBuffer(pdfBuffer, file.type, file.name);

    const { getGeminiClient, getGoogleGateway } = getServices();

    const [budgetLines, agencyProjects, driveSeq] = await Promise.all([
      prisma.budgetLine.findMany({
        where: { projectId: id },
        select: {
          id: true,
          category: true,
          objet: true,
          realisePar: true,
          preOpTotalHt: true,
        },
      }),
      prisma.project.findMany({
        where: { isArchived: false },
        select: { codeProjet: true },
      }),
      resolveDriveQuoteBaseSequence({
        prisma,
        projectId: id,
        getGoogleGateway,
      }),
    ]);

    const knownProjectCodes = Array.from(
      new Set(agencyProjects.map((p) => p.codeProjet).filter(Boolean))
    );

    const extractedText = await extractRichTextFromPdfBuffer(pdfBuffer);
    const local = extractInvoiceFieldsFromText({
      pdfText: extractedText,
      filename: file.name,
      activeCodeProjet: project.codeProjet,
      knownProjectCodes,
      budgetLines,
    });

    let vendorName =
      local.prestataire &&
      local.prestataire !== "Prestataire à vérifier" &&
      !isOwnCompanyName(local.prestataire)
        ? local.prestataire
        : "";
    let supplierQuoteRef = local.numeroFacture ?? "";
    let issueDate = local.dateFacture || getParisTodayIso();
    let amountHt = local.montantHT ?? 0;
    let description = local.prestationSummary ?? "";
    let suggestedBudgetLineId = local.suggestedBudgetLineId ?? null;
    let aiDetectedCodes: string[] = [];

    if (!vendorName || !amountHt || !supplierQuoteRef) {
      try {
        const gemini = await getGeminiClient();
        const ai = await gemini.extractInvoiceFromPdf({
          pdfBuffer,
          filename: file.name,
          projectContext: {
            codeProjet: project.codeProjet,
            client: project.client,
            nomJeu: project.nomJeu,
          },
          allProjectCodes: knownProjectCodes,
          budgetLines,
        });
        if (
          !vendorName &&
          ai.prestataire &&
          !isOwnCompanyName(ai.prestataire) &&
          ai.prestataire !== "Prestataire à vérifier"
        ) {
          vendorName = ai.prestataire.trim();
        }
        if (!supplierQuoteRef && ai.numeroFacture) {
          supplierQuoteRef = ai.numeroFacture.trim();
        }
        if (ai.dateFacture) issueDate = ai.dateFacture;
        if (!amountHt && ai.montantHT > 0) amountHt = ai.montantHT;
        if (
          (!description || description === "Prestation") &&
          ai.prestationSummary
        ) {
          description = ai.prestationSummary.trim();
        }
        if (!suggestedBudgetLineId && ai.suggestedBudgetLineId) {
          suggestedBudgetLineId = ai.suggestedBudgetLineId;
        }
        aiDetectedCodes = [
          ...(ai.detectedProjectCodes ?? []),
          ...(ai.codeProjetDetecte ? [ai.codeProjetDetecte] : []),
        ];
      } catch {
        // Local extraction fallback is already populated
      }
    }

    if (!supplierQuoteRef) {
      const m = `${file.name} ${extractedText}`.match(
        /\b(?:DEVIS|DEV|D|Q)[-_/\s#]?(\d{2,6}(?:[-/]\d{1,5})?)\b/i
      );
      if (m) supplierQuoteRef = m[0].replace(/\s+/g, "-").toUpperCase();
    }

    // Multi-CP & CP conflict detection (exact parity with invoice flow)
    const combinedText = [
      file.name,
      extractedText,
      vendorName,
      supplierQuoteRef,
      description,
    ]
      .filter(Boolean)
      .join("\n");

    const cpCheck = checkCodeProjetConflict(
      project.codeProjet,
      local.codeProjetDetecte,
      combinedText
    );
    const detectedProjectCodes = normalizeProjectCodesList(
      [
        ...cpCheck.detectedCps,
        ...aiDetectedCodes,
        ...local.detectedProjectCodes,
      ],
      project.codeProjet
    );

    const sequentialQuoteNumber = String(driveSeq.baseSeq + 1 + batchOffset);

    // Check Vendor URSSAF Vault (< 6 months valid attestation)
    const validVendorVigilance = vendorName
      ? await findValidVendorVigilance(prisma, vendorName).catch(() => null)
      : null;

    return NextResponse.json({
      ok: true,
      extracted: {
        quoteNumber: sequentialQuoteNumber,
        supplierQuoteRef: supplierQuoteRef || null,
        vendorName,
        issueDate,
        amountHt,
        description: description || "Prestation",
        suggestedBudgetLineId:
          suggestedBudgetLineId ??
          (budgetLines.length === 1 ? budgetLines[0].id : null),
        detectedProjectCodes,
        cpConflict: cpCheck.hasConflict,
        conflictingCps: cpCheck.conflictingCps,
        driveBaseSeq: driveSeq.baseSeq,
        vigilanceVault: validVendorVigilance
          ? {
              driveFileId: validVendorVigilance.vigilanceDriveFileId,
              filename: validVendorVigilance.vigilanceFilename,
            }
          : null,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
