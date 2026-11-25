import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { round2 } from "@/lib/budget/calculator";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { formatQuotesForProject } from "@/app/api/projects/[id]/quotes/route";

const UpdateQuoteSchema = z.object({
  quoteNumber: z.string().trim().min(1).optional(),
  vendorName: z.string().trim().min(1).optional(),
  description: z.string().trim().nullable().optional(),
  issueDate: z.string().trim().nullable().optional(),
  validUntil: z.string().trim().nullable().optional(),
  amountHt: z.number().finite().min(0).optional(),
  tvaAmount: z.number().finite().min(0).optional(),
  amountTtc: z.number().finite().min(0).optional(),
  status: z
    .enum(["BROUILLON", "EN_ATTENTE", "ACCEPTE", "REFUSE", "FACTURE"])
    .optional(),
  budgetLineId: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  linkedInvoiceIds: z.array(z.string().min(1)).optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; quoteId: string }> }
) {
  try {
    const { id, quoteId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");

    const existing = await prisma.quote.findUnique({
      where: { id: quoteId },
    });
    if (!existing || existing.projectId !== id) {
      throw new AppHttpError(404, "QUOTE_NOT_FOUND", "Devis introuvable.");
    }

    const input = UpdateQuoteSchema.parse(await req.json());

    const nextAmountHt =
      input.amountHt !== undefined ? round2(input.amountHt) : existing.amountHt;
    const nextTva =
      input.tvaAmount !== undefined
        ? round2(input.tvaAmount)
        : input.amountHt !== undefined
          ? round2(nextAmountHt * 0.2)
          : existing.tvaAmount;
    const nextTtc =
      input.amountTtc !== undefined
        ? round2(input.amountTtc)
        : input.amountHt !== undefined || input.tvaAmount !== undefined
          ? round2(nextAmountHt + nextTva)
          : existing.amountTtc;

    await prisma.$transaction(async (tx) => {
      if (input.budgetLineId) {
        const bl = await tx.budgetLine.findUnique({
          where: { id: input.budgetLineId },
          select: { id: true, projectId: true },
        });
        if (!bl || bl.projectId !== id) {
          throw new AppHttpError(
            400,
            "INVALID_BUDGET_LINE",
            "Poste budgétaire introuvable pour ce projet."
          );
        }
      }

      await tx.quote.update({
        where: { id: quoteId },
        data: {
          ...(input.quoteNumber !== undefined
            ? { quoteNumber: input.quoteNumber }
            : {}),
          ...(input.vendorName !== undefined
            ? { vendorName: input.vendorName }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.issueDate !== undefined
            ? { issueDate: input.issueDate }
            : {}),
          ...(input.validUntil !== undefined
            ? { validUntil: input.validUntil }
            : {}),
          amountHt: nextAmountHt,
          tvaAmount: nextTva,
          amountTtc: nextTtc,
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.budgetLineId !== undefined
            ? { budgetLineId: input.budgetLineId || null }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });

      if (input.linkedInvoiceIds !== undefined) {
        // Unlink previously linked invoices no longer in the list
        await tx.invoice.updateMany({
          where: {
            projectId: id,
            quoteId,
            id: { notIn: input.linkedInvoiceIds },
          },
          data: { quoteId: null },
        });
        // Link all selected invoices (belongs strictly to this project)
        if (input.linkedInvoiceIds.length > 0) {
          await tx.invoice.updateMany({
            where: {
              projectId: id,
              id: { in: input.linkedInvoiceIds },
            },
            data: { quoteId },
          });
        }
      }
    });

    await prisma.auditLog.create({
      data: {
        projectId: id,
        actor: currentUser?.email ?? "user",
        action: "QUOTE_UPDATED",
        targetType: "QUOTE",
        targetId: quoteId,
        detailsJson: JSON.stringify({
          status: input.status ?? existing.status,
          linkedInvoiceIds: input.linkedInvoiceIds,
        }),
      },
    });

    const quotes = await formatQuotesForProject(id);
    return NextResponse.json({
      ok: true,
      quote: quotes.find((q) => q.id === quoteId) ?? null,
      quotes,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; quoteId: string }> }
) {
  try {
    const { id, quoteId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");

    const existing = await prisma.quote.findUnique({ where: { id: quoteId } });
    if (!existing || existing.projectId !== id) {
      throw new AppHttpError(404, "QUOTE_NOT_FOUND", "Devis introuvable.");
    }

    await prisma.quote.delete({ where: { id: quoteId } });
    if (existing.localPdfPath) {
      await fs.promises.unlink(existing.localPdfPath).catch(() => undefined);
    }
    await prisma.auditLog.create({
      data: {
        projectId: id,
        actor: currentUser?.email ?? "user",
        action: "QUOTE_DELETED",
        targetType: "QUOTE",
        targetId: quoteId,
        detailsJson: JSON.stringify({ quoteNumber: existing.quoteNumber }),
      },
    });

    const quotes = await formatQuotesForProject(id);
    return NextResponse.json({ ok: true, deletedId: quoteId, quotes });
  } catch (err) {
    return toErrorResponse(err);
  }
}
