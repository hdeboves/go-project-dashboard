import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { ACTIVE_PROJECT_COOKIE } from "@/lib/auth/cookies";
import { requireAdminOrBootstrap } from "@/lib/auth/session";
import { getGoogleGateway } from "@/lib/container";
import { bootstrapPilotSandbox } from "@/lib/drive/tree-service";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    await requireAdminOrBootstrap(prisma);
    const gateway = await getGoogleGateway();
    const result = await bootstrapPilotSandbox(prisma, gateway.drive);

    const response = NextResponse.json({
      ok: true,
      project: result.project,
      internalNodesCount: result.internalNodesCount,
      externalNodesCount: result.externalNodesCount,
    });

    response.cookies.set(ACTIVE_PROJECT_COOKIE, result.project.id, {
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
