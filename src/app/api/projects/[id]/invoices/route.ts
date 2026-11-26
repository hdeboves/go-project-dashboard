import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  assertProjectAccess,
  buildVisibleInvoicesWhere,
  getCurrentUser,
} from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import {
  InvoiceCpConflictError,
  processInvoicePdfIngestion,
  stripInvoiceBinaries,
} from "@/lib/invoices/ingest";
import { resyncPendingInvoicesNumbering } from "@/lib/invoices/numbering";

const JsonInvoiceUploadSchema = z.object({
  filename: z.string().trim().min(1),
  mimeType: z.string().trim().optional(),
  fileBase64: z.string().min(1),
  budgetLineId: z.string().trim().min(1).optional(),
  emailSubject: z.string().trim().optional(),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { prisma, getGoogleGateway } = getServices();
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "VIEW");

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    let driveBaseSeq: number | undefined;
    if (req.nextUrl.searchParams.get("syncNumbering") === "1") {
      const synced = await resyncPendingInvoicesNumbering({
        prisma,
        projectId: id,
        codeProjet: project.codeProjet,
        uploadedById: currentUser?.id ?? null,
        getGoogleGateway,
      }).catch(() => null);
      if (synced) {
        driveBaseSeq = synced.baseSeq;
      }
    }

    const invoices = await prisma.invoice.findMany({
      where: buildVisibleInvoicesWhere(id, currentUser),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectId: true,
        uploadedById: true,
        budgetLineId: true,
        quoteId: true,
        gmailMessageId: true,
        originalFilename: true,
        renamedFilename: true,
        driveFileId: true,
        vendorName: true,
        invoiceNumber: true,
        supplierInvoiceNumber: true,
        invoiceDate: true,
        amountHt: true,
        tvaAmount: true,
        amountTtc: true,
        invoiceType: true,
        prestationLabel: true,
        detectedCodeProjet: true,
        projectCodesJson: true,
        vigilanceDriveFileId: true,
        vigilanceFilename: true,
        cpConflict: true,
        status: true,
        pennylaneDraftId: true,
        extractedJson: true,
        stepDriveDone: true,
        stepSheetDone: true,
        stepGmailDone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      invoices: invoices.map((inv) => stripInvoiceBinaries(inv)),
      ...(driveBaseSeq !== undefined ? { driveBaseSeq } : {}),
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
    const { prisma, getGeminiClient, getGoogleGateway } = getServices();
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const contentType = req.headers.get("content-type") ?? "";
    let pdfBuffer: Buffer;
    let filename = "facture.pdf";
    let mimeType: string | null = null;
    let requestedBudgetLineId: string | null = null;
    let emailSubject: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const fileEntry = formData.get("file");
      if (!fileEntry || !(fileEntry instanceof File)) {
        throw new AppHttpError(
          400,
          "MISSING_FILE",
          "Aucun fichier PDF fourni dans le champ 'file'."
        );
      }
      filename = fileEntry.name || "facture.pdf";
      mimeType = fileEntry.type || null;
      pdfBuffer = Buffer.from(await fileEntry.arrayBuffer());

      const budgetLineEntry = formData.get("budgetLineId");
      if (typeof budgetLineEntry === "string" && budgetLineEntry.trim()) {
        requestedBudgetLineId = budgetLineEntry.trim();
      }

      const metadataEntry = formData.get("metadata");
      if (typeof metadataEntry === "string" && metadataEntry.trim()) {
        try {
          const meta = JSON.parse(metadataEntry) as {
            budgetLineId?: string;
            emailSubject?: string;
          };
          if (!requestedBudgetLineId && meta.budgetLineId) {
            requestedBudgetLineId = meta.budgetLineId;
          }
          if (meta.emailSubject) {
            emailSubject = meta.emailSubject;
          }
        } catch {
          throw new AppHttpError(
            400,
            "INVALID_METADATA_JSON",
            "Le champ 'metadata' contient du JSON invalide."
          );
        }
      }
    } else {
      const body = JsonInvoiceUploadSchema.parse(await req.json());
      filename = body.filename;
      mimeType = body.mimeType ?? "application/pdf";
      const base64Payload = body.fileBase64.replace(
        /^data:[^;]+;base64,/i,
        ""
      );
      pdfBuffer = Buffer.from(base64Payload, "base64");
      requestedBudgetLineId = body.budgetLineId ?? null;
      emailSubject = body.emailSubject ?? null;
    }

    try {
      const result = await processInvoicePdfIngestion({
        prisma,
        getGeminiClient,
        getGoogleGateway,
        project,
        pdfBuffer,
        filename,
        mimeType,
        requestedBudgetLineId,
        emailSubject,
        uploadedById: currentUser?.id ?? null,
        useSequentialInvoiceNumber: true,
        allowManualFallback: true,
      });

      return NextResponse.json(
        {
          ok: true,
          ...result,
          invoice: stripInvoiceBinaries(result.invoice),
        },
        { status: 201 }
      );
    } catch (err) {
      if (err instanceof InvoiceCpConflictError) {
        return NextResponse.json(
          {
            error: err.message,
            code: err.code,
            detectedCps: err.result.detectedCps,
            conflictingCps: err.result.conflictingCps,
            result: err.result,
            invoice: stripInvoiceBinaries(err.invoice),
          },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
