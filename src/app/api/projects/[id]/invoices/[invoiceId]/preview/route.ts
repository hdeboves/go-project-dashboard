import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import {
  assertInvoiceOwnerAccess,
  assertProjectAccess,
  getCurrentUser,
} from "@/lib/auth/session";
import { getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { readStagedInvoicePdf } from "@/lib/invoices/ingest";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; invoiceId: string }> }
) {
  try {
    const { id, invoiceId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "VIEW");

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice || invoice.projectId !== id) {
      throw new AppHttpError(
        404,
        "INVOICE_NOT_FOUND",
        "Facture introuvable pour ce projet."
      );
    }

    assertInvoiceOwnerAccess(invoice, currentUser);

    let buffer: Buffer | null = invoice.pdfData
      ? Buffer.from(invoice.pdfData)
      : null;

    if (!buffer) {
      buffer = await readStagedInvoicePdf(
        id,
        invoice.id,
        invoice.extractedJson
      );
    }

    if (!buffer && invoice.driveFileId) {
      const gateway = await getGoogleGateway(id);
      buffer = await gateway.drive.downloadFile(invoice.driveFileId);
    }

    if (!buffer) {
      throw new AppHttpError(
        404,
        "INVOICE_PDF_MISSING",
        "Le fichier PDF d'aperçu est introuvable."
      );
    }

    const safeName = (
      invoice.renamedFilename ??
      invoice.originalFilename ??
      "facture.pdf"
    ).replace(/[^a-zA-Z0-9._-]/g, "_");

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
