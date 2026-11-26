import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { ACTIVE_PROJECT_COOKIE } from "@/lib/auth/cookies";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const ActiveProjectSchema = z.object({
  projectId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser(prisma);
    const body = ActiveProjectSchema.parse(await req.json());
    await assertProjectAccess(prisma, body.projectId, currentUser, "VIEW");
    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
    });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    if (currentUser) {
      await prisma.user
        .update({
          where: { id: currentUser.id },
          data: { lastActiveProjectId: project.id },
        })
        .catch(() => undefined);
    }

    const response = NextResponse.json({
      ok: true,
      activeProjectId: project.id,
      project,
    });
    response.cookies.set(ACTIVE_PROJECT_COOKIE, project.id, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
