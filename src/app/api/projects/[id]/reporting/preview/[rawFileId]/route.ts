import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { detectImageMagicMime } from "@/lib/reporting/influence-service";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; rawFileId: string }> }
) {
  try {
    const { id, rawFileId } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const rawFile = await prisma.reportingRawFile.findUnique({
      where: { id: rawFileId },
    });
    if (!rawFile || rawFile.projectId !== id) {
      throw new AppHttpError(
        404,
        "PREVIEW_NOT_FOUND",
        "Aperçu introuvable pour ce projet."
      );
    }

    let buffer: Buffer | null = null;
    if (rawFile.localPreviewPath) {
      try {
        buffer = await readFile(rawFile.localPreviewPath);
      } catch {
        buffer = null;
      }
    }

    if (!buffer && rawFile.driveFileId) {
      const gateway = await getGoogleGateway(id);
      buffer = await gateway.drive.downloadFile(rawFile.driveFileId);
    }

    if (!buffer) {
      throw new AppHttpError(
        404,
        "PREVIEW_BYTES_MISSING",
        "Fichier image d'aperçu indisponible."
      );
    }

    const mime = detectImageMagicMime(buffer) ?? "image/png";
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
