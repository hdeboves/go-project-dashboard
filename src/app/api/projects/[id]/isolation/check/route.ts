import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import { CpConflictError, checkCodeProjetConflict } from "@/lib/isolation/cp-guard";
import { prisma } from "@/lib/prisma";

const CheckIsolationSchema = z.object({
  extractedCp: z.string().nullable().optional(),
  rawText: z.string().default(""),
  sourceLabel: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "VIEW");
    const body = CheckIsolationSchema.parse(await req.json());

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const result = checkCodeProjetConflict(
      project.codeProjet,
      body.extractedCp ?? null,
      body.rawText
    );

    if (result.hasConflict) {
      await prisma.auditLog.create({
        data: {
          projectId: id,
          actor: "system:cp-guard",
          action: "CP_CONFLICT_BLOCKED",
          targetType: "ISOLATION_CHECK",
          targetId: body.sourceLabel ?? "manual-check",
          detailsJson: JSON.stringify(result),
        },
      });
      throw new CpConflictError(result);
    }

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
