import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  assertProjectAccess,
  getCurrentUser,
  toPublicUser,
  upsertUserByEmail,
} from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const ShareProjectSchema = z.object({
  email: z.string().email("Adresse email invalide."),
  name: z.string().trim().max(80).optional(),
  role: z.enum(["VIEWER", "EDITOR"]).default("VIEWER"),
});

const UpdateMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["VIEWER", "EDITOR"]),
});

async function loadProjectMembersPayload(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      owner: true,
      members: {
        include: { user: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  return {
    projectId: project.id,
    owner: project.owner ? toPublicUser(project.owner) : null,
    members: project.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      user: toPublicUser(m.user),
    })),
  };
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    const access = await assertProjectAccess(prisma, id, currentUser, "VIEW");
    const payload = await loadProjectMembersPayload(id);
    const teamUsers = await prisma.user.findMany({
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      ...payload,
      access,
      teamUsers: teamUsers.map(toPublicUser),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "MANAGE");

    const body = ShareProjectSchema.parse(await req.json());
    const existingTarget = await prisma.user.findUnique({
      where: { email: body.email.trim().toLowerCase() },
    });
    const targetUser = existingTarget
      ? existingTarget
      : await upsertUserByEmail(prisma, {
          email: body.email,
          name: body.name,
        });

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true, ownerId: true, client: true, nomJeu: true },
    });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    if (project.ownerId && project.ownerId === targetUser.id) {
      throw new AppHttpError(
        400,
        "ALREADY_OWNER",
        "Cette personne est déjà propriétaire de ce projet."
      );
    }

    await prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId: id,
          userId: targetUser.id,
        },
      },
      update: { role: body.role },
      create: {
        projectId: id,
        userId: targetUser.id,
        role: body.role,
      },
    });

    await prisma.auditLog.create({
      data: {
        projectId: id,
        actor: currentUser?.email ?? "user",
        action: "PROJECT_SHARED",
        targetType: "PROJECT_MEMBER",
        targetId: targetUser.id,
        detailsJson: JSON.stringify({
          sharedWithEmail: targetUser.email,
          role: body.role,
        }),
      },
    });

    const payload = await loadProjectMembersPayload(id);
    return NextResponse.json({ ok: true, ...payload }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "MANAGE");

    const body = UpdateMemberSchema.parse(await req.json());
    const existing = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: id,
          userId: body.userId,
        },
      },
    });
    if (!existing) {
      throw new AppHttpError(
        404,
        "MEMBER_NOT_FOUND",
        "Membre introuvable sur ce projet."
      );
    }

    await prisma.projectMember.update({
      where: { id: existing.id },
      data: { role: body.role },
    });

    const payload = await loadProjectMembersPayload(id);
    return NextResponse.json({ ok: true, ...payload });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "MANAGE");

    let userId = req.nextUrl.searchParams.get("userId")?.trim() ?? "";
    if (!userId) {
      try {
        const body = (await req.json()) as { userId?: string };
        userId = body.userId?.trim() ?? "";
      } catch {
        // ignore
      }
    }
    if (!userId) {
      throw new AppHttpError(400, "USER_ID_REQUIRED", "userId requis.");
    }

    await prisma.projectMember.deleteMany({
      where: { projectId: id, userId },
    });

    const payload = await loadProjectMembersPayload(id);
    return NextResponse.json({ ok: true, ...payload });
  } catch (err) {
    return toErrorResponse(err);
  }
}
