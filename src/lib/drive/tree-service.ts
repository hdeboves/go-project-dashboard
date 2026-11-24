import type { DriveNode, PrismaClient, Project } from "@prisma/client";
import {
  EXTERNAL_MIRROR_TREE,
  INTERNAL_FOLDER_TREE,
  getSyncPolicy,
  isRetroplanningNodeCode,
} from "@/lib/drive/sync-policy";
import { AppHttpError } from "@/lib/errors";
import { APRES_VENTE_FOLDER_ID } from "@/lib/google/sandbox-guard";
import { assertNoCpConflict } from "@/lib/isolation/cp-guard";
import type { DriveFileRecord, DrivePort } from "@/lib/ports";

export const PILOT_SANDBOX_CONFIG = {
  codeProjet: "326027",
  client: "Caisse d'Épargne",
  nomJeu: "Fortnite",
  internalRootName: "[PILOTE - 326027] Caisse d'Épargne - Fortnite",
  externalRootName: "[EXT - PILOTE 326027] Caisse d'Épargne - Fortnite",
  prodTemplates: {
    budgetSheetId: "1QUSOShHJmAlch3kP5F0RIf5txwyQ7Y6wf20A0jgCtMw",
    retroplanningSheetId: "1ZG9mRIyDYDqTzJIGjGtJ4-ridgl6Cm2hqb75m1ba9XQ",
    reportingSheetId: "1C136EAzwoOUJI1DypSzBjr-vO6riZk3ncRKbI_9XAY0",
    weeklyTemplateSlidesId: "1HWSWvNiTRxINZwsPHIHAa8SvhgwpP9euh3L-h1XCMrE",
    reportingTemplateSlidesId: "1969-5uTXrKOlfOnEcYDfANfvl4trkn9wQNVPFJEckRU",
  },
} as const;

export function slugifySegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

function buildRootNames(project: {
  codeProjet: string;
  client: string;
  nomJeu: string;
  isSandbox: boolean;
}): { internalRootName: string; externalRootName: string } {
  if (project.isSandbox) {
    return {
      internalRootName: `[PILOTE - ${project.codeProjet}] ${project.client} - ${project.nomJeu}`,
      externalRootName: `[EXT - PILOTE ${project.codeProjet}] ${project.client} - ${project.nomJeu}`,
    };
  }
  return {
    internalRootName: `[${project.codeProjet}] ${project.client} - ${project.nomJeu}`,
    externalRootName: `[EXT - ${project.codeProjet}] ${project.client} - ${project.nomJeu}`,
  };
}

async function upsertDriveNodeWithPolicy(
  prisma: PrismaClient,
  params: {
    projectId: string;
    code: string;
    name: string;
    driveFileId: string;
    parentNodeId: string | null;
    isFolder: boolean;
    mimeType: string;
  }
): Promise<DriveNode> {
  const policy = getSyncPolicy(params.code);
  const isExtCode = params.code.startsWith("EXT.");
  const isExtEligible = isExtCode ? false : policy.isExtEligible;
  const allowPermanentExtSync =
    isExtCode || isRetroplanningNodeCode(params.code)
      ? false
      : policy.allowPermanentExtSync;

  const existing = await prisma.driveNode.findFirst({
    where: { projectId: params.projectId, code: params.code },
  });

  const node = existing
    ? await prisma.driveNode.update({
        where: { id: existing.id },
        data: {
          name: params.name,
          driveFileId: params.driveFileId,
          parentNodeId: params.parentNodeId,
          isFolder: params.isFolder,
          mimeType: params.mimeType,
          isExtEligible,
        },
      })
    : await prisma.driveNode.create({
        data: {
          projectId: params.projectId,
          code: params.code,
          name: params.name,
          driveFileId: params.driveFileId,
          parentNodeId: params.parentNodeId,
          isFolder: params.isFolder,
          mimeType: params.mimeType,
          isExtEligible,
        },
      });

  await prisma.syncStatus.upsert({
    where: { driveNodeId: node.id },
    update: {
      // Never allow permanent sync on 002.1 or INTERNAL_ONLY
      ...(allowPermanentExtSync ? {} : { allowPermanentExtSync: false }),
    },
    create: {
      projectId: params.projectId,
      driveNodeId: node.id,
      validationStatus: "BROUILLON_INTERNE",
      driftDetected: false,
      allowPermanentExtSync,
    },
  });

  return node;
}

