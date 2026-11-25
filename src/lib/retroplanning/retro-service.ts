import type {
  PrismaClient,
  RetroProposal,
  RetroSnapshot,
  RetroTask,
} from "@prisma/client";
import { syncCalendarCascades } from "@/lib/calendar/calendar-service";
import { AppHttpError } from "@/lib/errors";
import type { GoogleWorkspacePort } from "@/lib/ports";
import {
  RETRO_CORE_COLUMNS,
  RETRO_SHEET_TAB,
  readTasksFromRetroSheet,
  writeTaskToRetroSheet,
} from "@/lib/retroplanning/sheet-codec";
import {
  MILESTONE_TYPES,
  RETRO_STATUSES,
  assertValidDateRange,
  ensureSandboxRetroplanningSheet,
  parseStrictCalendarDate,
  type MilestoneType,
  type RetroStatus,
} from "@/lib/retroplanning/validation";

export interface RetroTaskDto extends RetroTask {
  version: number;
}

export function toRetroTaskDto(task: RetroTask): RetroTaskDto {
  return {
    ...task,
    version: task.updatedAt.getTime(),
  };
}

export interface RetroplanningOverview {
  projectId: string;
  sheetTab: typeof RETRO_SHEET_TAB;
  columns: readonly string[];
  lockPolicy: {
    code: "002.1";
    syncMode: "NO_PERMANENT_EXT_SYNC";
    isInternalOnly: true;
    allowPermanentExtSync: false;
  };
  retroplanningSheetId: string | null;
  tasks: RetroTaskDto[];
  proposals: RetroProposal[];
  snapshots: RetroSnapshot[];
}

export async function syncSheetToDb(
  prisma: PrismaClient,
  gateway: GoogleWorkspacePort,
  projectId: string
): Promise<{ importedCount: number; updatedCount: number; tasks: RetroTaskDto[] }> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const { spreadsheetId } = await ensureSandboxRetroplanningSheet(
    prisma,
    gateway.drive,
    project
  );

  if (!spreadsheetId) {
    const existingTasks = await prisma.retroTask.findMany({
      where: { projectId },
      orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
    });
    return {
      importedCount: 0,
      updatedCount: 0,
      tasks: existingTasks.map(toRetroTaskDto),
    };
  }

  const { tasks: parsedTasks } = await readTasksFromRetroSheet(
    gateway.sheets,
    spreadsheetId
  );

  const existingDbTasks = await prisma.retroTask.findMany({
    where: { projectId },
  });

  let importedCount = 0;
  let updatedCount = 0;

  for (const parsed of parsedTasks) {
    const byId = parsed.id
      ? existingDbTasks.find((t) => t.id === parsed.id)
      : undefined;
    const byRow =
      byId ??
      existingDbTasks.find((t) => t.sheetRowIndex === parsed.sheetRowIndex);
    const byTitle =
      byRow ??
      existingDbTasks.find(
        (t) =>
          t.phase.trim().toLowerCase() === parsed.phase.trim().toLowerCase() &&
          t.tache.trim().toLowerCase() === parsed.tache.trim().toLowerCase()
      );

    if (byTitle) {
      await prisma.retroTask.update({
        where: { id: byTitle.id },
        data: {
          phase: parsed.phase,
          etape: parsed.etape,
          tache: parsed.tache,
          owner: parsed.owner ?? byTitle.owner,
          startDate: parsed.startDate ?? byTitle.startDate,
          endDate: parsed.endDate ?? byTitle.endDate,
          status: parsed.status,
          sheetRowIndex: parsed.sheetRowIndex,
          isMilestone: parsed.isMilestone || byTitle.isMilestone,
          milestoneType: parsed.milestoneType ?? byTitle.milestoneType,
        },
      });
      updatedCount++;
    } else {
      const created = await prisma.retroTask.create({
        data: {
          projectId,
          phase: parsed.phase,
          etape: parsed.etape,
          tache: parsed.tache,
          owner: parsed.owner,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          status: parsed.status,
          sheetRowIndex: parsed.sheetRowIndex,
          isMilestone: parsed.isMilestone,
          milestoneType: parsed.milestoneType,
        },
      });
      existingDbTasks.push(created);
      importedCount++;
    }
  }

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "RETROPLANNING_SYNCED_FROM_SHEET",
      targetType: "GOOGLE_SHEET",
      targetId: spreadsheetId,
      detailsJson: JSON.stringify({ importedCount, updatedCount }),
    },
  });

  const refreshed = await prisma.retroTask.findMany({
    where: { projectId },
    orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
  });

  return {
    importedCount,
    updatedCount,
    tasks: refreshed.map(toRetroTaskDto),
  };
}

