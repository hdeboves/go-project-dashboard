import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; invoiceId: string }> }
) {
  try {
    const { id: projectId, invoiceId } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, projectId },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: "Facture introuvable pour ce projet." },
        { status: 404 }
      );
    }

    if (invoice.status === "VALIDATED") {
      return NextResponse.json(
        {
          error:
            "Impossible de supprimer une facture déjà validée dans Google Sheets et Pennylane.",
        },
        { status: 400 }
      );
    }

    // Clean up any staged local preview PDF
    try {
      const parsed = JSON.parse(invoice.extractedJson || "{}") as {
        stagedPdfPath?: string;
      };
      if (parsed.stagedPdfPath) {
        await fs.unlink(parsed.stagedPdfPath).catch(() => undefined);
      }
    } catch {
      // ignore JSON parse issues
    }

    await prisma.invoice.delete({ where: { id: invoice.id } });

    await prisma.auditLog.create({
      data: {
        projectId,
        actor: "user",
        action: "INVOICE_REJECTED",
        targetType: "INVOICE",
        targetId: invoice.id,
        detailsJson: JSON.stringify({
          originalFilename: invoice.originalFilename,
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
