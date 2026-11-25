import type { PrismaClient, RetroProposal } from "@prisma/client";
import { AppHttpError } from "@/lib/errors";
import {
  CpConflictError,
  checkCodeProjetConflict,
  type CpConflictResult,
} from "@/lib/isolation/cp-guard";
import type { GeminiPort, GoogleWorkspacePort } from "@/lib/ports";
import {
  RETRO_STATUSES,
  parseStrictCalendarDate,
  toIsoDateOnly,
  type RetroStatus,
} from "@/lib/retroplanning/validation";

export interface VeilleEmailInput {
  id: string;
  subject: string;
  body?: string;
  snippet?: string;
  date?: string;
  attachmentNames?: string[];
  attachments?: Array<{ filename?: string }>;
}

export interface VeilleDriveFileInput {
  id: string;
  parentCode?: string;
  name: string;
  note?: string;
  modifiedTime?: string | null;
}

export interface RunRetroVeilleInput {
  includeDrive?: boolean;
  emails?: VeilleEmailInput[];
  driveFiles?: VeilleDriveFileInput[];
}

export interface BlockedVeilleConflict {
  sourceType: "GMAIL" | "DRIVE";
  sourceRef: string;
  conflictingCps: string[];
  reason: string;
}

export async function runRetroVeille(
  prisma: PrismaClient,
  gateway: GoogleWorkspacePort,
  gemini: GeminiPort,
  projectId: string,
  input: RunRetroVeilleInput = {},
  actor = "user"
): Promise<{
  proposals: RetroProposal[];
  blockedConflicts: BlockedVeilleConflict[];
}> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  // 1. Collect emails (explicit input or live Gmail search scoped to project)
  let rawEmails: VeilleEmailInput[];
  if (input.emails !== undefined) {
    rawEmails = input.emails;
  } else {
    const q = project.codeProjet
      ? `${project.codeProjet} OR "${project.client}"`
      : project.client;
    const listed = await gateway.gmail.listMessages({ q, maxResults: 15 });
    const details = await Promise.all(
      (listed.messages ?? []).slice(0, 15).map((m) =>
        gateway.gmail.getMessage(m.id).catch(() => null)
      )
    );
    rawEmails = details
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map((d) => ({
        id: d.id,
        subject: d.subject,
        body: d.textBody || d.snippet,
        snippet: d.snippet,
        date: d.date,
        attachmentNames: (d.attachments ?? [])
          .map((a) => a.filename)
          .filter((name): name is string => Boolean(name && name.trim())),
      }));
  }

  // 2. Collect 004. Production Drive files (explicit input or live Drive listing)
  let rawDriveFiles: VeilleDriveFileInput[];
  if (input.includeDrive === false) {
    rawDriveFiles = [];
  } else if (input.driveFiles !== undefined) {
    rawDriveFiles = input.driveFiles;
  } else {
    const prodFolders = await prisma.driveNode.findMany({
      where: {
        projectId,
        code: { startsWith: "004." },
        isFolder: true,
        driveFileId: { not: null },
      },
      take: 20,
    });
    const collected: VeilleDriveFileInput[] = [];
    for (const folder of prodFolders) {
      if (!folder.driveFileId) continue;
      const children = await gateway.drive
        .listChildren(folder.driveFileId)
        .catch(() => []);
      for (const child of children) {
        if (child.mimeType === "application/vnd.google-apps.folder" || child.trashed) {
          continue;
        }
        collected.push({
          id: child.id,
          parentCode: folder.code,
          name: child.name,
          modifiedTime: child.modifiedTime ?? null,
        });
      }
    }
    rawDriveFiles = collected;
  }

  // Short-circuit cleanly when there is nothing to analyze (zero dummy proposals)
  if (rawEmails.length === 0 && rawDriveFiles.length === 0) {
    await prisma.auditLog.create({
      data: {
        projectId,
        actor,
        action: "RETRO_VEILLE_COMPLETED",
        targetType: "PROJECT",
        targetId: projectId,
        detailsJson: JSON.stringify({
          emailsScanned: 0,
          driveFilesScanned: 0,
          proposalsCreated: 0,
          blockedConflicts: 0,
        }),
      },
    });
    return { proposals: [], blockedConflicts: [] };
  }

  // 3. Deterministic Zero-Mix CP conflict check on raw sources BEFORE Gemini
  const cleanEmails: VeilleEmailInput[] = [];
  const cleanDriveFiles: VeilleDriveFileInput[] = [];
  const blockedConflicts: BlockedVeilleConflict[] = [];
  let firstConflictResult: CpConflictResult | null = null;

  for (const email of rawEmails) {
    const attachmentNames = [
      ...(email.attachmentNames ?? []),
      ...(email.attachments ?? []).map((a) => a.filename ?? ""),
    ]
      .map((s) => s.trim())
      .filter(Boolean);
    const rawText = `${email.subject}\n${email.body ?? ""}\n${email.snippet ?? ""}\n${attachmentNames.join("\n")}`;
    const cpCheck = checkCodeProjetConflict(project.codeProjet, null, rawText);
    if (cpCheck.hasConflict) {
      if (!firstConflictResult) firstConflictResult = cpCheck;
      blockedConflicts.push({
        sourceType: "GMAIL",
        sourceRef: email.id,
        conflictingCps: cpCheck.conflictingCps,
        reason: cpCheck.reason ?? "Conflit CP détecté dans l'e-mail.",
      });
      await prisma.auditLog.create({
        data: {
          projectId,
          actor: "system:cp-guard",
          action: "CP_CONFLICT_BLOCKED",
          targetType: "RETRO_VEILLE_EMAIL",
          targetId: email.id,
          detailsJson: JSON.stringify({
            activeCp: project.codeProjet,
            conflictingCps: cpCheck.conflictingCps,
            detectedCps: cpCheck.detectedCps,
            subject: email.subject,
            attachmentNames,
          }),
        },
      });
    } else {
      cleanEmails.push({
        ...email,
        attachmentNames,
      });
    }
  }

  for (const file of rawDriveFiles) {
    const rawText = `${file.name}\n${file.note ?? ""}`;
    const cpCheck = checkCodeProjetConflict(project.codeProjet, null, rawText);
    if (cpCheck.hasConflict) {
      if (!firstConflictResult) firstConflictResult = cpCheck;
      blockedConflicts.push({
        sourceType: "DRIVE",
        sourceRef: file.id,
        conflictingCps: cpCheck.conflictingCps,
        reason: cpCheck.reason ?? "Conflit CP détecté dans le fichier Drive.",
      });
      await prisma.auditLog.create({
        data: {
          projectId,
          actor: "system:cp-guard",
          action: "CP_CONFLICT_BLOCKED",
          targetType: "RETRO_VEILLE_DRIVE",
          targetId: file.id,
          detailsJson: JSON.stringify({
            activeCp: project.codeProjet,
            conflictingCps: cpCheck.conflictingCps,
            detectedCps: cpCheck.detectedCps,
            name: file.name,
          }),
        },
      });
    } else {
      cleanDriveFiles.push(file);
    }
  }

  if (
    cleanEmails.length === 0 &&
    cleanDriveFiles.length === 0 &&
    firstConflictResult
  ) {
    throw new CpConflictError(firstConflictResult);
  }

  // 4. Fetch current tasks for context & call Gemini
  const currentTasks = await prisma.retroTask.findMany({
    where: { projectId },
    orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
  });

  const aiResult = await gemini.analyzeRetroplanningVeille({
    projectContext: {
      codeProjet: project.codeProjet,
      client: project.client,
      nomJeu: project.nomJeu,
    },
    emails: cleanEmails.map((e) => {
      const baseText = e.body || e.snippet || "";
      const attSuffix =
        e.attachmentNames && e.attachmentNames.length > 0
          ? `\n[PJ: ${e.attachmentNames.join(", ")}]`
          : "";
      const combinedSnippet =
        attSuffix.length > 0
          ? `${baseText.slice(0, Math.max(0, 1200 - attSuffix.length))}${attSuffix}`
          : baseText.slice(0, 1200);
      return {
        id: e.id,
        subject: e.subject,
        date: e.date ?? new Date().toISOString(),
        snippet: combinedSnippet,
      };
    }),
    driveFiles: cleanDriveFiles.map((f) => ({
      id: f.id,
      name: f.note ? `${f.name} — ${f.note}` : f.name,
      modifiedTime: f.modifiedTime ?? null,
    })),
    currentTasks: currentTasks.map((t) => ({
      id: t.id,
      phase: t.phase,
      tache: t.tache,
      status: t.status,
      startDate: toIsoDateOnly(t.startDate),
      endDate: toIsoDateOnly(t.endDate),
    })),
  });

  // 5. Validate Gemini output with CP guard and persist clean PENDING proposals
  const createdProposals: RetroProposal[] = [];

  for (const item of aiResult.proposals ?? []) {
    const aiCpCheck = checkCodeProjetConflict(
      project.codeProjet,
      item.detectedCodeProjet,
      `${item.summary} ${item.taskTitle} ${item.sourceRef}`
    );
    if (aiCpCheck.hasConflict) {
      if (!firstConflictResult) firstConflictResult = aiCpCheck;
      blockedConflicts.push({
        sourceType: item.sourceType,
        sourceRef: item.sourceRef,
        conflictingCps: aiCpCheck.conflictingCps,
        reason: aiCpCheck.reason ?? "Conflit CP détecté dans la proposition IA.",
      });
      await prisma.auditLog.create({
        data: {
          projectId,
          actor: "system:cp-guard",
          action: "CP_CONFLICT_BLOCKED",
          targetType: "RETRO_PROPOSAL",
          targetId: item.sourceRef,
          detailsJson: JSON.stringify({
            activeCp: project.codeProjet,
            conflictingCps: aiCpCheck.conflictingCps,
            detectedCodeProjet: item.detectedCodeProjet,
            summary: item.summary,
          }),
        },
      });
      continue;
    }

    // Match task strictly inside this project
    let matchedTask = item.retroTaskId
      ? currentTasks.find((t) => t.id === item.retroTaskId)
      : undefined;
    if (!matchedTask && item.taskTitle) {
      const targetLower = item.taskTitle.trim().toLowerCase();
      matchedTask = currentTasks.find(
        (t) =>
          t.tache.toLowerCase() === targetLower ||
          t.tache.toLowerCase().includes(targetLower) ||
          targetLower.includes(t.tache.toLowerCase())
      );
    }

    const proposedStatus = RETRO_STATUSES.includes(
      item.proposedStatus as RetroStatus
    )
      ? item.proposedStatus
      : null;

    const proposedStartDate = parseStrictCalendarDate(item.proposedStartDate);
    const proposedEndDate = parseStrictCalendarDate(item.proposedEndDate);

    // Find evidence quote from source
    const sourceEmail = cleanEmails.find((e) => e.id === item.sourceRef);
    const sourceFile = cleanDriveFiles.find((f) => f.id === item.sourceRef);
    const evidenceQuote =
      sourceEmail?.body?.slice(0, 280) ??
      sourceEmail?.snippet?.slice(0, 280) ??
      sourceFile?.note?.slice(0, 280) ??
      sourceFile?.name ??
      null;

    const resolvedRetroTaskId = matchedTask?.id ?? null;

    // Deduplicate existing PENDING proposals for (projectId, sourceType, sourceRef, retroTaskId)
    const existingPending = await prisma.retroProposal.findFirst({
      where: {
        projectId,
        sourceType: item.sourceType,
        sourceRef: item.sourceRef,
        retroTaskId: resolvedRetroTaskId,
        status: "PENDING",
      },
    });
    if (existingPending) {
      continue;
    }

    const saved = await prisma.retroProposal.create({
      data: {
        projectId,
        retroTaskId: resolvedRetroTaskId,
        sourceType: item.sourceType,
        sourceRef: item.sourceRef,
        summary: item.summary.trim() || item.taskTitle,
        evidenceQuote,
        proposedStatus,
        proposedStartDate,
        proposedEndDate,
        deltaDays: Number.isFinite(item.deltaDays) ? Math.trunc(item.deltaDays) : 0,
        confidence:
          typeof item.confidence === "number"
            ? Math.max(0, Math.min(1, item.confidence))
            : 0.8,
        status: "PENDING",
      },
    });
    createdProposals.push(saved);
  }

  if (createdProposals.length === 0 && firstConflictResult) {
    throw new CpConflictError(firstConflictResult);
  }

  await prisma.auditLog.create({
    data: {
      projectId,
      actor,
      action: "RETRO_VEILLE_COMPLETED",
      targetType: "PROJECT",
      targetId: projectId,
      detailsJson: JSON.stringify({
        emailsScanned: cleanEmails.length,
        driveFilesScanned: cleanDriveFiles.length,
        proposalsCreated: createdProposals.length,
        blockedConflicts: blockedConflicts.length,
      }),
    },
  });

  return {
    proposals: createdProposals,
    blockedConflicts,
  };
}
