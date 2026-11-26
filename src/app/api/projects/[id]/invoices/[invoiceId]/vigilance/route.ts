import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { ensureProjectFolderNode } from "@/lib/budget/service";
import { getServices } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const MAX_VIGILANCE_BYTES = 15 * 1024 * 1024;

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

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      const body = (await req.json().catch(() => ({}))) as {
        alreadyInDrive?: boolean;
        filename?: string;
        driveFileId?: string;
      };
      if (!body.alreadyInDrive) {
        throw new AppHttpError(
          400,
          "MISSING_FILE",
          "Veuillez joindre le fichier d'attestation de vigilance."
        );
      }

      const updated = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          vigilanceDriveFileId: body.driveFileId?.trim() || "DRIVE_CONFIRMED",
          vigilanceFilename:
            body.filename?.trim() || "Attestation de vigilance (Drive)",
        },
      });

      return NextResponse.json({
        ok: true,
        uploadedToDrive: true,
        invoice: updated,
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
        "L'attestation dépasse la taille maximale autorisée (15 Mo)."
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
    const today = new Date().toISOString().slice(0, 10);
    const targetFilename = `AttestationVigilance_${safeCp}_${safePresta}_${today}${ext}`;

    // Stage in writable tmp dir (Vercel /var/task is read-only!)
    const baseDir =
      process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
        ? path.join(os.tmpdir(), "go-project-hub-data")
        : path.join(process.cwd(), ".data");
    const stagedPath = path.join(baseDir, "vigilance", id, `${invoice.id}${ext}`);
    try {
      await fs.promises.mkdir(path.dirname(stagedPath), { recursive: true });
      await fs.promises.writeFile(stagedPath, buf);
    } catch {
      // Non-fatal; Google Drive upload or base64 fallback handles persistence
    }

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
      // Google not connected yet — stays staged and will be uploaded on validation
      driveFileId = `STAGED:${stagedPath}`;
    }

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        vigilanceDriveFileId: driveFileId,
        vigilanceFilename: targetFilename,
      },
    });

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
      invoice: updated,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
