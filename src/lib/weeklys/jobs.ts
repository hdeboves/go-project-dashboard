import type { PrismaClient } from "@prisma/client";
import { getGoogleGateway } from "@/lib/container";
import {
  addUtcDays,
  parseStrictCalendarDate,
  toIsoDateOnly,
} from "@/lib/retroplanning/validation";
import { generateWeeklyReport } from "@/lib/weeklys/weekly-service";

export interface WeeklyPrepJobResult {
  checkedProjects: number;
  generatedCount: number;
  skippedCount: number;
  weeklyIds: string[];
  errors: Array<{ projectId: string; error: string }>;
}

export async function runWeeklyPrepJob(
  prisma: PrismaClient,
  projectId?: string,
  options?: { force?: boolean }
): Promise<WeeklyPrepJobResult> {
  const projects = projectId
    ? await prisma.project.findMany({ where: { id: projectId } })
    : await prisma.project.findMany({ orderBy: { createdAt: "asc" } });

  const todayIso = new Date().toISOString().slice(0, 10);
  const weekEndDate = parseStrictCalendarDate(todayIso)!;
  const weekStartDate = addUtcDays(weekEndDate, -7);
  const weekStartIso = toIsoDateOnly(weekStartDate)!;
  const todayStart = new Date(`${todayIso}T00:00:00.000Z`);
  const todayEnd = new Date(`${todayIso}T23:59:59.999Z`);

  let checkedProjects = 0;
  let generatedCount = 0;
  let skippedCount = 0;
  const weeklyIds: string[] = [];
  const errors: Array<{ projectId: string; error: string }> = [];

  for (const project of projects) {
    checkedProjects++;
    try {
      if (!options?.force) {
        const existing = await prisma.weeklyReport.findFirst({
          where: {
            projectId: project.id,
            OR: [
              { weekStart: weekStartDate, weekEnd: weekEndDate },
              { createdAt: { gte: todayStart, lte: todayEnd } },
            ],
          },
        });
        if (existing) {
          skippedCount++;
          continue;
        }
      }

      const res = await generateWeeklyReport(
        prisma,
        project.id,
        () => getGoogleGateway(project.id, prisma),
        {
          weekStart: weekStartIso,
          weekEnd: todayIso,
        },
        "scheduler:weekly-prep"
      );
      generatedCount++;
      weeklyIds.push(res.weekly.id);
    } catch (err) {
      errors.push({
        projectId: project.id,
        error: err instanceof Error ? err.message : "Erreur préparation Weekly",
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      projectId: projectId ?? null,
      actor: "scheduler:weekly-prep",
      action: "WEEKLY_PREP_JOB_RUN",
      targetType: "SCHEDULER_JOB",
      targetId: projectId ?? "ALL",
      detailsJson: JSON.stringify({
        checkedProjects,
        generatedCount,
        skippedCount,
        weeklyIds,
        errors,
      }),
    },
  });

  return {
    checkedProjects,
    generatedCount,
    skippedCount,
    weeklyIds,
    errors,
  };
}
