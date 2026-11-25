import type { PrismaClient, RetroProposal } from "@prisma/client";
import { syncCalendarCascades } from "@/lib/calendar/calendar-service";
import { AppHttpError } from "@/lib/errors";
import {
  CpConflictError,
  checkCodeProjetConflict,
} from "@/lib/isolation/cp-guard";
import type { GoogleWorkspacePort } from "@/lib/ports";
import { toRetroTaskDto, type RetroTaskDto } from "@/lib/retroplanning/retro-service";
import { writeTaskToRetroSheet } from "@/lib/retroplanning/sheet-codec";
import {
  RETRO_STATUSES,
  addUtcDays,
  assertValidDateRange,
  ensureSandboxRetroplanningSheet,
  parseStrictCalendarDate,
  type RetroStatus,
} from "@/lib/retroplanning/validation";

export interface ApplyProposalInput {
  action: "APPLY" | "DISMISS";
  retroTaskId?: string;
  proposedStatus?: string;
  proposedStartDate?: string | null;
  proposedEndDate?: string | null;
}

export async function applyOrDismissProposal(
  prisma: PrismaClient,
  projectId: string,
  proposalId: string,
  input: ApplyProposalInput,
  resolveGateway: () => Promise<GoogleWorkspacePort>
): Promise<{
  proposal: RetroProposal;
  task: RetroTaskDto | null;
  calendarSynced: boolean;
}> {
  if (input.action !== "APPLY" && input.action !== "DISMISS") {
    throw new AppHttpError(
      400,
      "INVALID_PROPOSAL_ACTION",
      `Action invalide : "${String(input.action)}". Valeurs attendues : APPLY ou DISMISS.`
    );
  }

  if (
    input.proposedStatus !== undefined &&
    !RETRO_STATUSES.includes(input.proposedStatus as RetroStatus)
  ) {
    throw new AppHttpError(
      400,
      "INVALID_RETRO_STATUS",
      `Statut invalide : "${input.proposedStatus}".`
    );
  }

  let overrideStartDate: Date | null | undefined;
  if (input.proposedStartDate !== undefined) {
    if (input.proposedStartDate === null || input.proposedStartDate === "") {
      overrideStartDate = null;
    } else {
      const parsed = parseStrictCalendarDate(input.proposedStartDate);
      if (!parsed) {
        throw new AppHttpError(
          400,
          "INVALID_START_DATE",
          `proposedStartDate invalide : "${input.proposedStartDate}".`
        );
      }
      overrideStartDate = parsed;
    }
  }

  let overrideEndDate: Date | null | undefined;
  if (input.proposedEndDate !== undefined) {
    if (input.proposedEndDate === null || input.proposedEndDate === "") {
      overrideEndDate = null;
    } else {
      const parsed = parseStrictCalendarDate(input.proposedEndDate);
      if (!parsed) {
        throw new AppHttpError(
          400,
          "INVALID_END_DATE",
          `proposedEndDate invalide : "${input.proposedEndDate}".`
        );
      }
      overrideEndDate = parsed;
    }
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const proposal = await prisma.retroProposal.findUnique({
    where: { id: proposalId },
  });
  if (!proposal || proposal.projectId !== projectId) {
    throw new AppHttpError(
      404,
      "RETRO_PROPOSAL_NOT_FOUND",
      "Proposition IA introuvable pour ce projet."
    );
  }

  if (proposal.status === "CONFLICT_BLOCKED") {
    const check = checkCodeProjetConflict(
      project.codeProjet,
      null,
      `${proposal.summary} ${proposal.evidenceQuote ?? ""}`
    );
    throw new CpConflictError(check);
  }

  if (proposal.status !== "PENDING") {
    throw new AppHttpError(
      409,
      "PROPOSAL_ALREADY_PROCESSED",
      `Cette proposition a déjà été traitée (statut : ${proposal.status}).`
    );
  }

  if (input.action === "DISMISS") {
    const dismissed = await prisma.retroProposal.update({
      where: { id: proposal.id },
      data: { status: "DISMISSED" },
    });

    await prisma.auditLog.create({
      data: {
        projectId,
        actor: "user",
        action: "RETRO_PROPOSAL_DISMISSED",
        targetType: "RETRO_PROPOSAL",
        targetId: proposal.id,
        detailsJson: JSON.stringify({
          sourceType: proposal.sourceType,
          sourceRef: proposal.sourceRef,
        }),
      },
    });

    return {
      proposal: dismissed,
      task: null,
      calendarSynced: false,
    };
  }

  // APPLY path
  const targetTaskId = input.retroTaskId ?? proposal.retroTaskId;
  if (!targetTaskId) {
    throw new AppHttpError(
      400,
      "RETRO_TASK_REQUIRED",
      "Aucune tâche cible associée à cette proposition."
    );
  }

  const task = await prisma.retroTask.findUnique({
    where: { id: targetTaskId },
  });
  if (!task || task.projectId !== projectId) {
    throw new AppHttpError(
      404,
      "RETRO_TASK_NOT_FOUND",
      "Tâche cible introuvable pour ce projet."
    );
  }

  const nextStatus = (input.proposedStatus ??
    proposal.proposedStatus ??
    task.status) as RetroStatus;

  const nextStartDate =
    overrideStartDate !== undefined
      ? overrideStartDate
      : proposal.proposedStartDate ?? task.startDate;

  let nextEndDate: Date | null;
  if (overrideEndDate !== undefined) {
    nextEndDate = overrideEndDate;
  } else if (proposal.proposedEndDate) {
    nextEndDate = proposal.proposedEndDate;
  } else if (proposal.deltaDays !== 0 && task.endDate) {
    nextEndDate = addUtcDays(task.endDate, proposal.deltaDays);
  } else {
    nextEndDate = task.endDate;
  }

  assertValidDateRange(nextStartDate, nextEndDate);

  // Resolve Google Gateway BEFORE mutating DB (412 if unconfigured)
  const gateway = await resolveGateway();

  let updatedTask = await prisma.retroTask.update({
    where: { id: task.id },
    data: {
      status: nextStatus,
      startDate: nextStartDate,
      endDate: nextEndDate,
    },
  });

  // Sync forward to Sandbox Sheet 002.1 (never to [EXT])
  const { spreadsheetId } = await ensureSandboxRetroplanningSheet(
    prisma,
    gateway.drive,
    project
  );
  if (spreadsheetId) {
    const writeRes = await writeTaskToRetroSheet(
      gateway.sheets,
      spreadsheetId,
      updatedTask
    );
    if (updatedTask.sheetRowIndex !== writeRes.sheetRowIndex) {
      updatedTask = await prisma.retroTask.update({
        where: { id: updatedTask.id },
        data: { sheetRowIndex: writeRes.sheetRowIndex },
      });
    }
  }

  // Ensure 002.1 remains strictly non-EXT-syncable
  await prisma.syncStatus.updateMany({
    where: {
      projectId,
      driveNode: { code: { startsWith: "002.1" } },
    },
    data: {
      allowPermanentExtSync: false,
    },
  });

  // Cascade Google Calendar in-place if this task is a milestone with dates and calendar exists
  let calendarSynced = false;
  if (
    updatedTask.isMilestone &&
    project.calendarId &&
    (updatedTask.startDate || updatedTask.endDate)
  ) {
    try {
      await syncCalendarCascades(prisma, gateway.calendar, projectId, {
        retroTaskId: updatedTask.id,
      });
      calendarSynced = true;
    } catch (err) {
      if (
        !(err instanceof AppHttpError && err.code === "MILESTONE_DATE_MISSING")
      ) {
        throw err;
      }
    }
  }

  const appliedProposal = await prisma.retroProposal.update({
    where: { id: proposal.id },
    data: {
      status: "APPLIED",
      retroTaskId: updatedTask.id,
      proposedStatus: nextStatus,
      proposedStartDate: nextStartDate,
      proposedEndDate: nextEndDate,
    },
  });

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "RETRO_PROPOSAL_APPLIED",
      targetType: "RETRO_PROPOSAL",
      targetId: appliedProposal.id,
      detailsJson: JSON.stringify({
        retroTaskId: updatedTask.id,
        nextStatus,
        calendarSynced,
      }),
    },
  });

  return {
    proposal: appliedProposal,
    task: toRetroTaskDto(updatedTask),
    calendarSynced,
  };
}
