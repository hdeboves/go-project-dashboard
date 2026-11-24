import type { DriveNode, PrismaClient, SyncStatus } from "@prisma/client";
import {
  InternalOnlySyncForbiddenError,
  RetroplanningPermanentSyncForbiddenError,
  SyncMode,
  ValidationStatus,
  assertExtSyncAllowed,
  getSyncPolicy,
  isRetroplanningNodeCode,
} from "@/lib/drive/sync-policy";
import { AppHttpError } from "@/lib/errors";
import { assertNoCpConflict } from "@/lib/isolation/cp-guard";
import type { DrivePort } from "@/lib/ports";

export function computeDrift(
  node: Pick<
    DriveNode,
    "code" | "isFolder" | "extMirrorFileId" | "internalModifiedAt" | "lastSyncedAt"
  >,
  syncStatus: Pick<
    SyncStatus,
    "validationStatus" | "allowPermanentExtSync"
  > | null
): boolean {
  const policy = getSyncPolicy(node.code);
  if (
    isRetroplanningNodeCode(node.code) ||
    policy.syncMode !== SyncMode.SYNCABLE_ON_VALIDATION
  ) {
    return false;
  }
  if (
    !syncStatus ||
    syncStatus.validationStatus !== ValidationStatus.VALIDE_CLIENT ||
    !syncStatus.allowPermanentExtSync
  ) {
    return false;
  }
  if (node.isFolder) {
    return false;
  }
  if (!node.extMirrorFileId) {
    return true;
  }
  if (
    node.internalModifiedAt &&
    (!node.lastSyncedAt || node.internalModifiedAt > node.lastSyncedAt)
  ) {
    return true;
  }
  return false;
}

export async function refreshProjectDriveDrift(
  prisma: PrismaClient,
  drive: DrivePort,
  projectId: string
): Promise<{ checkedCount: number; driftCount: number }> {
  const nodes = await prisma.driveNode.findMany({
    where: {
      projectId,
      isFolder: false,
      driveFileId: { not: null },
    },
    include: { syncStatus: true },
  });

  let checkedCount = 0;
  let driftCount = 0;

  for (const node of nodes) {
    if (!node.driveFileId || node.code.startsWith("EXT.")) continue;
    try {
      const meta = await drive.getFileMetadata(node.driveFileId);
      checkedCount++;
      const internalModifiedAt = meta.modifiedTime
        ? new Date(meta.modifiedTime)
        : node.internalModifiedAt;
      const contentHash = meta.md5Checksum ?? node.contentHash;

      const updatedNode = await prisma.driveNode.update({
        where: { id: node.id },
        data: {
          internalModifiedAt,
          contentHash,
        },
      });

      const drift = computeDrift(updatedNode, node.syncStatus);
      if (drift) driftCount++;

      if (node.syncStatus) {
        await prisma.syncStatus.update({
          where: { id: node.syncStatus.id },
          data: { driftDetected: drift },
        });
      }
    } catch {
      // Skip inaccessible individual files without breaking entire listing
    }
  }

  return { checkedCount, driftCount };
}

export async function updateDriveNodeStatus(
  prisma: PrismaClient,
  params: {
    projectId: string;
    nodeId: string;
    validationStatus?: ValidationStatus;
    allowPermanentExtSync?: boolean;
    name?: string;
  }
): Promise<{ node: DriveNode; syncStatus: SyncStatus }> {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
  });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const node = await prisma.driveNode.findUnique({
    where: { id: params.nodeId },
    include: { syncStatus: true },
  });
  if (!node || node.projectId !== params.projectId) {
    throw new AppHttpError(
      404,
      "DRIVE_NODE_NOT_FOUND",
      "Nœud Drive introuvable pour ce projet."
    );
  }

  if (params.name !== undefined) {
    assertNoCpConflict(project.codeProjet, null, params.name);
  }

  const policy = getSyncPolicy(node.code);

  // Two-layer lock enforcement: reject allowPermanentExtSync=true on 002.1 or INTERNAL_ONLY
  if (params.allowPermanentExtSync === true) {
    if (isRetroplanningNodeCode(node.code)) {
      throw new RetroplanningPermanentSyncForbiddenError(node.code);
    }
    if (policy.syncMode === SyncMode.INTERNAL_ONLY) {
      throw new InternalOnlySyncForbiddenError(node.code);
    }
  }

  const updatedNode = await prisma.driveNode.update({
    where: { id: node.id },
    data: {
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
    },
  });

  const nextValidationStatus =
    params.validationStatus ??
    (node.syncStatus?.validationStatus as ValidationStatus | undefined) ??
    ValidationStatus.BROUILLON_INTERNE;

  const isLocked =
    isRetroplanningNodeCode(node.code) ||
    policy.syncMode !== SyncMode.SYNCABLE_ON_VALIDATION;

  const nextAllowPermanent = isLocked
    ? false
    : params.allowPermanentExtSync ??
      node.syncStatus?.allowPermanentExtSync ??
      policy.allowPermanentExtSync;

  const driftDetected = computeDrift(updatedNode, {
    validationStatus: nextValidationStatus,
    allowPermanentExtSync: nextAllowPermanent,
  });

  const syncStatus = await prisma.syncStatus.upsert({
    where: { driveNodeId: node.id },
    update: {
      validationStatus: nextValidationStatus,
      allowPermanentExtSync: nextAllowPermanent,
      driftDetected,
    },
    create: {
      projectId: params.projectId,
      driveNodeId: node.id,
      validationStatus: nextValidationStatus,
      allowPermanentExtSync: nextAllowPermanent,
      driftDetected,
    },
  });

  return { node: updatedNode, syncStatus };
}

