import type { PrismaClient } from "@prisma/client";
import { getGeminiClient, getGoogleGateway } from "@/lib/container";
import { createRetroSnapshot } from "@/lib/retroplanning/snapshot-service";
import { runRetroVeille } from "@/lib/retroplanning/veille-service";

export interface RetroVeilleJobResult {
  processedProjects: number;
  proposalsCreated: number;
  blockedConflicts: number;
  errors: Array<{ projectId: string; error: string }>;
}

export async function runRetroVeilleJob(
  prisma: PrismaClient,
  projectId?: string
): Promise<RetroVeilleJobResult> {
  const projects = projectId
    ? await prisma.project.findMany({ where: { id: projectId } })
    : await prisma.project.findMany({ orderBy: { createdAt: "asc" } });

  const gemini = await getGeminiClient(prisma);
  let processedProjects = 0;
  let proposalsCreated = 0;
  let blockedConflicts = 0;
  const errors: Array<{ projectId: string; error: string }> = [];

  for (const project of projects) {
    try {
      const gateway = await getGoogleGateway(project.id, prisma);
      const res = await runRetroVeille(
        prisma,
        gateway,
        gemini,
        project.id,
        { includeDrive: true },
        "scheduler:retro-veille"
      );
      processedProjects++;
      proposalsCreated += res.proposals.length;
      blockedConflicts += res.blockedConflicts.length;
    } catch (err) {
      errors.push({
        projectId: project.id,
        error: err instanceof Error ? err.message : "Erreur veille inconnue",
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      projectId: projectId ?? null,
      actor: "scheduler:retro-veille",
      action: "RETRO_VEILLE_JOB_RUN",
      targetType: "SCHEDULER_JOB",
      targetId: projectId ?? "ALL",
      detailsJson: JSON.stringify({
        processedProjects,
        proposalsCreated,
        blockedConflicts,
        errors,
      }),
    },
  });

  return {
    processedProjects,
    proposalsCreated,
    blockedConflicts,
    errors,
  };
}

export interface RetroSnapshot14dJobResult {
  checkedProjects: number;
  createdCount: number;
  skippedCount: number;
  snapshotIds: string[];
  errors: Array<{ projectId: string; error: string }>;
}

export async function runRetroSnapshot14dJob(
  prisma: PrismaClient,
  projectId?: string
): Promise<RetroSnapshot14dJobResult> {
  const projects = projectId
    ? await prisma.project.findMany({ where: { id: projectId } })
    : await prisma.project.findMany({ orderBy: { createdAt: "asc" } });

  let checkedProjects = 0;
  let createdCount = 0;
  let skippedCount = 0;
  const snapshotIds: string[] = [];
  const errors: Array<{ projectId: string; error: string }> = [];

  for (const project of projects) {
    checkedProjects++;
    try {
      const res = await createRetroSnapshot(
        prisma,
        project.id,
        () => getGoogleGateway(project.id, prisma),
        {
          mode: "AUTO_14D",
          actor: "scheduler:retro-snapshot-14d",
        }
      );
      if (res.skipped) {
        skippedCount++;
      } else {
        createdCount++;
        snapshotIds.push(res.snapshot.id);
      }
    } catch (err) {
      errors.push({
        projectId: project.id,
        error: err instanceof Error ? err.message : "Erreur snapshot 14j",
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      projectId: projectId ?? null,
      actor: "scheduler:retro-snapshot-14d",
      action: "RETRO_SNAPSHOT_14D_JOB_RUN",
      targetType: "SCHEDULER_JOB",
      targetId: projectId ?? "ALL",
      detailsJson: JSON.stringify({
        checkedProjects,
        createdCount,
        skippedCount,
        snapshotIds,
        errors,
      }),
    },
  });

  return {
    checkedProjects,
    createdCount,
    skippedCount,
    snapshotIds,
    errors,
  };
}
