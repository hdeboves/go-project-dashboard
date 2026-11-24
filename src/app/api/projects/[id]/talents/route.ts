import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { getGoogleGateway } from "@/lib/container";
import { provisionTalentFolders } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const TalentSchema = z.object({
  talentName: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = TalentSchema.parse(await req.json());

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const gateway = await getGoogleGateway(id);
    const result = await provisionTalentFolders(
      prisma,
      gateway.drive,
      id,
      body.talentName
    );

    return NextResponse.json(
      {
        ok: true,
        talentName: result.talentName,
        slug: result.slug,
        createdNodes: result.createdNodes,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