export async function syncProjectToExternal(
  prisma: PrismaClient,
  drive: DrivePort,
  projectId: string,
  opts?: { nodeIds?: string[] }
): Promise<{
  syncedCount: number;
  skippedCount: number;
  syncedNodes: Array<{
    nodeId: string;
    code: string;
    name: string;
    extMirrorFileId: string;
    method: "files.update" | "files.copy" | "pdf_export_create";
  }>;
}> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const allNodes = await prisma.driveNode.findMany({
    where: { projectId },
    include: { syncStatus: true },
  });

  const extFolderByCode = new Map<string, DriveNode>();
  for (const n of allNodes) {
    if (n.code.startsWith("EXT.") && n.driveFileId) {
      extFolderByCode.set(n.code, n);
    }
  }

  // If explicit nodeIds are passed, enforce hard 403 on 002.1 or INTERNAL_ONLY
  if (opts?.nodeIds && opts.nodeIds.length > 0) {
    for (const targetId of opts.nodeIds) {
      const targetNode = allNodes.find((n) => n.id === targetId);
      if (!targetNode) {
        throw new AppHttpError(
          404,
          "DRIVE_NODE_NOT_FOUND",
          `Nœud Drive "${targetId}" introuvable.`
        );
      }
      assertExtSyncAllowed(targetNode.code);
    }
  }

  const targetIdSet = opts?.nodeIds?.length ? new Set(opts.nodeIds) : null;
  const syncedNodes: Array<{
    nodeId: string;
    code: string;
    name: string;
    extMirrorFileId: string;
    method: "files.update" | "files.copy" | "pdf_export_create";
  }> = [];
  let skippedCount = 0;

  for (const node of allNodes) {
    if (node.code.startsWith("EXT.")) continue;
    if (targetIdSet && !targetIdSet.has(node.id)) continue;

    // Layer 1 & 2 lock: global sync NEVER touches 002.1 or INTERNAL_ONLY
    const policy = getSyncPolicy(node.code);
    if (
      isRetroplanningNodeCode(node.code) ||
      policy.syncMode !== SyncMode.SYNCABLE_ON_VALIDATION
    ) {
      skippedCount++;
      continue;
    }

    if (
      !node.syncStatus ||
      node.syncStatus.validationStatus !== ValidationStatus.VALIDE_CLIENT ||
      !node.syncStatus.allowPermanentExtSync
    ) {
      skippedCount++;
      continue;
    }

    if (node.isFolder || !node.driveFileId) {
      continue;
    }

    const extTargetFolder = policy.extMirrorCode
      ? extFolderByCode.get(policy.extMirrorCode)
      : undefined;
    const extTargetFolderId =
      extTargetFolder?.driveFileId ?? project.driveExternalRootId;

    if (!extTargetFolderId) {
      throw new AppHttpError(
        400,
        "EXT_ROOT_MISSING",
        "Arborescence [EXT] non provisionnée pour ce projet."
      );
    }

    const isGoogleWorkspaceDoc = Boolean(
      node.mimeType?.startsWith("application/vnd.google-apps.")
    );
    const now = new Date();

    let extMirrorFileId: string;
    let method: "files.update" | "files.copy" | "pdf_export_create";

    if (isGoogleWorkspaceDoc) {
      const pdfBytes = await drive.exportFile(
        node.driveFileId,
        "application/pdf"
      );
      const exportName = node.name.toLowerCase().endsWith(".pdf")
        ? node.name
        : `${node.name}.pdf`;

      if (node.extMirrorFileId) {
        const updated = await drive.updateFile({
          fileId: node.extMirrorFileId,
          name: exportName,
          mimeType: "application/pdf",
          body: pdfBytes,
        });
        extMirrorFileId = updated.id || node.extMirrorFileId;
        method = "files.update";
      } else {
        const created = await drive.createFile({
          parentId: extTargetFolderId,
          name: exportName,
          mimeType: "application/pdf",
          body: pdfBytes,
        });
        extMirrorFileId = created.id;
        method = "pdf_export_create";
      }
    } else if (node.extMirrorFileId) {
      const bytes = await drive.downloadFile(node.driveFileId);
      const updated = await drive.updateFile({
        fileId: node.extMirrorFileId,
        name: node.name,
        mimeType: node.mimeType ?? "application/octet-stream",
        body: bytes,
      });
      extMirrorFileId = updated.id || node.extMirrorFileId;
      method = "files.update";
    } else {
      const copied = await drive.copyFile({
        sourceFileId: node.driveFileId,
        destinationParentId: extTargetFolderId,
        name: node.name,
      });
      extMirrorFileId = copied.id;
      method = "files.copy";
    }

    await prisma.driveNode.update({
      where: { id: node.id },
      data: {
        extMirrorFileId,
        lastSyncedAt: now,
      },
    });

    await prisma.syncStatus.update({
      where: { id: node.syncStatus.id },
      data: {
        lastExtSyncAt: now,
        driftDetected: false,
      },
    });

    syncedNodes.push({
      nodeId: node.id,
      code: node.code,
      name: node.name,
      extMirrorFileId,
      method,
    });
  }

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "EXT_SYNC_COMPLETED",
      targetType: "DRIVE_MIRROR",
      targetId: project.driveExternalRootId ?? projectId,
      detailsJson: JSON.stringify({
        syncedCount: syncedNodes.length,
        skippedCount,
        syncedNodes,
      }),
    },
  });

  return {
    syncedCount: syncedNodes.length,
    skippedCount,
    syncedNodes,
  };
}

