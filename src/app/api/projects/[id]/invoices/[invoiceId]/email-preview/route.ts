import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import {
  buildAccountingCcEntries,
  buildAccountingEmailBody,
  buildAccountingEmailSubject,
  evaluateInvoiceVerificationWarnings,
  getAccountingToAddress,
  normalizeProjectCodesList,
} from "@/lib/invoices/accounting-email";
import { prisma } from "@/lib/prisma";
import { buildValidatedInvoiceFilename } from "@/lib/shared/filenames";

const EmailPreviewSchema = z.object({
  vendorName: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  amountHt: z.number().finite().min(0).optional(),
  amountTtc: z.number().finite().min(0).optional(),
  budgetLineId: z.string().optional(),
  projectCodes: z.array(z.string()).optional(),
  multiProjectConfirmed: z.boolean().optional(),
  extraCc: z.array(z.string()).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; invoiceId: string }> }
) {
  try {
    const { id, invoiceId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "VIEW");

    const body = EmailPreviewSchema.parse(await req.json().catch(() => ({})));

    const [project, invoice, accountingUsers] = await Promise.all([
      prisma.project.findUnique({
        where: { id },
        include: {
          owner: { select: { email: true, name: true, role: true } },
          members: {
            include: {
              user: { select: { email: true, name: true, role: true } },
            },
          },
        },
      }),
      prisma.invoice.findUnique({ where: { id: invoiceId } }),
      prisma.user.findMany({
        where: { role: "COMPTA" },
        select: { email: true, name: true },
      }),
    ]);

    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }
    if (!invoice || invoice.projectId !== id) {
      throw new AppHttpError(404, "INVOICE_NOT_FOUND", "Facture introuvable.");
    }

    const projectCodes = normalizeProjectCodesList(
      body.projectCodes && body.projectCodes.length > 0
        ? body.projectCodes
        : [project.codeProjet, invoice.detectedCodeProjet],
      project.codeProjet
    );

    // Pull collaborators from ALL projects matching the invoice's project codes (supports multi-CP!)
    const relatedProjects =
      projectCodes.length > 0
        ? await prisma.project.findMany({
            where: { codeProjet: { in: projectCodes } },
            include: {
              owner: { select: { email: true, name: true, role: true } },
              members: {
                include: {
                  user: { select: { email: true, name: true, role: true } },
                },
              },
            },
          })
        : [];

    const collaborators: Array<{
      email: string;
      name?: string | null;
      role?: string | null;
    }> = [];

    const allProjects = [project, ...relatedProjects];
    for (const p of allProjects) {
      if (p.owner) collaborators.push(p.owner);
      for (const m of p.members) {
        if (m.user) collaborators.push(m.user);
      }
    }

    const vendorName = (body.vendorName ?? invoice.vendorName ?? "").trim();
    const invoiceNumber = (
      body.invoiceNumber ??
      invoice.invoiceNumber ??
      ""
    ).trim();
    const invoiceDate = (
      body.invoiceDate ??
      invoice.invoiceDate ??
      new Date().toISOString().slice(0, 10)
    ).trim();
    const amountHt = body.amountHt ?? invoice.amountHt ?? 0;
    const amountTtc = body.amountTtc ?? invoice.amountTtc ?? amountHt * 1.2;
    const budgetLineId = body.budgetLineId ?? invoice.budgetLineId ?? "";

    const warnings = evaluateInvoiceVerificationWarnings({
      vendorName,
      invoiceNumber,
      invoiceDate,
      amountHt,
      amountTtc,
      budgetLineId,
      activeProjectCode: project.codeProjet,
      projectCodes,
      multiProjectConfirmed: Boolean(body.multiProjectConfirmed),
      hasVigilanceAttestation: Boolean(invoice.vigilanceDriveFileId),
    });

    const ccEntries = buildAccountingCcEntries({
      projectCollaborators: collaborators,
      accountingUsers,
      currentUserEmail: currentUser?.email ?? null,
      extraCc: body.extraCc,
    });

    const attachmentFilename = buildValidatedInvoiceFilename({
      invoiceNumber,
      invoiceDate,
      codeProjet: projectCodes.join("-"),
      vendorName,
      amountHt,
    });

    // Automatically persist updated nomenclature filename & verified fields before Step 2
    if (invoice.status !== "VALIDATED") {
      await prisma.invoice
        .update({
          where: { id: invoice.id },
          data: {
            vendorName: vendorName || invoice.vendorName,
            invoiceNumber: invoiceNumber || invoice.invoiceNumber,
            invoiceDate: invoiceDate || invoice.invoiceDate,
            amountHt,
            amountTtc,
            tvaAmount: Math.max(0, Math.round((amountTtc - amountHt) * 100) / 100),
            budgetLineId: budgetLineId || invoice.budgetLineId,
            projectCodesJson: JSON.stringify(projectCodes),
            renamedFilename: attachmentFilename,
          },
        })
        .catch(() => undefined);
    }

    return NextResponse.json({
      to: getAccountingToAddress(),
      ccEntries,
      cc: ccEntries.map((c) => c.email),
      subject: buildAccountingEmailSubject({
        projectCodes,
        vendorName,
      }),
      body: buildAccountingEmailBody({
        projectCodes,
        vendorName,
      }),
      attachmentFilename,
      renamedFilename: attachmentFilename,
      projectCodes,
      hasVigilanceAttestation: Boolean(invoice.vigilanceDriveFileId),
      vigilanceFilename: invoice.vigilanceFilename ?? null,
      warnings,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
