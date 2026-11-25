import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { sanitizeContentDispositionFilename } from "@/lib/shared/filenames";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; quoteId: string }> }
) {
  try {
    const { id, quoteId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "VIEW");

    const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
    if (!quote || quote.projectId !== id) {
      throw new AppHttpError(404, "QUOTE_NOT_FOUND", "Devis introuvable.");
    }

    if (!quote.localPdfPath || !fs.existsSync(quote.localPdfPath)) {
      throw new AppHttpError(
        404,
        "QUOTE_PDF_MISSING",
        "Aucun PDF enregistré localement pour ce devis."
      );
    }

    const buf = await fs.promises.readFile(quote.localPdfPath);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${sanitizeContentDispositionFilename(quote.originalFilename ?? `${quote.quoteNumber}.pdf`)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
