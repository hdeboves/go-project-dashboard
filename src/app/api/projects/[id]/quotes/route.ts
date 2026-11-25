import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { round2 } from "@/lib/budget/calculator";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { parseFrenchAmount } from "@/lib/shared/format";

const MAX_QUOTE_PDF_BYTES = 15 * 1024 * 1024;

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

export async function formatQuotesForProject(projectId: string) {
  const quotes = await prisma.quote.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }],
    include: {
      budgetLine: {
        select: { id: true, category: true, objet: true },
      },
      invoices: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          invoiceNumber: true,
          vendorName: true,
          invoiceDate: true,
          amountHt: true,
          amountTtc: true,
          status: true,
          renamedFilename: true,
          originalFilename: true,
          driveFileId: true,
          budgetLineId: true,
        },
      },
    },
  });

  return quotes.map((q) => {
    const invoicedTotalHt = round2(
      q.invoices.reduce((sum, inv) => sum + (inv.amountHt || 0), 0)
    );
    const remainingHt = round2(q.amountHt - invoicedTotalHt);
    const invoicedPct =
      q.amountHt > 0
        ? Math.round((invoicedTotalHt / q.amountHt) * 100)
        : invoicedTotalHt > 0
          ? 100
          : 0;

    return {
      ...q,
      hasPdf: Boolean(q.localPdfPath || q.driveFileId),
      invoicedTotalHt,
      remainingHt,
      invoicedPct,
      overQuote: invoicedTotalHt > 0 && invoicedTotalHt > q.amountHt,
    };
  });
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "VIEW");

    const quotes = await formatQuotesForProject(id);
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
        tvaAmount:
          formData.get("tvaAmount") !== null && formData.get("tvaAmount") !== ""
            ? parseFrenchAmount(String(formData.get("tvaAmount")))
            : undefined,
        amountTtc:
          formData.get("amountTtc") !== null && formData.get("amountTtc") !== ""
            ? parseFrenchAmount(String(formData.get("amountTtc")))
            : undefined,
        status: String(formData.get("status") ?? "EN_ATTENTE"),
        budgetLineId: String(formData.get("budgetLineId") ?? "") || null,
        notes: String(formData.get("notes") ?? "") || null,
        linkedInvoiceIds,
      };
    } else {
      rawPayload = (await req.json()) as Record<string, unknown>;
    }

    const input = CreateQuoteSchema.parse(rawPayload);

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
    const tvaAmount = round2(
      input.tvaAmount !== undefined ? input.tvaAmount : amountHt * 0.2
    );
    const amountTtc = round2(
      input.amountTtc !== undefined ? input.amountTtc : amountHt + tvaAmount
    );

    let quote = await prisma.quote.create({
      data: {
        projectId: id,
        budgetLineId: input.budgetLineId || null,
        quoteNumber: input.quoteNumber,
        vendorName: input.vendorName,
        description: input.description || null,
        issueDate: input.issueDate || new Date().toISOString().slice(0, 10),
        validUntil: input.validUntil || null,
        amountHt,
        tvaAmount,
        amountTtc,
        status: input.status ?? "EN_ATTENTE",
        originalFilename: uploadedFile?.name ?? null,
        notes: input.notes || null,
      },
    });

    if (uploadedFile) {
      if (uploadedFile.size > MAX_QUOTE_PDF_BYTES) {
        throw new AppHttpError(
          413,
          "PDF_TOO_LARGE",
          "Le fichier devis dépasse la taille maximale autorisée (15 Mo)."
        );
      }
      const pdfBuf = Buffer.from(await uploadedFile.arrayBuffer());
      if (pdfBuf.length < 5 || pdfBuf.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new AppHttpError(
          400,
          "INVALID_PDF",
          "Le fichier envoyé n'est pas un PDF valide."
        );
      }
      const filePath = path.join(
        process.cwd(),
        ".data",
        "quotes",
        id,
        `${quote.id}.pdf`
      );
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, pdfBuf);
      quote = await prisma.quote.update({
        where: { id: quote.id },
        data: { localPdfPath: filePath },
      });
    }

    if (input.linkedInvoiceIds && input.linkedInvoiceIds.length > 0) {
      await prisma.invoice.updateMany({
        where: {
          projectId: id,
          id: { in: input.linkedInvoiceIds },
        },
        data: { quoteId: quote.id },
      });
    }

    await prisma.auditLog.create({
      data: {
        projectId: id,
        actor: currentUser?.email ?? "user",
        action: "QUOTE_CREATED",
        targetType: "QUOTE",
        targetId: quote.id,
        detailsJson: JSON.stringify({
          quoteNumber: quote.quoteNumber,
          vendorName: quote.vendorName,
          amountHt: quote.amountHt,
          linkedInvoicesCount: input.linkedInvoiceIds?.length ?? 0,
        }),
      },
    });

    const quotes = await formatQuotesForProject(id);
    const createdFormatted = quotes.find((q) => q.id === quote.id) ?? quote;
    return NextResponse.json(
      { ok: true, quote: createdFormatted, quotes },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
