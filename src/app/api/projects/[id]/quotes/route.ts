import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  assertProjectAccess,
  buildVisibleInvoicesWhere,
  getCurrentUser,
} from "@/lib/auth/session";
import { round2 } from "@/lib/budget/calculator";
import { getServices } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { formatQuotesForProject } from "@/lib/quotes/quote-service";
import { getParisTodayIso } from "@/lib/shared/dates";
import { parseFrenchAmount } from "@/lib/shared/format";

const MAX_QUOTE_PDF_BYTES = 10 * 1024 * 1024;

const CreateQuoteSchema = z.object({
  quoteNumber: z.string().trim().min(1, "Le numéro de devis est requis."),
  vendorName: z.string().trim().min(1, "Le nom du prestataire est requis."),
  description: z.string().trim().nullable().optional(),
  issueDate: z.string().trim().nullable().optional(),
  validUntil: z.string().trim().nullable().optional(),
  amountHt: z.number().finite().min(0),
  tvaAmount: z.number().finite().min(0).optional(),
  amountTtc: z.number().finite().min(0).optional(),
  status: z
    .enum(["BROUILLON", "EN_ATTENTE", "ACCEPTE", "REFUSE", "FACTURE"])
    .optional(),
  budgetLineId: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  linkedInvoiceIds: z.array(z.string().min(1)).optional(),
});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "VIEW");

    const quotes = await formatQuotesForProject(id, currentUser);
    const activeQuotes = quotes.filter(
      (q) => q.status === "ACCEPTE" || q.status === "FACTURE"
    );
    const acceptedTotalHt = round2(
      activeQuotes.reduce((s, q) => s + q.amountHt, 0)
    );
    const invoicedOnAcceptedHt = round2(
      activeQuotes.reduce((s, q) => s + q.invoicedTotalHt, 0)
    );
    const totalInvoicedOnQuotesHt = round2(
      quotes.reduce((s, q) => s + q.invoicedTotalHt, 0)
    );

    return NextResponse.json({
      quotes,
      summary: {
        totalQuotes: quotes.length,
        acceptedTotalHt,
        totalInvoicedOnQuotesHt,
        remainingToInvoiceHt: round2(
          Math.max(0, acceptedTotalHt - invoicedOnAcceptedHt)
        ),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

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

    const contentType = req.headers.get("content-type") ?? "";
    let rawPayload: Record<string, unknown> = {};
    let uploadedFile: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const fileEntry = formData.get("file");
      if (fileEntry && fileEntry instanceof File && fileEntry.size > 0) {
        uploadedFile = fileEntry;
      }
      const linkedRaw = formData.get("linkedInvoiceIds");
      let linkedInvoiceIds: string[] | undefined;
      if (typeof linkedRaw === "string" && linkedRaw.trim()) {
        try {
          const parsed = JSON.parse(linkedRaw);
          if (Array.isArray(parsed)) linkedInvoiceIds = parsed;
        } catch {
          linkedInvoiceIds = undefined;
        }
      }
      rawPayload = {
        quoteNumber: String(formData.get("quoteNumber") ?? ""),
        vendorName: String(formData.get("vendorName") ?? ""),
        description: String(formData.get("description") ?? "") || null,
        issueDate: String(formData.get("issueDate") ?? "") || null,
        validUntil: String(formData.get("validUntil") ?? "") || null,
        amountHt: parseFrenchAmount(String(formData.get("amountHt") ?? "0")),
        status: String(formData.get("status") ?? "EN_ATTENTE"),
        budgetLineId: String(formData.get("budgetLineId") ?? "") || null,
        notes: String(formData.get("notes") ?? "") || null,
        linkedInvoiceIds,
      };
    } else {
      rawPayload = (await req.json()) as Record<string, unknown>;
    }

    const input = CreateQuoteSchema.parse(rawPayload);

    // Validate uploaded PDF BEFORE any database writes (prevents orphan quotes!)
    let validatedPdfBuf: Buffer | null = null;
    if (uploadedFile) {
      if (uploadedFile.size > MAX_QUOTE_PDF_BYTES) {
        throw new AppHttpError(
          413,
          "PDF_TOO_LARGE",
          "Le fichier devis dépasse la taille maximale autorisée (10 Mo)."
        );
      }
      const buf = Buffer.from(await uploadedFile.arrayBuffer());
      if (buf.length < 5 || buf.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new AppHttpError(
          400,
          "INVALID_PDF",
          "Le fichier envoyé n'est pas un PDF valide."
        );
      }
      validatedPdfBuf = buf;
    }

    if (input.budgetLineId) {
      const bl = await prisma.budgetLine.findUnique({
        where: { id: input.budgetLineId },
      });
      if (!bl || bl.projectId !== id) {
        throw new AppHttpError(
          400,
          "INVALID_BUDGET_LINE",
          "Poste budgétaire introuvable pour ce projet."
        );
      }
    }

    const amountHt = round2(input.amountHt);
    const tvaAmount = 0;
    const amountTtc = amountHt;

    // Best-effort durable Drive upload into 001.2 Devis (fallback to Postgres pdfData Bytes!)
    let driveFileId: string | null = null;
    if (validatedPdfBuf && uploadedFile) {
      try {
        const { getGoogleGateway } = getServices();
        const gateway = await getGoogleGateway(id);
        const folder0012 = await prisma.driveNode.findFirst({
          where: { projectId: id, code: "001.2" },
        });
        const parentId = folder0012?.driveFileId ?? project.driveInternalRootId;
        if (parentId) {
          const uploaded = await gateway.drive.createFile({
            name: uploadedFile.name || `Devis_${input.quoteNumber}.pdf`,
            parentId,
            mimeType: "application/pdf",
            body: validatedPdfBuf,
          });
          driveFileId = uploaded.id;
        }
      } catch {
        // Google not connected — Postgres pdfData column persists the PDF durably across lambdas
      }
    }

    const quote = await prisma.$transaction(async (tx) => {
      const created = await tx.quote.create({
        data: {
          projectId: id,
          budgetLineId: input.budgetLineId || null,
          quoteNumber: input.quoteNumber,
          vendorName: input.vendorName,
          description: input.description || null,
          issueDate: input.issueDate || getParisTodayIso(),
          validUntil: input.validUntil || null,
          amountHt,
          tvaAmount,
          amountTtc,
          status: input.status ?? "EN_ATTENTE",
          originalFilename: uploadedFile?.name ?? null,
          driveFileId,
          pdfData:
            validatedPdfBuf && !driveFileId
              ? new Uint8Array(validatedPdfBuf)
              : null,
          notes: input.notes || null,
        },
      });

      if (input.linkedInvoiceIds && input.linkedInvoiceIds.length > 0) {
        await tx.invoice.updateMany({
          where: {
            ...buildVisibleInvoicesWhere(id, currentUser),
            id: { in: input.linkedInvoiceIds },
          },
          data: { quoteId: created.id },
        });
      }

      await tx.auditLog.create({
        data: {
          projectId: id,
          actor: currentUser?.email ?? "user",
          action: "QUOTE_CREATED",
          targetType: "QUOTE",
          targetId: created.id,
          detailsJson: JSON.stringify({
            quoteNumber: created.quoteNumber,
            vendorName: created.vendorName,
            amountHt: created.amountHt,
            linkedInvoicesCount: input.linkedInvoiceIds?.length ?? 0,
            uploadedToDrive: Boolean(driveFileId),
          }),
        },
      });

      return created;
    });

    const quotes = await formatQuotesForProject(id, currentUser);
    const createdFormatted = quotes.find((q) => q.id === quote.id) ?? quote;
    return NextResponse.json(
      { ok: true, quote: createdFormatted, quotes },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
