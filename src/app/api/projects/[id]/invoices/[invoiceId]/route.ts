import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  assertInvoiceOwnerAccess,
  assertProjectAccess,
  getCurrentUser,
} from "@/lib/auth/session";
import { round2 } from "@/lib/budget/calculator";
import { normalizeProjectCodesList } from "@/lib/invoices/accounting-email";
import { getStagedInvoicePdfPath, stripInvoiceBinaries } from "@/lib/invoices/ingest";
import { prisma } from "@/lib/prisma";
import { getParisTodayIso } from "@/lib/shared/dates";
import { buildValidatedInvoiceFilename } from "@/lib/shared/filenames";

const PatchInvoiceSchema = z.object({
  vendorName: z.string().trim().optional(),
  invoiceNumber: z.string().trim().optional(),
  invoiceDate: z.string().trim().optional(),
  amountHt: z.number().finite().min(0).optional(),
  amountTtc: z.number().finite().min(0).optional(),
  prestationLabel: z.string().trim().optional(),
  budgetLineId: z.string().nullable().optional(),
  quoteId: z.string().nullable().optional(),
  projectCodes: z.array(z.string().trim().min(1)).optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; invoiceId: string }> }
) {
  try {
    const { id: projectId, invoiceId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, projectId, currentUser, "EDIT");

    const body = PatchInvoiceSchema.parse(await req.json().catch(() => ({})));

    const [project, existing] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.invoice.findFirst({ where: { id: invoiceId, projectId } }),
    ]);

    if (!project || !existing) {
      return NextResponse.json(
        { error: "Facture introuvable pour ce projet." },
        { status: 404 }
      );
    }

    assertInvoiceOwnerAccess(existing, currentUser);

    if (existing.status === "VALIDATED") {
      return NextResponse.json(
        { error: "Impossible de modifier une facture déjà validée." },
        { status: 400 }
      );
    }

    const vendorName =
      body.vendorName !== undefined ? body.vendorName : existing.vendorName ?? "";
    const invoiceNumber =
      body.invoiceNumber !== undefined
        ? body.invoiceNumber
        : existing.invoiceNumber ?? "";
    const invoiceDate =
      body.invoiceDate !== undefined
        ? body.invoiceDate
        : existing.invoiceDate ?? getParisTodayIso();
    const amountHt =
      body.amountHt !== undefined ? round2(body.amountHt) : existing.amountHt;
    const amountTtc =
      body.amountTtc !== undefined ? round2(body.amountTtc) : amountHt;
    const tvaAmount = round2(Math.max(0, amountTtc - amountHt));

    // Cross-project IDOR guards for budgetLineId and quoteId
    if (body.budgetLineId) {
      const bl = await prisma.budgetLine.findUnique({
        where: { id: body.budgetLineId },
        select: { projectId: true },
      });
      if (!bl || bl.projectId !== projectId) {
        return NextResponse.json(
          {
            error: "Poste budgétaire introuvable pour ce projet.",
            code: "INVALID_BUDGET_LINE",
          },
          { status: 400 }
        );
      }
    }
    if (body.quoteId) {
      const q = await prisma.quote.findUnique({
        where: { id: body.quoteId },
        select: { projectId: true },
      });
      if (!q || q.projectId !== projectId) {
        return NextResponse.json(
          {
            error: "Devis introuvable pour ce projet.",
            code: "INVALID_QUOTE",
          },
          { status: 400 }
        );
      }
    }

    let existingCodes: string[] = [];
    try {
      const parsed = JSON.parse(existing.projectCodesJson || "[]");
      if (Array.isArray(parsed)) {
        existingCodes = parsed.filter((c): c is string => typeof c === "string");
      }
    } catch {
      existingCodes = [];
    }

    const projectCodes = normalizeProjectCodesList(
      body.projectCodes && body.projectCodes.length > 0
        ? body.projectCodes
        : existingCodes.length > 0
          ? existingCodes
          : [project.codeProjet],
      project.codeProjet
    );

    const renamedFilename = buildValidatedInvoiceFilename({
      invoiceNumber,
      invoiceDate,
      codeProjet: projectCodes.join("-"),
      vendorName,
      amountHt,
    });

    const updated = await prisma.invoice.update({
      where: { id: existing.id },
      data: {
        vendorName,
        invoiceNumber,
        invoiceDate,
        amountHt,
        tvaAmount,
        amountTtc,
        ...(body.prestationLabel !== undefined
          ? { prestationLabel: body.prestationLabel }
          : {}),
        ...(body.budgetLineId !== undefined
          ? { budgetLineId: body.budgetLineId || null }
          : {}),
        ...(body.quoteId !== undefined ? { quoteId: body.quoteId || null } : {}),
        projectCodesJson: JSON.stringify(projectCodes),
        renamedFilename,
      },
    });

    return NextResponse.json({
      ok: true,
      invoice: stripInvoiceBinaries(updated),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; invoiceId: string }> }
) {
  try {
    const { id: projectId, invoiceId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, projectId, currentUser, "EDIT");

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, projectId },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: "Facture introuvable pour ce projet." },
        { status: 404 }
      );
    }

    assertInvoiceOwnerAccess(invoice, currentUser);

    if (
      invoice.status === "VALIDATED" ||
      invoice.status === "VALIDATING" ||
      invoice.stepSheetDone ||
      invoice.stepDriveDone ||
      invoice.stepGmailDone
    ) {
      return NextResponse.json(
        {
          error:
            "Impossible de supprimer une facture déjà validée ou partiellement imputée dans Google Sheets / Drive.",
          code: "INVOICE_ALREADY_PROCESSED",
        },
        { status: 400 }
      );
    }

    // Clean up only safe internal staged PDF path (never unlink arbitrary user-provided paths)
    const stagedPath = getStagedInvoicePdfPath(projectId, invoice.id);
    await fs.unlink(stagedPath).catch(() => undefined);

    await prisma.invoice.delete({ where: { id: invoice.id } });

    await prisma.auditLog.create({
      data: {
        projectId,
        actor: currentUser?.email ?? "user",
        action: "INVOICE_REJECTED",
        targetType: "INVOICE",
        targetId: invoice.id,
        detailsJson: JSON.stringify({
          originalFilename: invoice.originalFilename,
          renamedFilename: invoice.renamedFilename,
          previousStatus: invoice.status,
          vendorName: invoice.vendorName,
          amountHt: invoice.amountHt,
        }),
      },
    });

    return NextResponse.json({ ok: true, deletedId: invoice.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
