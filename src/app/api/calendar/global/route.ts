import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import {
  buildVisibleProjectsWhere,
  requireWorkspaceUser,
} from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getParisTodayIso, startOfParisTodayUtc } from "@/lib/shared/dates";

export async function GET() {
  try {
    const currentUser = await requireWorkspaceUser(prisma);
    const projects = await prisma.project.findMany({
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
      },
      orderBy: [{ client: "asc" }],
    });

    const projectIds = projects.map((p) => p.id);
    if (projectIds.length === 0) {
      return NextResponse.json({
        todayIso: getParisTodayIso(),
        items: [],
        projects: [],
      });
    }

    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const parisToday = startOfParisTodayUtc();
    const pastWindow = new Date(parisToday.getTime() - 14 * 86_400_000);

    const [tasks, events] = await Promise.all([
      prisma.retroTask.findMany({
        where: {
          projectId: { in: projectIds },
          endDate: { gte: pastWindow },
          status: { not: "TERMINE" },
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
        orderBy: [{ endDate: "asc" }],
        take: 200,
      }),
      prisma.calendarEvent.findMany({
        where: {
          projectId: { in: projectIds },
          status: "ACTIVE",
          startAt: { gte: pastWindow },
        },
        orderBy: [{ startAt: "asc" }],
        take: 150,
      }),
    ]);

    const items = [
      ...tasks.map((t) => ({
        id: `task_${t.id}`,
        kind: t.isMilestone ? ("MILESTONE" as const) : ("TASK" as const),
        title: t.tache,
        subtitle: `${t.phase}${t.owner ? ` · ${t.owner}` : ""}`,
        date: t.endDate!.toISOString().slice(0, 10),
        status: t.status,
        isLate: t.endDate!.getTime() < parisToday.getTime(),
        project: t.project,
      })),
      ...events
        .map((e) => {
          const proj = projectMap.get(e.projectId);
          if (!proj) return null;
          return {
            id: `cal_${e.id}`,
            kind: "CALENDAR_REMINDER" as const,
            title: e.title,
            subtitle: "Rappel automatique Google Agenda",
            date: e.startAt.toISOString().slice(0, 10),
            status: e.status,
            isLate: e.startAt.getTime() < parisToday.getTime(),
            project: proj,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    ].sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      todayIso: getParisTodayIso(),
      projects,
      items,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
