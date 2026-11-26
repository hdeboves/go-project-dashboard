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

function sanitizeInvoiceExtractedJsonForBackup(raw: string): string {
  try {
    const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
    if ("pdfBase64" in parsed) {
      delete parsed.pdfBase64;
    }
    if ("localPdfPath" in parsed) {
      delete parsed.localPdfPath;
    }
    return JSON.stringify(parsed);
  } catch {
    return "{}";
  }
}

/**
 * Creates a sanitized full workspace backup snapshot in PostgreSQL.
 * Excludes encrypted OAuth tokens, API keys, and binary PDF blobs (pdfData/pdfBase64).
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
    vendors,
    budgetLines,
    quotes,
    invoicesRaw,
    retroTasks,
    weeklyReports,
    meetingNotes,
    calendarRules,
    calendarEvents,
    driveNodes,
    fortniteMetrics,
    influenceMetrics,
    verbatims,
  ] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.project.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.projectMember.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.categoryTemplate.findMany(),
    prisma.vendor.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.budgetLine.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.quote.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        projectId: true,
        budgetLineId: true,
        quoteNumber: true,
        vendorName: true,
        description: true,
        issueDate: true,
        validUntil: true,
        amountHt: true,
        tvaAmount: true,
        amountTtc: true,
        status: true,
        originalFilename: true,
        driveFileId: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.invoice.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        projectId: true,
        uploadedById: true,
        budgetLineId: true,
        quoteId: true,
        gmailMessageId: true,
        originalFilename: true,
        renamedFilename: true,
        driveFileId: true,
        vendorName: true,
        invoiceNumber: true,
        supplierInvoiceNumber: true,
        invoiceDate: true,
        amountHt: true,
        tvaAmount: true,
        amountTtc: true,
        invoiceType: true,
        prestationLabel: true,
        detectedCodeProjet: true,
        projectCodesJson: true,
        vigilanceDriveFileId: true,
        vigilanceFilename: true,
        cpConflict: true,
        status: true,
        pennylaneDraftId: true,
        extractedJson: true,
        stepDriveDone: true,
        stepSheetDone: true,
        stepGmailDone: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.retroTask.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.weeklyReport.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.meetingNote.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.calendarRule.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.calendarEvent.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.driveNode.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.fortniteMetric.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.influenceMetric.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.verbatim.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const invoices = invoicesRaw.map((inv) => ({
    ...inv,
    extractedJson: sanitizeInvoiceExtractedJsonForBackup(inv.extractedJson),
  }));

  const payload = {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    trigger: params.trigger,
    counts: {
      users: users.length,
      projects: projects.length,
      projectMembers: projectMembers.length,
      categoryTemplates: categoryTemplates.length,
      vendors: vendors.length,
      budgetLines: budgetLines.length,
      quotes: quotes.length,
      invoices: invoices.length,
      retroTasks: retroTasks.length,
      weeklyReports: weeklyReports.length,
      meetingNotes: meetingNotes.length,
      driveNodes: driveNodes.length,
      fortniteMetrics: fortniteMetrics.length,
      influenceMetrics: influenceMetrics.length,
    },
    data: {
      users,
      projects,
      projectMembers,
      categoryTemplates,
      vendors,
      budgetLines,
      quotes,
      invoices,
      retroTasks,
      weeklyReports,
      meetingNotes,
      calendarRules,
      calendarEvents,
      driveNodes,
      fortniteMetrics,
      influenceMetrics,
      verbatims,
    },
  };

  const payloadJson = JSON.stringify(payload);
  const sizeBytes = Buffer.byteLength(payloadJson, "utf8");

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.backupSnapshot.create({
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
    const oldSnapshots = await tx.backupSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      skip: MAX_RETAINED_BACKUPS,
      select: { id: true },
    });
    if (oldSnapshots.length > 0) {
      await tx.backupSnapshot.deleteMany({
        where: { id: { in: oldSnapshots.map((s) => s.id) } },
      });
    }

    await tx.auditLog.create({
      data: {
        actor: params.createdBy ?? "system:weekly-backup",
        action: "BACKUP_CREATED",
        targetType: "BACKUP_SNAPSHOT",
        targetId: row.id,
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

    return row;
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