async function ensureFolderInParent(
  drive: DrivePort,
  parentDriveId: string,
  childrenCache: Map<string, DriveFileRecord[]>,
  folderName: string
): Promise<DriveFileRecord> {
  let siblings = childrenCache.get(parentDriveId);
  if (!siblings) {
    siblings = await drive.listChildren(parentDriveId);
    childrenCache.set(parentDriveId, siblings);
  }

  const found = siblings.find(
    (f) =>
      f.name === folderName &&
      f.mimeType === "application/vnd.google-apps.folder" &&
      !f.trashed
  );
  if (found) return found;

  const created = await drive.createFolder({
    name: folderName,
    parentId: parentDriveId,
  });
  siblings.push(created);
  return created;
}

export async function provisionProjectTree(
  prisma: PrismaClient,
  drive: DrivePort,
  projectId: string
): Promise<{
  project: Project;
  internalNodesCount: number;
  externalNodesCount: number;
}> {
  let project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const { internalRootName, externalRootName } = buildRootNames(project);

  let internalRootId = project.driveInternalRootId;
  let externalRootId = project.driveExternalRootId;

  if (!internalRootId) {
    const internalRoot = await drive.bootstrapSandboxRootFolder({
      parentId: APRES_VENTE_FOLDER_ID,
      name: internalRootName,
    });
    internalRootId = internalRoot.id;
  }

  if (!externalRootId) {
    const externalRoot = await drive.bootstrapSandboxRootFolder({
      parentId: APRES_VENTE_FOLDER_ID,
      name: externalRootName,
    });
    externalRootId = externalRoot.id;
  }

  if (
    internalRootId !== project.driveInternalRootId ||
    externalRootId !== project.driveExternalRootId
  ) {
    project = await prisma.project.update({
      where: { id: project.id },
      data: {
        driveInternalRootId: internalRootId,
        driveExternalRootId: externalRootId,
      },
    });
  }

  const childrenCache = new Map<string, DriveFileRecord[]>();
  const codeToNode = new Map<string, DriveNode>();

  // Provision 61 internal folders wave-by-wave (depth 0..3)
  let remainingInternal = [...INTERNAL_FOLDER_TREE];
  while (remainingInternal.length > 0) {
    const ready = remainingInternal.filter(
      (f) => f.parentCode === null || codeToNode.has(f.parentCode)
    );
    if (ready.length === 0) {
      throw new Error("Invalid INTERNAL_FOLDER_TREE parent graph.");
    }

    const waveResults = await Promise.all(
      ready.map(async (entry) => {
        const parentNode = entry.parentCode
          ? codeToNode.get(entry.parentCode)!
          : null;
        const parentDriveId = parentNode?.driveFileId ?? internalRootId!;
        const folder = await ensureFolderInParent(
          drive,
          parentDriveId,
          childrenCache,
          entry.name
        );
        const dbNode = await upsertDriveNodeWithPolicy(prisma, {
          projectId: project.id,
          code: entry.code,
          name: entry.name,
          driveFileId: folder.id,
          parentNodeId: parentNode?.id ?? null,
          isFolder: true,
          mimeType: "application/vnd.google-apps.folder",
        });
        return { code: entry.code, node: dbNode };
      })
    );

    for (const item of waveResults) {
      codeToNode.set(item.code, item.node);
    }

    const doneSet = new Set(ready.map((r) => r.code));
    remainingInternal = remainingInternal.filter((f) => !doneSet.has(f.code));
  }

  // Provision 8 [EXT] mirror folders wave-by-wave
  const extCodeToNode = new Map<string, DriveNode>();
  let remainingExt = [...EXTERNAL_MIRROR_TREE];
  while (remainingExt.length > 0) {
    const ready = remainingExt.filter(
      (f) => f.parentCode === null || extCodeToNode.has(f.parentCode)
    );
    if (ready.length === 0) {
      throw new Error("Invalid EXTERNAL_MIRROR_TREE parent graph.");
    }

    const waveResults = await Promise.all(
      ready.map(async (entry) => {
        const parentNode = entry.parentCode
          ? extCodeToNode.get(entry.parentCode)!
          : null;
        const parentDriveId = parentNode?.driveFileId ?? externalRootId!;
        const folder = await ensureFolderInParent(
          drive,
          parentDriveId,
          childrenCache,
          entry.name
        );
        const dbNode = await upsertDriveNodeWithPolicy(prisma, {
          projectId: project.id,
          code: entry.code,
          name: entry.name,
          driveFileId: folder.id,
          parentNodeId: parentNode?.id ?? null,
          isFolder: true,
          mimeType: "application/vnd.google-apps.folder",
        });
        return { code: entry.code, node: dbNode };
      })
    );

    for (const item of waveResults) {
      extCodeToNode.set(item.code, item.node);
    }

    const doneSet = new Set(ready.map((r) => r.code));
    remainingExt = remainingExt.filter((f) => !doneSet.has(f.code));
  }

  return {
    project,
    internalNodesCount: codeToNode.size,
    externalNodesCount: extCodeToNode.size,
  };
}

