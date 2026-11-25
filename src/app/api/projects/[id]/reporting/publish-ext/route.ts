import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { publishReportingToExternal } from "@/lib/reporting/slides-generator";

const PublishExtSchema = z.object({
  confirmValidation: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const gateway = await getGoogleGateway(id);

    let body: { confirmValidation?: boolean } = {};
    try {
      const text = await req.text();
      if (text.trim()) {
        body = PublishExtSchema.parse(JSON.parse(text));
      }
    } catch (err) {
      if (err instanceof z.ZodError) throw err;
      throw new SyntaxError("Corps JSON invalide.");
    }

    const result = await publishReportingToExternal(prisma, gateway, id, {
      confirmValidation: body.confirmValidation,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
