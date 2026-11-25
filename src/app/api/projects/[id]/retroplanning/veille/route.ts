import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { getGeminiClient, getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { runRetroVeille } from "@/lib/retroplanning/veille-service";

const VeilleBodySchema = z
  .object({
    includeDrive: z.boolean().optional(),
    emails: z
      .array(
        z.object({
          id: z.string().min(1),
          subject: z.string(),
          body: z.string().optional(),
          snippet: z.string().optional(),
          date: z.string().optional(),
          attachmentNames: z.array(z.string()).optional(),
          attachments: z
            .array(z.object({ filename: z.string().optional() }))
            .optional(),
        })
      )
      .optional(),
    driveFiles: z
      .array(
        z.object({
          id: z.string().min(1),
          parentCode: z.string().optional(),
          name: z.string(),
          note: z.string().optional(),
          modifiedTime: z.string().nullable().optional(),
        })
      )
      .optional(),
  })
  .optional()
  .default({});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let rawBody: unknown = {};
    const text = await req.text();
    if (text.trim().length > 0) {
      rawBody = JSON.parse(text);
    }
    const parsed = VeilleBodySchema.parse(rawBody);

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    // Check BOTH preconditions upfront (412 if Google or Gemini missing)
    const gateway = await getGoogleGateway(id);
    const gemini = await getGeminiClient();

    const result = await runRetroVeille(prisma, gateway, gemini, id, parsed);
    return NextResponse.json({
      ok: true,
      proposals: result.proposals,
      blockedConflicts: result.blockedConflicts,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
