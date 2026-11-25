import type { DriveNode, PrismaClient, Project } from "@prisma/client";
import { getSyncPolicy } from "@/lib/drive/sync-policy";
import { PILOT_SANDBOX_CONFIG } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import type { DrivePort } from "@/lib/ports";

export const RETRO_STATUSES = [
  "A_FAIRE",
  "EN_COURS",
  "EN_ATTENTE_CLIENT",
  "TERMINE",
] as const;
export type RetroStatus = (typeof RETRO_STATUSES)[number];

export const MILESTONE_TYPES = [
  "INFLUENCE",
  "LANCEMENT_MAP",
  "WEEKLY",
  "CUSTOM",
] as const;
export type MilestoneType = (typeof MILESTONE_TYPES)[number];

const ISO_DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

/**
 * Strictly parses a YYYY-MM-DD (or ISO datetime prefix) into a UTC-noon Date.
 * Rejects impossible calendar dates like "2026-02-30" or malformed strings.
 */
export function parseStrictCalendarDate(
  value: string | null | undefined
): Date | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = ISO_DATE_PREFIX_RE.exec(trimmed);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return candidate;
}

export function toIsoDateOnly(
  value: Date | string | null | undefined
): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const parsed = parseStrictCalendarDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

export function addUtcDays(dateInput: Date | string, offsetDays: number): Date {
  const iso = toIsoDateOnly(dateInput);
  if (!iso) {
    throw new AppHttpError(
      400,
      "INVALID_DATE",
      "Date invalide pour le calcul calendaire."
    );
  }
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d + offsetDays, 12, 0, 0, 0));
}

export function diffUtcDays(
  fromDate: Date | string,
  toDate: Date | string
): number {
  const fromIso = toIsoDateOnly(fromDate);
  const toIso = toIsoDateOnly(toDate);
  if (!fromIso || !toIso) return 0;
  const [fy, fm, fd] = fromIso.split("-").map((n) => Number.parseInt(n, 10));
  const [ty, tm, td] = toIso.split("-").map((n) => Number.parseInt(n, 10));
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86_400_000);
}

export function normalizeRetroStatus(
  raw: string | null | undefined
): RetroStatus | null {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");

  if (cleaned === "A_FAIRE" || cleaned === "AFAIRE" || cleaned === "TODO") {
    return "A_FAIRE";
  }
  if (cleaned === "EN_COURS" || cleaned === "IN_PROGRESS" || cleaned === "OK_EN_COURS") {
    return "EN_COURS";
  }
  if (
    cleaned === "EN_ATTENTE_CLIENT" ||
    cleaned === "ATTENTE_CLIENT" ||
    cleaned === "WAITING_CLIENT"
  ) {
    return "EN_ATTENTE_CLIENT";
  }
  if (
    cleaned === "TERMINE" ||
    cleaned === "TERMINEE" ||
    cleaned === "DONE" ||
    cleaned === "OK" ||
    cleaned === "VALIDE"
  ) {
    return "TERMINE";
  }
  return null;
}

export function assertValidDateRange(
  startDate: Date | null,
  endDate: Date | null
): void {
  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    throw new AppHttpError(
      400,
      "INVALID_DATE_RANGE",
      "La date de fin (endDate) doit être postérieure ou égale à la date de début (startDate)."
    );
  }
}

export async function ensureSandboxRetroplanningSheet(
  prisma: PrismaClient,
  drive: DrivePort,
  project: Project
): Promise<{ spreadsheetId: string | null; driveNode: DriveNode | null }> {
  const existingNode = await prisma.driveNode.findFirst({
    where: {
      projectId: project.id,
      code: { in: ["002.1.sheet", "002.1"] },
      isFolder: false,
    },
  });

  const existingSheetId =
    project.retroplanningSheetId ?? existingNode?.driveFileId ?? null;
  if (existingSheetId) {
    if (!project.retroplanningSheetId) {
      await prisma.project.update({
        where: { id: project.id },
        data: { retroplanningSheetId: existingSheetId },
      });
    }
    return { spreadsheetId: existingSheetId, driveNode: existingNode };
  }

  const folder0021 = await prisma.driveNode.findFirst({
    where: { projectId: project.id, code: "002.1", isFolder: true },
  });
  if (!folder0021?.driveFileId) {
    return { spreadsheetId: null, driveNode: null };
  }

  const prefix = project.isSandbox
    ? `[PILOTE ${project.codeProjet}]`
    : `[${project.codeProjet}]`;
  const copyName = `${prefix} RETROPLANNING ${project.client}`;

  const existingChildren = await drive.listChildren(folder0021.driveFileId);
  const existingCopy = existingChildren.find(
    (c) => c.name === copyName && !c.trashed
  );

  const copied =
    existingCopy ??
    (await drive.copyFile({
      sourceFileId: PILOT_SANDBOX_CONFIG.prodTemplates.retroplanningSheetId,
      destinationParentId: folder0021.driveFileId,
      name: copyName,
    }));

  await prisma.project.update({
    where: { id: project.id },
    data: { retroplanningSheetId: copied.id },
  });

  // Hard 002.1 policy: NEVER ext-eligible, NEVER permanent ext sync
  const policy = getSyncPolicy("002.1.sheet");
  const node = existingNode
    ? await prisma.driveNode.update({
        where: { id: existingNode.id },
        data: {
          name: copyName,
          driveFileId: copied.id,
          parentNodeId: folder0021.id,
          isFolder: false,
          mimeType: "application/vnd.google-apps.spreadsheet",
          isExtEligible: false,
          extMirrorFileId: null,
        },
      })
    : await prisma.driveNode.create({
        data: {
          projectId: project.id,
          code: "002.1.sheet",
          name: copyName,
          driveFileId: copied.id,
          parentNodeId: folder0021.id,
          isFolder: false,
          mimeType: "application/vnd.google-apps.spreadsheet",
          isExtEligible: policy.isExtEligible,
          extMirrorFileId: null,
        },
      });

  await prisma.syncStatus.upsert({
    where: { driveNodeId: node.id },
    update: {
      allowPermanentExtSync: false,
      driftDetected: false,
    },
    create: {
      projectId: project.id,
      driveNodeId: node.id,
      validationStatus: "BROUILLON_INTERNE",
      driftDetected: false,
      allowPermanentExtSync: false,
    },
  });

  return { spreadsheetId: copied.id, driveNode: node };
}
