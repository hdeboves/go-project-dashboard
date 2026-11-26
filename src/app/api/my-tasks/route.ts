import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  assertProjectAccess,
  buildVisibleProjectsWhere,
  requireWorkspaceUser,
} from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getParisTodayIso, startOfParisTodayUtc } from "@/lib/shared/dates";

const PatchMyTaskSchema = z.object({
  taskId: z.string().min(1),
  status: z
    .enum(["A_FAIRE", "EN_COURS", "EN_ATTENTE_CLIENT", "TERMINE"])
    .optional(),
  snoozeDays: z.number().int().min(1).max(30).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const currentUser = await requireWorkspaceUser(prisma);
    const scope = req.nextUrl.searchParams.get("scope") ?? "mine";
    const includeDone = req.nextUrl.searchParams.get("includeDone") === "1";

    const visibleProjects = await prisma.project.findMany({
      where: {
        ...buildVisibleProjectsWhere(currentUser),
        isArchived: false,
      },
      select: {
        id: true,
        codeProjet: true,
        client: true,
        nomJeu: true,
        category: true,
        ownerId: true,
      },
      orderBy: [{ client: "asc" }],
    });

    const visibleProjectIds = visibleProjects.map((p) => p.id);
    if (visibleProjectIds.length === 0) {
      return NextResponse.json({
        todayIso: getParisTodayIso(),
        projects: [],
        tasks: [],
      });
    }

    const mineFilter =
      scope === "mine" && currentUser
        ? {
            OR: [
              { ownerUserId: currentUser.id },
              {
                ownerUserId: null,
                project: { ownerId: currentUser.id },
              },
              {
                owner: {
                  contains: currentUser.name.split(" ")[0] ?? currentUser.name,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {};

    const tasks = await prisma.retroTask.findMany({
      where: {
        projectId: { in: visibleProjectIds },
        ...(includeDone ? {} : { status: { not: "TERMINE" } }),
        ...mineFilter,
      },
      include: {
        project: {
          select: {
            id: true,
            codeProjet: true,
            client: true,
            nomJeu: true,
            category: true,
          },
        },
      },
      orderBy: [{ endDate: "asc" }, { updatedAt: "desc" }],
      take: 300,
    });

    const parisToday = startOfParisTodayUtc();

    return NextResponse.json({
      todayIso: getParisTodayIso(),
      projects: visibleProjects,
      tasks: tasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        project: t.project,
        phase: t.phase,
        etape: t.etape,
        tache: t.tache,
        owner: t.owner,
        ownerUserId: t.ownerUserId,
        startDate: t.startDate ? t.startDate.toISOString().slice(0, 10) : null,
        endDate: t.endDate ? t.endDate.toISOString().slice(0, 10) : null,
        status: t.status,
        isMilestone: t.isMilestone,
        isLate:
          t.status !== "TERMINE" &&
          Boolean(t.endDate && t.endDate.getTime() < parisToday.getTime()),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const currentUser = await requireWorkspaceUser(prisma);
    const body = PatchMyTaskSchema.parse(await req.json());

    const existing = await prisma.retroTask.findUnique({
      where: { id: body.taskId },
    });
    if (!existing) {
      throw new AppHttpError(404, "TASK_NOT_FOUND", "Tâche introuvable.");
    }

    await assertProjectAccess(prisma, existing.projectId, currentUser, "EDIT");

    let nextEndDate = existing.endDate;
    if (body.snoozeDays) {
      const base =
        existing.endDate && existing.endDate.getTime() > Date.now()
          ? existing.endDate
          : startOfParisTodayUtc();
      const shifted = new Date(base.getTime() + body.snoozeDays * 86_400_000);
      // Skip weekend when snoozing +1j
      if (body.snoozeDays === 1) {
        const dow = shifted.getUTCDay();
        if (dow === 6) shifted.setUTCDate(shifted.getUTCDate() + 2);
        else if (dow === 0) shifted.setUTCDate(shifted.getUTCDate() + 1);
      }
      nextEndDate = shifted;
    }

    const updated = await prisma.retroTask.update({
      where: { id: existing.id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.snoozeDays ? { endDate: nextEndDate } : {}),
      },
    });

    return NextResponse.json({
      ok: true,
      task: {
        id: updated.id,
        status: updated.status,
        endDate: updated.endDate
          ? updated.endDate.toISOString().slice(0, 10)
          : null,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
