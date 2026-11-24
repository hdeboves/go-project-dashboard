import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { encryptSecret } from "@/lib/crypto";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { ACTIVE_PROJECT_COOKIE } from "@/app/api/shell/status/route";

const ActiveProjectSchema = z.object({
  projectId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = ActiveProjectSchema.parse(await req.json());
    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
    });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    await prisma.appSetting.upsert({
      where: { key: "ACTIVE_PROJECT_ID" },
      update: {
        valueEnc: encryptSecret(project.id),
        isSecret: false,
      },
      create: {
        key: "ACTIVE_PROJECT_ID",
        valueEnc: encryptSecret(project.id),
        isSecret: false,
      },
    });

    const response = NextResponse.json({
      ok: true,
      activeProjectId: project.id,
      project,
    });
    response.cookies.set(ACTIVE_PROJECT_COOKIE, project.id, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