export async function bootstrapPilotSandbox(
  prisma: PrismaClient,
  drive: DrivePort
): Promise<{
  project: Project;
  internalNodesCount: number;
  externalNodesCount: number;
}> {
  let project = await prisma.project.findUnique({
    where: {
      codeProjet_client_nomJeu: {
        codeProjet: PILOT_SANDBOX_CONFIG.codeProjet,
        client: PILOT_SANDBOX_CONFIG.client,
        nomJeu: PILOT_SANDBOX_CONFIG.nomJeu,
      },
    },
  });

  const internalRoot = await drive.bootstrapSandboxRootFolder({
    parentId: APRES_VENTE_FOLDER_ID,
    name: PILOT_SANDBOX_CONFIG.internalRootName,
  });
  const externalRoot = await drive.bootstrapSandboxRootFolder({
    parentId: APRES_VENTE_FOLDER_ID,
    name: PILOT_SANDBOX_CONFIG.externalRootName,
  });

  if (!project) {
    project = await prisma.project.create({
      data: {
        codeProjet: PILOT_SANDBOX_CONFIG.codeProjet,
        client: PILOT_SANDBOX_CONFIG.client,
        nomJeu: PILOT_SANDBOX_CONFIG.nomJeu,
        isSandbox: true,
        driveInternalRootId: internalRoot.id,
        driveExternalRootId: externalRoot.id,
      },
    });
  } else {
    project = await prisma.project.update({
      where: { id: project.id },
      data: {
        isSandbox: true,
        driveInternalRootId: project.driveInternalRootId ?? internalRoot.id,
        driveExternalRootId: project.driveExternalRootId ?? externalRoot.id,
      },
    });
  }

  const treeResult = await provisionProjectTree(prisma, drive, project.id);
  project = treeResult.project;

  // Copy PROD reference templates INTO sandbox folders (never modifying PROD)
  const templateMappings: Array<{
    field:
      | "budgetSheetId"
      | "retroplanningSheetId"
      | "reportingSheetId"
      | "weeklyTemplateSlidesId"
      | "reportingTemplateSlidesId";
    sourceFileId: string;
    folderCode: string;
    fileCode: string;
    copyName: string;
    mimeType: string;
  }> = [
    {
      field: "budgetSheetId",
      sourceFileId: PILOT_SANDBOX_CONFIG.prodTemplates.budgetSheetId,
      folderCode: "001.1",
      fileCode: "001.1.budget",
      copyName: "[PILOTE 326027] Budget : CE - Fortnite",
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
    {
      field: "retroplanningSheetId",
      sourceFileId: PILOT_SANDBOX_CONFIG.prodTemplates.retroplanningSheetId,
      folderCode: "002.1",
      fileCode: "002.1.sheet",
      copyName: "[PILOTE 326027] RETROPLANNING CAISSE EPARGNE",
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
    {
      field: "reportingSheetId",
      sourceFileId: PILOT_SANDBOX_CONFIG.prodTemplates.reportingSheetId,
      folderCode: "006.2",
      fileCode: "006.2.sheet",
      copyName: "[PILOTE 326027] Reporting Caisse d'Epargne",
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
    {
      field: "weeklyTemplateSlidesId",
      sourceFileId: PILOT_SANDBOX_CONFIG.prodTemplates.weeklyTemplateSlidesId,
      folderCode: "003.2",
      fileCode: "003.2.template",
      copyName: "[PILOTE 326027] Template Weekly - Caisse d'Épargne",
      mimeType: "application/vnd.google-apps.presentation",
    },
    {
      field: "reportingTemplateSlidesId",
      sourceFileId:
        PILOT_SANDBOX_CONFIG.prodTemplates.reportingTemplateSlidesId,
      folderCode: "006.3",
      fileCode: "006.3.slides",
      copyName: "[PILOTE 326027] Reporting - Caisse d'Epargne",
      mimeType: "application/vnd.google-apps.presentation",
    },
  ];

  const projectUpdates: Partial<Project> = {};

  for (const mapping of templateMappings) {
    if (project[mapping.field]) {
      continue;
    }

    const parentFolderNode = await prisma.driveNode.findFirst({
      where: { projectId: project.id, code: mapping.folderCode },
    });
    if (!parentFolderNode?.driveFileId) {
      continue;
    }

    const existingChildren = await drive.listChildren(
      parentFolderNode.driveFileId
    );
    const existingCopy = existingChildren.find(
      (f) => f.name === mapping.copyName && !f.trashed
    );
    const copied =
      existingCopy ??
      (await drive.copyFile({
        sourceFileId: mapping.sourceFileId,
        destinationParentId: parentFolderNode.driveFileId,
        name: mapping.copyName,
      }));

    projectUpdates[mapping.field] = copied.id;

    await upsertDriveNodeWithPolicy(prisma, {
      projectId: project.id,
      code: mapping.fileCode,
      name: mapping.copyName,
      driveFileId: copied.id,
      parentNodeId: parentFolderNode.id,
      isFolder: false,
      mimeType: mapping.mimeType,
    });
  }

  if (Object.keys(projectUpdates).length > 0) {
    project = await prisma.project.update({
      where: { id: project.id },
      data: projectUpdates,
    });
  }

  await prisma.auditLog.create({
    data: {
      projectId: project.id,
      actor: "user:bootstrap",
      action: "SANDBOX_BOOTSTRAPPED",
      targetType: "PROJECT",
      targetId: project.id,
      detailsJson: JSON.stringify({
        codeProjet: project.codeProjet,
        driveInternalRootId: project.driveInternalRootId,
        driveExternalRootId: project.driveExternalRootId,
        internalNodesCount: treeResult.internalNodesCount,
        externalNodesCount: treeResult.externalNodesCount,
      }),
    },
  });

  return {
    project,
    internalNodesCount: treeResult.internalNodesCount,
    externalNodesCount: treeResult.externalNodesCount,
  };
}

export async function provisionTalentFolders(
  prisma: PrismaClient,
  drive: DrivePort,
  projectId: string,
  talentNameRaw: string
): Promise<{
  talentName: string;
  slug: string;
  createdNodes: DriveNode[];
}> {
  const talentName = talentNameRaw.trim();
  if (!talentName) {
    throw new AppHttpError(
      400,
      "INVALID_TALENT_NAME",
      "Le nom du talent ne peut pas être vide."
    );
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  // Zero-mix CP check on talent name
  assertNoCpConflict(project.codeProjet, null, talentName);

  let talentsParent = await prisma.driveNode.findFirst({
    where: { projectId, code: "004.3.2" },
  });
  let influenceParent = await prisma.driveNode.findFirst({
    where: { projectId, code: "006.1.2" },
  });

  if (!talentsParent?.driveFileId || !influenceParent?.driveFileId) {
    await provisionProjectTree(prisma, drive, projectId);
    talentsParent = await prisma.driveNode.findFirst({
      where: { projectId, code: "004.3.2" },
    });
    influenceParent = await prisma.driveNode.findFirst({
      where: { projectId, code: "006.1.2" },
    });
  }

  if (!talentsParent?.driveFileId || !influenceParent?.driveFileId) {
    throw new AppHttpError(
      500,
      "DRIVE_PARENTS_MISSING",
      "Dossiers parents 004.3.2 ou 006.1.2 introuvables."
    );
  }

  const slug = slugifySegment(talentName);
  const childrenCache = new Map<string, DriveFileRecord[]>();
  const createdNodes: DriveNode[] = [];

  // 1. 004.3.2 -> <Talent> -> Script, Trame, Vidéo, Validations (SYNCABLE_ON_VALIDATION)
  const talentProdFolder = await ensureFolderInParent(
    drive,
    talentsParent.driveFileId,
    childrenCache,
    talentName
  );
  const talentProdNode = await upsertDriveNodeWithPolicy(prisma, {
    projectId,
    code: `004.3.2.${slug}`,
    name: talentName,
    driveFileId: talentProdFolder.id,
    parentNodeId: talentsParent.id,
    isFolder: true,
    mimeType: "application/vnd.google-apps.folder",
  });
  createdNodes.push(talentProdNode);

  const prodSubfolders = ["Script", "Trame", "Vidéo", "Validations"];
  const prodSubNodes = await Promise.all(
    prodSubfolders.map(async (subName) => {
      const subFolder = await ensureFolderInParent(
        drive,
        talentProdFolder.id,
        childrenCache,
        subName
      );
      return upsertDriveNodeWithPolicy(prisma, {
        projectId,
        code: `004.3.2.${slug}.${slugifySegment(subName)}`,
        name: subName,
        driveFileId: subFolder.id,
        parentNodeId: talentProdNode.id,
        isFolder: true,
        mimeType: "application/vnd.google-apps.folder",
      });
    })
  );
  createdNodes.push(...prodSubNodes);

  // 2. 006.1.2 -> <Talent> -> TikTok, YouTube Shorts, Instagram, Snapchat (INTERNAL_ONLY)
  const talentRawFolder = await ensureFolderInParent(
    drive,
    influenceParent.driveFileId,
    childrenCache,
    talentName
  );
  const talentRawNode = await upsertDriveNodeWithPolicy(prisma, {
    projectId,
    code: `006.1.2.${slug}`,
    name: talentName,
    driveFileId: talentRawFolder.id,
    parentNodeId: influenceParent.id,
    isFolder: true,
    mimeType: "application/vnd.google-apps.folder",
  });
  createdNodes.push(talentRawNode);

  const networkFolders = ["TikTok", "YouTube Shorts", "Instagram", "Snapchat"];
  const networkSubNodes = await Promise.all(
    networkFolders.map(async (netName) => {
      const subFolder = await ensureFolderInParent(
        drive,
        talentRawFolder.id,
        childrenCache,
        netName
      );
      return upsertDriveNodeWithPolicy(prisma, {
        projectId,
        code: `006.1.2.${slug}.${slugifySegment(netName)}`,
        name: netName,
        driveFileId: subFolder.id,
        parentNodeId: talentRawNode.id,
        isFolder: true,
        mimeType: "application/vnd.google-apps.folder",
      });
    })
  );
  createdNodes.push(...networkSubNodes);

  // Persist talent list on Project
  let existingTalents: string[] = [];
  try {
    const parsed = JSON.parse(project.talentsJson || "[]");
    if (Array.isArray(parsed)) {
      existingTalents = parsed.filter((t): t is string => typeof t === "string");
    }
  } catch {
    existingTalents = [];
  }
  if (!existingTalents.includes(talentName)) {
    existingTalents.push(talentName);
    await prisma.project.update({
      where: { id: projectId },
      data: { talentsJson: JSON.stringify(existingTalents) },
    });
  }

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "TALENT_PROVISIONED",
      targetType: "PROJECT_TALENT",
      targetId: talentName,
      detailsJson: JSON.stringify({
        talentName,
        slug,
        nodesCreated: createdNodes.length,
      }),
    },
  });

  return { talentName, slug, createdNodes };
}
