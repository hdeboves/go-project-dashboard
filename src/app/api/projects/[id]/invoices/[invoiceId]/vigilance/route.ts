import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  assertInvoiceOwnerAccess,
  assertProjectAccess,
  getCurrentUser,
} from "@/lib/auth/session";
import { ensureProjectFolderNode } from "@/lib/budget/service";
import { getServices } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { stripInvoiceBinaries } from "@/lib/invoices/ingest";
import { prisma } from "@/lib/prisma";
import { getParisTodayIso } from "@/lib/shared/dates";
import { recordVendorVigilance } from "@/lib/vendors/vendor-service";

const MAX_VIGILANCE_BYTES = 10 * 1024 * 1024;

const AlreadyInDriveSchema = z.object({
  alreadyInDrive: z.literal(true),
  filename: z.string().trim().min(1).max(200).optional(),
  driveFileId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]{8,128}$/, "Identifiant Google Drive invalide.")
    .optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; invoiceId: string }> }
) {
  try {
    const { id, invoiceId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");

    const [project, invoice] = await Promise.all([
      prisma.project.findUnique({ where: { id } }),
      prisma.invoice.findUnique({ where: { id: invoiceId } }),
    ]);
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }
    if (!invoice || invoice.projectId !== id) {
      throw new AppHttpError(404, "INVOICE_NOT_FOUND", "Facture introuvable.");
    }

    assertInvoiceOwnerAccess(invoice, currentUser);

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      const parsed = AlreadyInDriveSchema.parse(await req.json());
      const driveId = parsed.driveFileId || "DRIVE_CONFIRMED";
      const fileLabel = parsed.filename || "Attestation de vigilance (Drive)";

      const updated = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          vigilanceDriveFileId: driveId,
          vigilanceFilename: fileLabel,
          vigilancePdfData: null,
        },
      });

      if (invoice.vendorName) {
        await recordVendorVigilance(prisma, {
          vendorName: invoice.vendorName,
          driveFileId: driveId,
          filename: fileLabel,
        }).catch(() => undefined);
      }

      return NextResponse.json({
        ok: true,
        uploadedToDrive: true,
        filename: fileLabel,
        invoice: stripInvoiceBinaries(updated),
      });
    }

    const formData = await req.formData();
    const fileEntry = formData.get("file");
    if (!fileEntry || !(fileEntry instanceof File) || fileEntry.size === 0) {
      throw new AppHttpError(
        400,
        "MISSING_FILE",
        "Aucun fichier d'attestation de vigilance fourni."
      );
    }
    if (fileEntry.size > MAX_VIGILANCE_BYTES) {
      throw new AppHttpError(
        413,
        "FILE_TOO_LARGE",
        "L'attestation dépasse la taille maximale autorisée (10 Mo)."
      );
    }

    const buf = Buffer.from(await fileEntry.arrayBuffer());
    const ext =
      path.extname(fileEntry.name || ".pdf").replace(/[^a-zA-Z0-9.]/g, "") ||
      ".pdf";
    const safePresta =
      (invoice.vendorName ?? "Prestataire")
        .trim()
        .normalize("NFC")
        .replace(/[^a-zA-Z0-9À-ÿ-]/g, "") || "Prestataire";
    const safeCp = project.codeProjet.replace(/[^0-9A-Za-z-]/g, "") || "000000";
    const today = getParisTodayIso();
    const targetFilename = `AttestationVigilance_${safeCp}_${safePresta}_${today}${ext}`;

    // Upload directly into Drive folder 001.3 Factures if Google Workspace is connected
    let driveFileId: string | null = null;
    let uploadedToDrive = false;
    try {
      const { getGoogleGateway } = getServices();
      const gateway = await getGoogleGateway(id);
      const folder0013 = await ensureProjectFolderNode(
        prisma,
        gateway,
        id,
        "001.3"
      );
      const uploaded = await gateway.drive.createFile({
        name: targetFilename,
        parentId: folder0013.driveFileId,
        mimeType: fileEntry.type || "application/pdf",
        body: buf,
      });
      driveFileId = uploaded.id;
      uploadedToDrive = true;
    } catch {
      // Google not connected yet — persist durably in PostgreSQL Bytes column until validation
      driveFileId = "DB_STAGED";
    }

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        vigilanceDriveFileId: driveFileId,
        vigilanceFilename: targetFilename,
        vigilancePdfData: uploadedToDrive ? null : new Uint8Array(buf),
      },
    });

    if (uploadedToDrive && driveFileId && invoice.vendorName) {
      await recordVendorVigilance(prisma, {
        vendorName: invoice.vendorName,
        driveFileId,
        filename: targetFilename,
      }).catch(() => undefined);
    }

    await prisma.auditLog.create({
      data: {
        projectId: id,
        actor: currentUser?.email ?? "user",
        action: "VIGILANCE_ATTESTATION_UPLOADED",
        targetType: "INVOICE",
        targetId: invoice.id,
        detailsJson: JSON.stringify({
          filename: targetFilename,
          uploadedToDrive,
          driveFileId: uploadedToDrive ? driveFileId : null,
        }),
      },
    });

    return NextResponse.json({
      ok: true,
      uploadedToDrive,
      filename: targetFilename,
      driveFileId: uploadedToDrive ? driveFileId : null,
      invoice: stripInvoiceBinaries(updated),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
