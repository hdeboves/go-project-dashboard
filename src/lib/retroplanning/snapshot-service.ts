import type { PrismaClient, RetroSnapshot, RetroTask } from "@prisma/client";
import { PILOT_SANDBOX_CONFIG } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import type { GoogleWorkspacePort } from "@/lib/ports";
import {
  diffUtcDays,
  ensureSandboxRetroplanningSheet,
  parseStrictCalendarDate,
  toIsoDateOnly,
} from "@/lib/retroplanning/validation";

export interface SnapshotTaskRecord {
  id: string;
  phase: string;
  etape: string | null;
  tache: string;
  owner: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  isMilestone: boolean;
  milestoneType: string | null;
}

export type DriftClassification =
  | "DELAYED"
  | "AHEAD"
  | "ON_TIME"
  | "COMPLETED"
  | "ADDED"
  | "REMOVED";

export interface SnapshotTaskDiff {
  taskId: string;
  phase: string;
  etape: string | null;
  tache: string;
  fromStartDate: string | null;
  fromEndDate: string | null;
  toStartDate: string | null;
  toEndDate: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  deltaDays: number;
  classification: DriftClassification;
  changeType: DriftClassification;
  completed: boolean;
  label: string;
}

export interface SnapshotComparisonResult {
  fromSnapshot: { id: string; snapshotDate: string };
  toSnapshot: { id: string; snapshotDate: string };
  summary: {
    total: number;
    delayedCount: number;
    aheadCount: number;
    onTimeCount: number;
    completedCount: number;
    addedCount: number;
    removedCount: number;
  };
  diffs: SnapshotTaskDiff[];
}

function sanitizeFilenameSegment(raw: string): string {
  return raw
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_");
}

function serializeTasksForSnapshot(tasks: RetroTask[]): SnapshotTaskRecord[] {
  return tasks.map((t) => ({
    id: t.id,
    phase: t.phase,
    etape: t.etape,
    tache: t.tache,
    owner: t.owner,
    startDate: toIsoDateOnly(t.startDate),
    endDate: toIsoDateOnly(t.endDate),
    status: t.status,
    isMilestone: t.isMilestone,
    milestoneType: t.milestoneType,
  }));
}

export function parseSnapshotTasks(tasksJson: string): SnapshotTaskRecord[] {
  try {
    const parsed: unknown = JSON.parse(tasksJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SnapshotTaskRecord =>
        typeof item === "object" && item !== null && typeof (item as SnapshotTaskRecord).tache === "string"
    );
  } catch {
    return [];
  }
}

export async function isSnapshotEligible14Days(
  prisma: PrismaClient,
  projectId: string,
  now = new Date()
): Promise<{ eligible: boolean; latest: RetroSnapshot | null; daysSinceLast: number | null }> {
  const latest = await prisma.retroSnapshot.findFirst({
    where: { projectId },
    orderBy: [{ snapshotDate: "desc" }, { createdAt: "desc" }],
  });

  if (!latest) {
    return { eligible: true, latest: null, daysSinceLast: null };
  }

  const latestDay = toIsoDateOnly(latest.snapshotDate);
  const todayDay = toIsoDateOnly(now);
  if (latestDay && todayDay && latestDay === todayDay) {
    return { eligible: false, latest, daysSinceLast: 0 };
  }

  const daysSince = diffUtcDays(latest.snapshotDate, now);
  return {
    eligible: daysSince >= 14,
    latest,
    daysSinceLast: daysSince,
  };
}