export async function exportRetroplanningOnce(
  prisma: PrismaClient,
  drive: DrivePort,
  projectId: string,
  params: { explicitManualExportConfirm: boolean }
): Promise<{
  exportedFileId: string;
  exportedFileName: string;
  destinationFolderId: string;
}> {
  if (params.explicitManualExportConfirm !== true) {
    throw new AppHttpError(
      400,
      "MANUAL_EXPORT_CONFIRM_REQUIRED",
      "Confirmation manuelle explicite requise (explicitManualExportConfirm: true) pour un export ponctuel du rétroplanning."
    );
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const retroNode = await prisma.driveNode.findFirst({
    where: {
      projectId,
      code: { in: ["002.1.sheet", "002.1"] },
      isFolder: false,
    },
  });
  const sourceSheetId = retroNode?.driveFileId ?? project.retroplanningSheetId;
  if (!sourceSheetId) {
    throw new AppHttpError(
      400,
      "RETROPLANNING_SHEET_MISSING",
      "Aucun Rétroplanning Actif (002.1) trouvé pour ce projet."
    );
  }

  const ext01Node = await prisma.driveNode.findFirst({
    where: { projectId, code: "EXT.01" },
  });
  const destinationFolderId =
    ext01Node?.driveFileId ?? project.driveExternalRootId;
  if (!destinationFolderId) {
    throw new AppHttpError(
      400,
      "EXT_FOLDER_MISSING",
      "Le dossier [EXT]/01. Rétroplanning & CR est introuvable."
    );
  }

  const pdfBytes = await drive.exportFile(sourceSheetId, "application/pdf");
  const dateStr = new Date().toISOString().slice(0, 10);
  const exportedFileName = `${dateStr}_Export_Ponctuel_Retroplanning.pdf`;

  const created = await drive.createFile({
    parentId: destinationFolderId,
    name: exportedFileName,
    mimeType: "application/pdf",
    body: pdfBytes,
  });

  // Ensure 002.1 nodes remain permanently locked and NEVER receive extMirrorFileId
  await prisma.syncStatus.updateMany({
    where: {
      projectId,
      driveNode: { code: { startsWith: "002.1" } },
    },
    data: {
      allowPermanentExtSync: false,
      driftDetected: false,
    },
  });

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "RETROPLANNING_ONE_OFF_EXPORT",
      targetType: "DRIVE_FILE",
      targetId: created.id,
      detailsJson: JSON.stringify({
        exportedFileName,
        destinationFolderId,
        permanentSyncEnabled: false,
      }),
    },
  });

  return {
    exportedFileId: created.id,
    exportedFileName,
    destinationFolderId,
  };
}
