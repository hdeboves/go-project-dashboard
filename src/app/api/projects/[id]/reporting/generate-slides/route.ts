import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { generateReportingSlides } from "@/lib/reporting/slides-generator";
import type { BrandKit } from "@/lib/reporting/types";

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

    const gateway = await getGoogleGateway(id);

    let body: { brandKit?: Partial<BrandKit>; chartId?: number | null } = {};
    try {
      const text = await req.text();
      if (text.trim()) {
        body = JSON.parse(text) as {
          brandKit?: Partial<BrandKit>;
          chartId?: number | null;
        };
      }
    } catch {
      throw new SyntaxError("Corps JSON invalide.");
    }

    const result = await generateReportingSlides(prisma, gateway, id, {
      brandKitOverride: body.brandKit,
      chartId: body.chartId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