export async function createRetroSnapshot(
  prisma: PrismaClient,
  projectId: string,
  resolveGateway: () => Promise<GoogleWorkspacePort>,
  opts: {
    snapshotDate?: string;
    mode?: "MANUAL" | "AUTO_14D";
    actor?: string;
  } = {}
): Promise<{
  skipped: boolean;
  snapshot: RetroSnapshot & { fileName?: string };
  fileName: string | null;
}> {
  // 1. Validate snapshotDate strictly BEFORE any Google Drive calls
  let targetDate: Date;
  if (opts.snapshotDate !== undefined && opts.snapshotDate.trim() !== "") {
    const parsed = parseStrictCalendarDate(opts.snapshotDate);
    if (!parsed) {
      throw new AppHttpError(
        400,
        "INVALID_SNAPSHOT_DATE",
        `Date de snapshot invalide : "${opts.snapshotDate}". Format attendu : YYYY-MM-DD valide.`
      );
    }
    targetDate = parsed;
  } else {
    const todayIso = new Date().toISOString().slice(0, 10);
    targetDate = parseStrictCalendarDate(todayIso)!;
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  // 2. For AUTO_14D mode, check 14-day / same-day deduplication BEFORE Drive copy
  if (opts.mode === "AUTO_14D") {
    const eligibility = await isSnapshotEligible14Days(
      prisma,
      projectId,
      targetDate
    );
    if (!eligibility.eligible && eligibility.latest) {
      return {
        skipped: true,
        snapshot: eligibility.latest,
        fileName: null,
      };
    }
  }

  // 3. Resolve Google Gateway BEFORE creating any DB rows (412 if unconfigured)
  const gateway = await resolveGateway();

  // 4. Locate 002.2 Historique Rétroplanning folder
  const folder0022 = await prisma.driveNode.findFirst({
    where: { projectId, code: "002.2", isFolder: true },
  });
  if (!folder0022?.driveFileId) {
    throw new AppHttpError(
      400,
      "DRIVE_002_2_MISSING",
      "Dossier 002.2 Historique Rétroplanning introuvable. Provisionnez l'arborescence Drive d'abord."
    );
  }

  // 5. Ensure source 002.1 Sheet exists (or copy from PROD template)
  const { spreadsheetId } = await ensureSandboxRetroplanningSheet(
    prisma,
    gateway.drive,
    project
  );
  const sourceSheetId =
    spreadsheetId ?? PILOT_SANDBOX_CONFIG.prodTemplates.retroplanningSheetId;

  const dateIso = toIsoDateOnly(targetDate)!;
  const fileName = `${dateIso}_Retroplanning_${sanitizeFilenameSegment(project.client)}_${sanitizeFilenameSegment(project.nomJeu)}`;

  const copied = await gateway.drive.copyFile({
    sourceFileId: sourceSheetId,
    destinationParentId: folder0022.driveFileId,
    name: fileName,
  });

  // 6. Snapshot current RetroTasks in DB
  const tasks = await prisma.retroTask.findMany({
    where: { projectId },
    orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
  });
  const serialized = serializeTasksForSnapshot(tasks);

  const snapshot = await prisma.retroSnapshot.create({
    data: {
      projectId,
      snapshotDate: targetDate,
      driveFileId: copied.id,
      tasksJson: JSON.stringify(serialized),
    },
  });

  // 7. Register 002.2 snapshot DriveNode as strictly INTERNAL_ONLY
  const snapNode = await prisma.driveNode.create({
    data: {
      projectId,
      code: `002.2.snapshot.${snapshot.id}`,
      name: fileName,
      driveFileId: copied.id,
      parentNodeId: folder0022.id,
      isFolder: false,
      mimeType: "application/vnd.google-apps.spreadsheet",
      isExtEligible: false,
      extMirrorFileId: null,
    },
  });

  await prisma.syncStatus.create({
    data: {
      projectId,
      driveNodeId: snapNode.id,
      validationStatus: "BROUILLON_INTERNE",
      driftDetected: false,
      allowPermanentExtSync: false,
    },
  });

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: opts.actor ?? "user",
      action:
        opts.mode === "AUTO_14D"
          ? "RETRO_SNAPSHOT_AUTO_14D"
          : "RETRO_SNAPSHOT_CREATED",
      targetType: "RETRO_SNAPSHOT",
      targetId: snapshot.id,
      detailsJson: JSON.stringify({
        snapshotDate: dateIso,
        fileName,
        driveFileId: copied.id,
        tasksCount: serialized.length,
      }),
    },
  });

  return {
    skipped: false,
    snapshot: { ...snapshot, fileName },
    fileName,
  };
}

