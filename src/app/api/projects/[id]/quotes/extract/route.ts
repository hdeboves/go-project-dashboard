import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { extractInvoiceFieldsFromText } from "@/lib/invoices/local-extractor";
import {
  extractRichTextFromPdfBuffer,
  validatePdfBuffer,
} from "@/lib/invoices/pdf-text";
import { prisma } from "@/lib/prisma";

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

    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    validatePdfBuffer(pdfBuffer, file.type, file.name);

    const budgetLines = await prisma.budgetLine.findMany({
      where: { projectId: id },
      select: {
        id: true,
        category: true,
        objet: true,
        realisePar: true,
        preOpTotalHt: true,
      },
    });

    const extractedText = await extractRichTextFromPdfBuffer(pdfBuffer);
    const local = extractInvoiceFieldsFromText({
      pdfText: extractedText,
      filename: file.name,
      activeCodeProjet: project.codeProjet,
      budgetLines,
    });

    let vendorName = local.prestataire ?? "";
    let quoteNumber = local.numeroFacture ?? "";
    let issueDate = local.dateFacture || new Date().toISOString().slice(0, 10);
    let amountHt = local.montantHT ?? 0;
    let description = local.prestationSummary ?? "";
    let suggestedBudgetLineId = local.suggestedBudgetLineId ?? null;

    if (!vendorName || !amountHt || !quoteNumber) {
      try {
        const { getGeminiClient } = getServices();
        const gemini = await getGeminiClient();
        const ai = await gemini.extractInvoiceFromPdf({
          pdfBuffer,
          filename: file.name,
          projectContext: {
            codeProjet: project.codeProjet,
            client: project.client,
            nomJeu: project.nomJeu,
          },
          budgetLines,
        });
        if (!vendorName && ai.prestataire) vendorName = ai.prestataire;
        if (!quoteNumber && ai.numeroFacture) quoteNumber = ai.numeroFacture;
        if (ai.dateFacture) issueDate = ai.dateFacture;
        if (!amountHt && ai.montantHT > 0) amountHt = ai.montantHT;
        if (!description && ai.prestationSummary) {
          description = ai.prestationSummary;
        }
        if (!suggestedBudgetLineId && ai.suggestedBudgetLineId) {
          suggestedBudgetLineId = ai.suggestedBudgetLineId;
        }
      } catch {
        // Local extraction fallback is already populated
      }
    }

    if (!quoteNumber) {
      const m = `${file.name} ${extractedText}`.match(
        /\b(?:DEVIS|DEV|D|Q)[-_/\s#]?(\d{2,6}(?:[-/]\d{1,5})?)\b/i
      );
      if (m) quoteNumber = m[0].replace(/\s+/g, "-").toUpperCase();
    }

    return NextResponse.json({
      ok: true,
      extracted: {
        quoteNumber:
          quoteNumber ||
          `DEV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
        vendorName,
        issueDate,
        amountHt,
        description,
        suggestedBudgetLineId,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
