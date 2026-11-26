import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { ValidationStatus } from "@/lib/drive/sync-policy";
import { updateDriveNodeStatus } from "@/lib/drive/sync-service";
import { prisma } from "@/lib/prisma";

const PatchNodeSchema = z.object({
  validationStatus: z
    .enum([
      ValidationStatus.BROUILLON_INTERNE,
      ValidationStatus.EN_REVUE,
      ValidationStatus.VALIDE_CLIENT,
    ])
    .optional(),
  allowPermanentExtSync: z.boolean().optional(),
  name: z.string().min(1).optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; nodeId: string }> }
) {
  try {
    const { id, nodeId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
    const body = PatchNodeSchema.parse(await req.json());

    const result = await updateDriveNodeStatus(prisma, {
      projectId: id,
      nodeId,
      validationStatus: body.validationStatus,
      allowPermanentExtSync: body.allowPermanentExtSync,
      name: body.name,
    });

    return NextResponse.json({
      ok: true,
      node: result.node,
      syncStatus: result.syncStatus,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