export function computeSnapshotDiff(
  fromSnapshot: Pick<RetroSnapshot, "id" | "snapshotDate" | "tasksJson">,
  toSnapshot: Pick<RetroSnapshot, "id" | "snapshotDate" | "tasksJson">
): SnapshotComparisonResult {
  const fromTasks = parseSnapshotTasks(fromSnapshot.tasksJson);
  const toTasks = parseSnapshotTasks(toSnapshot.tasksJson);

  const keyFor = (t: SnapshotTaskRecord) =>
    t.id || `${t.phase.trim().toLowerCase()}::${t.tache.trim().toLowerCase()}`;

  const fromByKey = new Map<string, SnapshotTaskRecord>();
  for (const t of fromTasks) {
    fromByKey.set(keyFor(t), t);
  }

  const toByKey = new Map<string, SnapshotTaskRecord>();
  for (const t of toTasks) {
    toByKey.set(keyFor(t), t);
  }

  const diffs: SnapshotTaskDiff[] = [];
  let delayedCount = 0;
  let aheadCount = 0;
  let onTimeCount = 0;
  let completedCount = 0;
  let addedCount = 0;
  let removedCount = 0;

  for (const [key, toTask] of toByKey.entries()) {
    const fromTask = fromByKey.get(key);
    if (!fromTask) {
      addedCount++;
      diffs.push({
        taskId: toTask.id,
        phase: toTask.phase,
        etape: toTask.etape,
        tache: toTask.tache,
        fromStartDate: null,
        fromEndDate: null,
        toStartDate: toTask.startDate,
        toEndDate: toTask.endDate,
        fromStatus: null,
        toStatus: toTask.status,
        deltaDays: 0,
        classification: "ADDED",
        changeType: "ADDED",
        completed: toTask.status === "TERMINE",
        label: "Ajoutée",
      });
      continue;
    }

    const deltaDays =
      fromTask.endDate && toTask.endDate
        ? diffUtcDays(fromTask.endDate, toTask.endDate)
        : 0;

    const completed = toTask.status === "TERMINE";
    let classification: DriftClassification;
    let label: string;

    if (deltaDays > 0) {
      classification = "DELAYED";
      label = `+${deltaDays} jours`;
      delayedCount++;
    } else if (deltaDays < 0) {
      classification = "AHEAD";
      label = `${deltaDays} jours`;
      aheadCount++;
    } else if (fromTask.status !== "TERMINE" && completed) {
      classification = "COMPLETED";
      label = "0 jours · Terminée";
      completedCount++;
      onTimeCount++;
    } else {
      classification = "ON_TIME";
      label = "0 jours (À l'heure)";
      onTimeCount++;
    }

    diffs.push({
      taskId: toTask.id,
      phase: toTask.phase,
      etape: toTask.etape,
      tache: toTask.tache,
      fromStartDate: fromTask.startDate,
      fromEndDate: fromTask.endDate,
      toStartDate: toTask.startDate,
      toEndDate: toTask.endDate,
      fromStatus: fromTask.status,
      toStatus: toTask.status,
      deltaDays,
      classification,
      changeType: classification,
      completed,
      label,
    });
  }

  for (const [key, fromTask] of fromByKey.entries()) {
    if (toByKey.has(key)) continue;
    removedCount++;
    diffs.push({
      taskId: fromTask.id,
      phase: fromTask.phase,
      etape: fromTask.etape,
      tache: fromTask.tache,
      fromStartDate: fromTask.startDate,
      fromEndDate: fromTask.endDate,
      toStartDate: null,
      toEndDate: null,
      fromStatus: fromTask.status,
      toStatus: null,
      deltaDays: 0,
      classification: "REMOVED",
      changeType: "REMOVED",
      completed: false,
      label: "Supprimée",
    });
  }

  return {
    fromSnapshot: {
      id: fromSnapshot.id,
      snapshotDate: toIsoDateOnly(fromSnapshot.snapshotDate) ?? "",
    },
    toSnapshot: {
      id: toSnapshot.id,
      snapshotDate: toIsoDateOnly(toSnapshot.snapshotDate) ?? "",
    },
    summary: {
      total: diffs.length,
      delayedCount,
      aheadCount,
      onTimeCount,
      completedCount,
      addedCount,
      removedCount,
    },
    diffs,
  };
}

export async function listAndCompareSnapshots(
  prisma: PrismaClient,
  projectId: string,
  compare?: { fromId?: string | null; toId?: string | null }
): Promise<{
  snapshots: RetroSnapshot[];
  comparison: SnapshotComparisonResult | null;
}> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const snapshots = await prisma.retroSnapshot.findMany({
    where: { projectId },
    orderBy: [{ snapshotDate: "desc" }, { createdAt: "desc" }],
  });

  if (!compare?.fromId && !compare?.toId) {
    return { snapshots, comparison: null };
  }

  if (!compare.fromId || !compare.toId) {
    throw new AppHttpError(
      400,
      "SNAPSHOT_COMPARE_PARAMS_MISSING",
      "Les deux identifiants fromId et toId sont requis pour comparer deux snapshots."
    );
  }

  const [fromSnap, toSnap] = await Promise.all([
    prisma.retroSnapshot.findUnique({ where: { id: compare.fromId } }),
    prisma.retroSnapshot.findUnique({ where: { id: compare.toId } }),
  ]);

  if (
    !fromSnap ||
    !toSnap ||
    fromSnap.projectId !== projectId ||
    toSnap.projectId !== projectId
  ) {
    throw new AppHttpError(
      404,
      "SNAPSHOT_NOT_FOUND",
      "Snapshot introuvable pour ce projet."
    );
  }

  return {
    snapshots,
    comparison: computeSnapshotDiff(fromSnap, toSnap),
  };
}
