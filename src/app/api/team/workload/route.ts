import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { requireWorkspaceUser, toPublicUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { startOfParisTodayUtc } from "@/lib/shared/dates";

export async function GET() {
  try {
    await requireWorkspaceUser(prisma);
    const parisToday = startOfParisTodayUtc();

    const [users, projects, openTasks] = await Promise.all([
      prisma.user.findMany({ orderBy: [{ name: "asc" }] }),
      prisma.project.findMany({
        where: { isArchived: false },
        select: {
          id: true,
          codeProjet: true,
          client: true,
          nomJeu: true,
          ownerId: true,
          members: { select: { userId: true } },
          budgetLines: { select: { saleTotalHt: true } },
        },
      }),
      prisma.retroTask.findMany({
        where: {
          status: { not: "TERMINE" },
          project: { isArchived: false },
        },
        select: {
          id: true,
          projectId: true,
          ownerUserId: true,
          owner: true,
          endDate: true,
        },
      }),
    ]);

    const workload = users.map((u) => {
      const ownedProjects = projects.filter((p) => p.ownerId === u.id);
      const sharedProjects = projects.filter(
        (p) => p.ownerId !== u.id && p.members.some((m) => m.userId === u.id)
      );
      const userProjectIds = new Set([
        ...ownedProjects.map((p) => p.id),
        ...sharedProjects.map((p) => p.id),
      ]);
      const firstName = u.name.split(" ")[0]?.toLowerCase() ?? "";

      const assignedTasks = openTasks.filter(
        (t) =>
          t.ownerUserId === u.id ||
          (!t.ownerUserId &&
            userProjectIds.has(t.projectId) &&
            firstName.length >= 2 &&
            (t.owner ?? "").toLowerCase().includes(firstName))
      );
      const lateTasksCount = assignedTasks.filter(
        (t) => t.endDate && t.endDate.getTime() < parisToday.getTime()
      ).length;
      const managedSoldHt = Math.round(
        ownedProjects.reduce(
          (sum, p) =>
            sum + p.budgetLines.reduce((s, l) => s + (l.saleTotalHt || 0), 0),
          0
        )
      );

      return {
        user: toPublicUser(u),
        ownedProjectsCount: ownedProjects.length,
        sharedProjectsCount: sharedProjects.length,
        totalActiveProjects: ownedProjects.length + sharedProjects.length,
        openTasksCount: assignedTasks.length,
        lateTasksCount,
        managedSoldHt,
        projects: ownedProjects.map((p) => ({
          id: p.id,
          codeProjet: p.codeProjet,
          client: p.client,
          nomJeu: p.nomJeu,
        })),
      };
    });

    return NextResponse.json({
      workload: workload.sort(
        (a, b) =>
          b.totalActiveProjects - a.totalActiveProjects ||
          b.openTasksCount - a.openTasksCount
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
