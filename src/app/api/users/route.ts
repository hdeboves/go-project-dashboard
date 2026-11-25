import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { getCurrentUser, toPublicUser } from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const UpdateUserRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export async function GET() {
  try {
    const [currentUser, users] = await Promise.all([
      getCurrentUser(prisma),
      prisma.user.findMany({
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        include: {
          _count: {
            select: {
              ownedProjects: true,
              memberships: true,
            },
          },
        },
      }),
    ]);

    return NextResponse.json({
      currentUser: currentUser ? toPublicUser(currentUser) : null,
      users: users.map((u) => ({
        ...toPublicUser(u),
        createdAt: u.createdAt.toISOString(),
        ownedProjectsCount: u._count.ownedProjects,
        sharedProjectsCount: u._count.memberships,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser(prisma);
    if (!currentUser || currentUser.role !== "ADMIN") {
      throw new AppHttpError(
        403,
        "ADMIN_ONLY",
        "Seul un administrateur peut modifier les rôles de l'équipe."
      );
    }

    const body = UpdateUserRoleSchema.parse(await req.json());
    const target = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!target) {
      throw new AppHttpError(404, "USER_NOT_FOUND", "Utilisateur introuvable.");
    }

    if (target.role === "ADMIN" && body.role === "MEMBER") {
      const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        throw new AppHttpError(
          400,
          "LAST_ADMIN_PROTECTED",
          "Impossible de retirer le rôle Admin au dernier administrateur."
        );
      }
    }

    const updated = await prisma.user.update({
      where: { id: body.userId },
      data: { role: body.role },
    });

    await prisma.auditLog.create({
      data: {
        actor: currentUser.email,
        action: "USER_ROLE_UPDATED",
        targetType: "USER",
        targetId: updated.id,
        detailsJson: JSON.stringify({
          email: updated.email,
          previousRole: target.role,
          nextRole: body.role,
        }),
      },
    });

    return NextResponse.json({
      ok: true,
      user: toPublicUser(updated),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
