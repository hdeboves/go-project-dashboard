import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getGoogleGateway } from "@/lib/container";
import { prisma } from "@/lib/prisma";
import { exportOrUpdateRetroplanningGoogleSheet } from "@/lib/retroplanning/export-service";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");

    const gateway = await getGoogleGateway(id);
    const result = await exportOrUpdateRetroplanningGoogleSheet(
      prisma,
      gateway,
      id,
      currentUser?.email ?? "user"
    );

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
