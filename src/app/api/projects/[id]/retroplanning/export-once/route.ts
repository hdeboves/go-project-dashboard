import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getGoogleGateway } from "@/lib/container";
import { exportRetroplanningOnce } from "@/lib/drive/sync-service";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const ExportOnceSchema = z.object({
  explicitManualExportConfirm: z.boolean(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
    const body = ExportOnceSchema.parse(await req.json());

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    if (!body.explicitManualExportConfirm) {
      throw new AppHttpError(
        400,
        "MANUAL_EXPORT_CONFIRM_REQUIRED",
        "Confirmation manuelle explicite requise (explicitManualExportConfirm: true)."
      );
    }

    const gateway = await getGoogleGateway(id);
    const result = await exportRetroplanningOnce(prisma, gateway.drive, id, {
      explicitManualExportConfirm: body.explicitManualExportConfirm,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
