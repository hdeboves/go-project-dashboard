import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { ACTIVE_PROJECT_COOKIE } from "@/lib/auth/cookies";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const ArchiveSchema = z.object({
  archived: z.boolean(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    if (currentUser?.role !== "ADMIN") {
      await assertProjectAccess(prisma, id, currentUser, "MANAGE");
    }

    const body = ArchiveSchema.parse(await req.json());
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        isArchived: body.archived,
        archivedAt: body.archived ? new Date() : null,
        archivedById: body.archived ? currentUser?.id ?? null : null,
      },
    });

    await prisma.auditLog.create({
      data: {
        projectId: id,
        actor: currentUser?.email ?? "user",
        action: body.archived ? "PROJECT_ARCHIVED" : "PROJECT_UNARCHIVED",
        targetType: "PROJECT",
        targetId: id,
        detailsJson: JSON.stringify({
          codeProjet: existing.codeProjet,
          client: existing.client,
          nomJeu: existing.nomJeu,
          isArchived: body.archived,
        }),
      },
    });

    const res = NextResponse.json({
      ok: true,
      project: updated,
    });

    if (body.archived) {
      const cookieStore = await cookies();
      if (cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value === id) {
        res.cookies.delete(ACTIVE_PROJECT_COOKIE);
      }
      await prisma.user
        .updateMany({
          where: { lastActiveProjectId: id },
          data: { lastActiveProjectId: null },
        })
        .catch(() => undefined);
    }

    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