export async function getRetroplanningOverview(
  prisma: PrismaClient,
  projectId: string
): Promise<RetroplanningOverview> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const [tasks, proposals, snapshots] = await Promise.all([
    prisma.retroTask.findMany({
      where: { projectId },
      orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
    }),
    prisma.retroProposal.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.retroSnapshot.findMany({
      where: { projectId },
      orderBy: { snapshotDate: "desc" },
    }),
  ]);

  return {
    projectId: project.id,
    sheetTab: RETRO_SHEET_TAB,
    columns: RETRO_CORE_COLUMNS,
    lockPolicy: {
      code: "002.1",
      syncMode: "NO_PERMANENT_EXT_SYNC",
      isInternalOnly: true,
      allowPermanentExtSync: false,
    },
    retroplanningSheetId: project.retroplanningSheetId,
    tasks: tasks.map(toRetroTaskDto),
    proposals,
    snapshots,
  };
}

export interface CreateRetroTaskInput {
  phase: string;
  etape: string;
  tache: string;
  owner?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
  isMilestone?: boolean;
  milestoneType?: string | null;
}

export async function createRetroTask(
  prisma: PrismaClient,
  projectId: string,
  input: CreateRetroTaskInput,
  gateway?: GoogleWorkspacePort | null
): Promise<{ task: RetroTaskDto; sheetSynced: boolean }> {
  const phase = input.phase?.trim();
  const etape = input.etape?.trim();
  const tache = input.tache?.trim();

  if (!phase || !etape || !tache) {
    throw new AppHttpError(
      400,
      "INVALID_RETRO_TASK",
      "Les champs phase, etape et tache sont obligatoires et non vides."
    );
  }

  const status = (input.status ?? "A_FAIRE") as RetroStatus;
  if (!RETRO_STATUSES.includes(status)) {
    throw new AppHttpError(
      400,
      "INVALID_RETRO_STATUS",
      `Statut invalide : "${input.status}".`
    );
  }

  let milestoneType: MilestoneType | null = null;
  if (input.milestoneType !== undefined && input.milestoneType !== null && input.milestoneType !== "") {
    if (!MILESTONE_TYPES.includes(input.milestoneType as MilestoneType)) {
      throw new AppHttpError(
        400,
        "INVALID_MILESTONE_TYPE",
        `Type de jalon invalide : "${input.milestoneType}".`
      );
    }
    milestoneType = input.milestoneType as MilestoneType;
  }

  let startDate: Date | null = null;
  if (input.startDate !== undefined && input.startDate !== null && input.startDate !== "") {
    startDate = parseStrictCalendarDate(input.startDate);
    if (!startDate) {
      throw new AppHttpError(
        400,
        "INVALID_START_DATE",
        `Date de début invalide : "${input.startDate}".`
      );
    }
  }

  let endDate: Date | null = null;
  if (input.endDate !== undefined && input.endDate !== null && input.endDate !== "") {
    endDate = parseStrictCalendarDate(input.endDate);
    if (!endDate) {
      throw new AppHttpError(
        400,
        "INVALID_END_DATE",
        `Date de fin invalide : "${input.endDate}".`
      );
    }
  }

  assertValidDateRange(startDate, endDate);

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  let created = await prisma.retroTask.create({
    data: {
      projectId,
      phase,
      etape,
      tache,
      owner: input.owner?.trim() || null,
      startDate,
      endDate,
      status,
      isMilestone: Boolean(input.isMilestone),
      milestoneType: input.isMilestone ? milestoneType ?? "CUSTOM" : milestoneType,
    },
  });

  let sheetSynced = false;
  if (gateway) {
    const { spreadsheetId } = await ensureSandboxRetroplanningSheet(
      prisma,
      gateway.drive,
      project
    );
    if (spreadsheetId) {
      const writeRes = await writeTaskToRetroSheet(
        gateway.sheets,
        spreadsheetId,
        created
      );
      created = await prisma.retroTask.update({
        where: { id: created.id },
        data: { sheetRowIndex: writeRes.sheetRowIndex },
      });
      sheetSynced = true;
    }
  }

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "RETRO_TASK_CREATED",
      targetType: "RETRO_TASK",
      targetId: created.id,
      detailsJson: JSON.stringify({
        phase: created.phase,
        tache: created.tache,
        sheetSynced,
      }),
    },
  });

  return { task: toRetroTaskDto(created), sheetSynced };
}

