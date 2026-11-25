import type { PrismaClient } from "@prisma/client";

export interface BackupSummaryDto {
  id: string;
  trigger: string;
  executionId: string | null;
  status: string;
  projectsCount: number;
  usersCount: number;
  invoicesCount: number;
  quotesCount: number;
  sizeBytes: number;
  createdBy: string;
  createdAt: string;
}

const MAX_RETAINED_BACKUPS = 26;

/**
 * Creates a sanitized full workspace backup snapshot in PostgreSQL.
 * Excludes encrypted OAuth tokens and API keys from AppSetting/GoogleConnection.
 * Idempotent when executionId is provided (for Vercel Schedules).
 */
export async function createBackupSnapshot(
  prisma: PrismaClient,
  params: {
    trigger: "WEEKLY_SCHEDULE" | "MANUAL";
    executionId?: string | null;
    createdBy?: string;
  }
): Promise<{ backup: BackupSummaryDto; reused: boolean }> {
  if (params.executionId) {
    const existing = await prisma.backupSnapshot.findUnique({
      where: { executionId: params.executionId },
    });
    if (existing) {
      return {
        reused: true,
        backup: {
          id: existing.id,
          trigger: existing.trigger,
          executionId: existing.executionId,
          status: existing.status,
          projectsCount: existing.projectsCount,
          usersCount: existing.usersCount,
          invoicesCount: existing.invoicesCount,
          quotesCount: existing.quotesCount,
          sizeBytes: existing.sizeBytes,
          createdBy: existing.createdBy,
          createdAt: existing.createdAt.toISOString(),
        },
      };
    }
  }

  const [
    users,
    projects,
    projectMembers,
    categoryTemplates,
    budgetLines,
    quotes,
    invoices,
    retroTasks,
    weeklyReports,
    meetingNotes,
    calendarRules,
    calendarEvents,
    verbatims,
  ] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.project.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.projectMember.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.categoryTemplate.findMany(),
    prisma.budgetLine.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.quote.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invoice.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.retroTask.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.weeklyReport.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.meetingNote.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.calendarRule.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.calendarEvent.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.verbatim.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const payload = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    trigger: params.trigger,
    counts: {
      users: users.length,
      projects: projects.length,
      projectMembers: projectMembers.length,
      categoryTemplates: categoryTemplates.length,
      budgetLines: budgetLines.length,
      quotes: quotes.length,
      invoices: invoices.length,
      retroTasks: retroTasks.length,
      weeklyReports: weeklyReports.length,
      meetingNotes: meetingNotes.length,
    },
    data: {
      users,
      projects,
      projectMembers,
      categoryTemplates,
      budgetLines,
      quotes,
      invoices,
      retroTasks,
      weeklyReports,
      meetingNotes,
      calendarRules,
      calendarEvents,
      verbatims,
    },
  };

  const payloadJson = JSON.stringify(payload);
  const sizeBytes = Buffer.byteLength(payloadJson, "utf8");

  const created = await prisma.backupSnapshot.create({
    data: {
      trigger: params.trigger,
      executionId: params.executionId ?? null,
      status: "COMPLETED",
      projectsCount: projects.length,
      usersCount: users.length,
      invoicesCount: invoices.length,
      quotesCount: quotes.length,
      sizeBytes,
      payloadJson,
      createdBy: params.createdBy ?? "system:weekly-backup",
    },
  });

  // Retain only the latest 26 snapshots (~6 months of weekly backups)
  const oldSnapshots = await prisma.backupSnapshot.findMany({
    orderBy: { createdAt: "desc" },
    skip: MAX_RETAINED_BACKUPS,
    select: { id: true },
  });
  if (oldSnapshots.length > 0) {
    await prisma.backupSnapshot.deleteMany({
      where: { id: { in: oldSnapshots.map((s) => s.id) } },
    });
  }

  await prisma.auditLog.create({
    data: {
      actor: params.createdBy ?? "system:weekly-backup",
      action: "BACKUP_CREATED",
      targetType: "BACKUP_SNAPSHOT",
      targetId: created.id,
      detailsJson: JSON.stringify({
        trigger: params.trigger,
        projectsCount: projects.length,
        usersCount: users.length,
        invoicesCount: invoices.length,
        quotesCount: quotes.length,
        sizeBytes,
      }),
    },
  });

  return {
    reused: false,
    backup: {
      id: created.id,
      trigger: created.trigger,
      executionId: created.executionId,
      status: created.status,
      projectsCount: created.projectsCount,
      usersCount: created.usersCount,
      invoicesCount: created.invoicesCount,
      quotesCount: created.quotesCount,
      sizeBytes: created.sizeBytes,
      createdBy: created.createdBy,
      createdAt: created.createdAt.toISOString(),
    },
  };
}
