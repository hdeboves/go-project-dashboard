import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await requireAdmin(prisma);

    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 60,
      include: {
        project: {
          select: { codeProjet: true, client: true, nomJeu: true },
        },
      },
    });

    return NextResponse.json({
      logs: logs.map((l) => ({
        id: l.id,
        actor: l.actor,
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        detailsJson: l.detailsJson,
        project: l.project,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