export interface UpdateRetroTaskInput {
  id: string;
  phase?: string;
  etape?: string | null;
  tache?: string;
  owner?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
  isMilestone?: boolean;
  milestoneType?: string | null;
  expectedUpdatedAt?: string;
  version?: number;
}

export async function updateRetroTask(
  prisma: PrismaClient,
  projectId: string,
  input: UpdateRetroTaskInput,
  gateway?: GoogleWorkspacePort | null
): Promise<{ task: RetroTaskDto; sheetSynced: boolean }> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const existing = await prisma.retroTask.findUnique({
    where: { id: input.id },
  });
  if (!existing || existing.projectId !== projectId) {
    throw new AppHttpError(
      404,
      "RETRO_TASK_NOT_FOUND",
      "Tâche de rétroplanning introuvable pour ce projet."
    );
  }

  // Optimistic concurrency check BEFORE any DB or Sheet mutation
  if (input.expectedUpdatedAt !== undefined) {
    const expectedMs = new Date(input.expectedUpdatedAt).getTime();
    if (
      Number.isNaN(expectedMs) ||
      expectedMs !== existing.updatedAt.getTime()
    ) {
      throw new AppHttpError(
        409,
        "STALE_TASK_CONFLICT",
        "Conflit de modification concurrente : la tâche a été modifiée entre-temps.",
        {
          currentUpdatedAt: existing.updatedAt.toISOString(),
          expectedUpdatedAt: input.expectedUpdatedAt,
        }
      );
    }
  } else if (
    input.version !== undefined &&
    input.version !== existing.updatedAt.getTime()
  ) {
    throw new AppHttpError(
      409,
      "STALE_TASK_CONFLICT",
      "Conflit de version concurrente : la tâche a été modifiée entre-temps."
    );
  }

  const nextPhase =
    input.phase !== undefined ? input.phase.trim() : existing.phase;
  const nextEtape =
    input.etape !== undefined
      ? (input.etape?.trim() ?? "")
      : existing.etape ?? "";
  const nextTache =
    input.tache !== undefined ? input.tache.trim() : existing.tache;

  if (!nextPhase || !nextTache || (input.etape !== undefined && !nextEtape)) {
    throw new AppHttpError(
      400,
      "INVALID_RETRO_TASK",
      "Les champs phase, etape et tache ne peuvent pas être vides."
    );
  }

  let nextStatus = existing.status as RetroStatus;
  if (input.status !== undefined) {
    if (!RETRO_STATUSES.includes(input.status as RetroStatus)) {
      throw new AppHttpError(
        400,
        "INVALID_RETRO_STATUS",
        `Statut invalide : "${input.status}".`
      );
    }
    nextStatus = input.status as RetroStatus;
  }

  let nextMilestoneType = existing.milestoneType;
  if (input.milestoneType !== undefined) {
    if (input.milestoneType === null || input.milestoneType === "") {
      nextMilestoneType = null;
    } else if (!MILESTONE_TYPES.includes(input.milestoneType as MilestoneType)) {
      throw new AppHttpError(
        400,
        "INVALID_MILESTONE_TYPE",
        `Type de jalon invalide : "${input.milestoneType}".`
      );
    } else {
      nextMilestoneType = input.milestoneType;
    }
  }

  let nextStartDate = existing.startDate;
  if (input.startDate !== undefined) {
    if (input.startDate === null || input.startDate === "") {
      nextStartDate = null;
    } else {
      const parsed = parseStrictCalendarDate(input.startDate);
      if (!parsed) {
        throw new AppHttpError(
          400,
          "INVALID_START_DATE",
          `Date de début invalide : "${input.startDate}".`
        );
      }
      nextStartDate = parsed;
    }
  }

  let nextEndDate = existing.endDate;
  if (input.endDate !== undefined) {
    if (input.endDate === null || input.endDate === "") {
      nextEndDate = null;
    } else {
      const parsed = parseStrictCalendarDate(input.endDate);
      if (!parsed) {
        throw new AppHttpError(
          400,
          "INVALID_END_DATE",
          `Date de fin invalide : "${input.endDate}".`
        );
      }
      nextEndDate = parsed;
    }
  }

  assertValidDateRange(nextStartDate, nextEndDate);

  const nextIsMilestone =
    input.isMilestone !== undefined ? input.isMilestone : existing.isMilestone;

  let updated = await prisma.retroTask.update({
    where: { id: existing.id },
    data: {
      phase: nextPhase,
      etape: nextEtape,
      tache: nextTache,
      owner: input.owner !== undefined ? input.owner?.trim() || null : existing.owner,
      startDate: nextStartDate,
      endDate: nextEndDate,
      status: nextStatus,
      isMilestone: nextIsMilestone,
      milestoneType: nextMilestoneType,
    },
  });

  let sheetSynced = false;
  if (gateway) {
    const { spreadsheetId } = await ensureSandboxRetroplanningSheet(
      prisma,
      gateway.drive,
      project
    );
    if (spreadsheetId) {
      const writeRes = await writeTaskToRetroSheet(
        gateway.sheets,
        spreadsheetId,
        updated
      );
      if (updated.sheetRowIndex !== writeRes.sheetRowIndex) {
        updated = await prisma.retroTask.update({
          where: { id: updated.id },
          data: { sheetRowIndex: writeRes.sheetRowIndex },
        });
      }
      sheetSynced = true;
    }

    // If this task already had scheduled CalendarEvents, cascade in-place if dates/milestone changed
    if (project.calendarId) {
      const linkedCount = await prisma.calendarEvent.count({
        where: {
          projectId,
          retroTaskId: updated.id,
          status: { not: "CANCELLED" },
        },
      });
      if (linkedCount > 0) {
        await syncCalendarCascades(prisma, gateway.calendar, projectId, {
          retroTaskId: updated.id,
        }).catch(() => {
          // Non-fatal if task has no anchor date
        });
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "RETRO_TASK_UPDATED",
      targetType: "RETRO_TASK",
      targetId: updated.id,
      detailsJson: JSON.stringify({
        status: updated.status,
        sheetSynced,
      }),
    },
  });

  return { task: toRetroTaskDto(updated), sheetSynced };
}

export async function deleteRetroTask(
  prisma: PrismaClient,
  projectId: string,
  taskId: string
): Promise<void> {
  const existing = await prisma.retroTask.findUnique({
    where: { id: taskId },
  });
  if (!existing || existing.projectId !== projectId) {
    throw new AppHttpError(
      404,
      "RETRO_TASK_NOT_FOUND",
      "Tâche de rétroplanning introuvable pour ce projet."
    );
  }

  await prisma.retroTask.delete({ where: { id: existing.id } });
  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "RETRO_TASK_DELETED",
      targetType: "RETRO_TASK",
      targetId: existing.id,
      detailsJson: JSON.stringify({ tache: existing.tache }),
    },
  });
}
