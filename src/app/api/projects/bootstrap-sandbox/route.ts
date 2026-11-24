import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { getGoogleGateway } from "@/lib/container";
import { bootstrapPilotSandbox } from "@/lib/drive/tree-service";
import { prisma } from "@/lib/prisma";
import { ACTIVE_PROJECT_COOKIE } from "@/app/api/shell/status/route";

export async function POST() {
  try {
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
