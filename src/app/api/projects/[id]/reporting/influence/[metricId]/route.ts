import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { verifyInfluenceMetric } from "@/lib/reporting/influence-service";

const PatchInfluenceSchema = z.object({
  views: z.number().nullable().optional(),
  likes: z.number().nullable().optional(),
  comments: z.number().nullable().optional(),
  shares: z.number().nullable().optional(),
  reposts: z.number().nullable().optional(),
  saves: z.number().nullable().optional(),
  contentUrl: z.string().nullable().optional(),
  sparkCode: z.string().nullable().optional(),
  verifiedByHuman: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; metricId: string }> }
) {
  try {
    const { id, metricId } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const body = PatchInfluenceSchema.parse(await req.json());
    const metric = await verifyInfluenceMetric(prisma, id, metricId, body);

    return NextResponse.json({
      ok: true,
      metric,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
