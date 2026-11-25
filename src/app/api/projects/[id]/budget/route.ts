import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import {
  getProjectBudget,
  upsertManualBudgetLine,
} from "@/lib/budget/service";
import { getServices } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { prisma } = getServices();
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "VIEW");
    const data = await getProjectBudget(prisma, id);
    return NextResponse.json(data);
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
    const body = (await req.json()) as { id?: string };
    const { prisma } = getServices();
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
    const result = await upsertManualBudgetLine(prisma, id, body);
    return NextResponse.json(result, { status: body?.id ? 200 : 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { prisma } = getServices();
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");

    let lineId = req.nextUrl.searchParams.get("lineId")?.trim() ?? "";
    if (!lineId) {
      const body = (await req.json().catch(() => ({}))) as { lineId?: string };
      lineId = (body.lineId ?? "").trim();
    }
    if (!lineId) {
      throw new AppHttpError(400, "MISSING_LINE_ID", "lineId requis.");
    }

    const line = await prisma.budgetLine.findFirst({
      where: { id: lineId, projectId: id },
      include: { _count: { select: { invoices: true } } },
    });
    if (!line) {
      throw new AppHttpError(
        404,
        "BUDGET_LINE_NOT_FOUND",
        "Poste budgétaire introuvable."
      );
    }
    if (line._count.invoices > 0) {
      throw new AppHttpError(
        409,
        "BUDGET_LINE_HAS_INVOICES",
        `Impossible de supprimer ce poste : ${line._count.invoices} facture(s) y sont reliées.`
      );
    }

    await prisma.budgetLine.delete({ where: { id: line.id } });
    await prisma.auditLog.create({
      data: {
        projectId: id,
        actor: currentUser?.email ?? "user",
        action: "BUDGET_LINE_DELETED",
        targetType: "BUDGET_LINE",
        targetId: line.id,
        detailsJson: JSON.stringify({
          category: line.category,
          objet: line.objet,
        }),
      },
    });

    return NextResponse.json({ ok: true, deletedId: line.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
