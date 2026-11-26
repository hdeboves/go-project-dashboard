import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getGoogleGateway } from "@/lib/container";
import { syncProjectToExternal } from "@/lib/drive/sync-service";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const SyncExtSchema = z
  .object({
    nodeIds: z.array(z.string().min(1)).optional(),
  })
  .optional();

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    let rawBody: unknown = undefined;
    const text = await req.text();
    if (text.trim()) {
      rawBody = JSON.parse(text);
    }
    const body = SyncExtSchema.parse(rawBody);

    const gateway = await getGoogleGateway(id);
    const result = await syncProjectToExternal(prisma, gateway.drive, id, {
      nodeIds: body?.nodeIds,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
