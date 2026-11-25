import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { AppHttpError } from "@/lib/errors";
import { assertNoCpConflict } from "@/lib/isolation/cp-guard";
import { prisma } from "@/lib/prisma";
import { normalizeInfluencePlatform } from "@/lib/reporting/types";

const CreateVerbatimSchema = z.object({
  authorHandle: z.string().trim().min(1),
  platform: z.string().trim().min(1),
  talentName: z.string().trim().nullable().optional(),
  quote: z.string(),
  likesCount: z.number().int().min(0).optional(),
  selectedForSlides: z.boolean().optional(),
});

const PatchVerbatimSchema = z.object({
  verbatimId: z.string().min(1),
  selectedForSlides: z.boolean(),
});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const verbatims = await prisma.verbatim.findMany({
      where: { projectId: id },
      orderBy: [
        { selectedForSlides: "desc" },
        { likesCount: "desc" },
        { createdAt: "asc" },
      ],
    });

    return NextResponse.json({ verbatims });
  } catch (err) {
    return toErrorResponse(err);
  }
}

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

    const body = CreateVerbatimSchema.parse(await req.json());
    const cleanQuote = body.quote.trim();
    if (!cleanQuote) {
      throw new AppHttpError(
        400,
        "EMPTY_VERBATIM_QUOTE",
        "La citation du verbatim ne peut pas être vide."
      );
    }

    const normalizedPlatform =
      normalizeInfluencePlatform(body.platform) ?? body.platform.toUpperCase();

    assertNoCpConflict(
      project.codeProjet,
      null,
      [body.authorHandle, body.talentName ?? "", cleanQuote].join(" ")
    );

    const existing = await prisma.verbatim.findFirst({
      where: {
        projectId: id,
        authorHandle: body.authorHandle.trim(),
        platform: normalizedPlatform,
        quote: cleanQuote,
      },
    });

    if (existing) {
      return NextResponse.json({
        ok: true,
        verbatim: existing,
        deduplicated: true,
      });
    }

    const verbatim = await prisma.verbatim.create({
      data: {
        projectId: id,
        authorHandle: body.authorHandle.trim(),
        platform: normalizedPlatform,
        talentName: body.talentName?.trim() || null,
        quote: cleanQuote,
        likesCount: body.likesCount ?? 0,
        selectedForSlides: body.selectedForSlides ?? false,
      },
    });

    await prisma.auditLog.create({
      data: {
        projectId: id,
        actor: "user",
        action: "VERBATIM_ADDED",
        targetType: "VERBATIM",
        targetId: verbatim.id,
        detailsJson: JSON.stringify({
          authorHandle: verbatim.authorHandle,
          platform: verbatim.platform,
          selectedForSlides: verbatim.selectedForSlides,
        }),
      },
    });

    return NextResponse.json({ ok: true, verbatim }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const body = PatchVerbatimSchema.parse(await req.json());
    const existing = await prisma.verbatim.findUnique({
      where: { id: body.verbatimId },
    });
    if (!existing || existing.projectId !== id) {
      throw new AppHttpError(404, "VERBATIM_NOT_FOUND", "Verbatim introuvable.");
    }

    const verbatim = await prisma.verbatim.update({
      where: { id: existing.id },
      data: { selectedForSlides: body.selectedForSlides },
    });

    return NextResponse.json({ ok: true, verbatim });
  } catch (err) {
    return toErrorResponse(err);
  }
}
