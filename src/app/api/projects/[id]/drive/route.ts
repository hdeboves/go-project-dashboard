import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { getGoogleGateway } from "@/lib/container";
import { getSyncPolicy, isRetroplanningNodeCode } from "@/lib/drive/sync-policy";
import { refreshProjectDriveDrift } from "@/lib/drive/sync-service";
import { provisionProjectTree } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    if (refresh) {
      const gateway = await getGoogleGateway(id);
      await refreshProjectDriveDrift(prisma, gateway.drive, id);
    }

    const nodes = await prisma.driveNode.findMany({
      where: { projectId: id },
      include: { syncStatus: true },
      orderBy: [{ code: "asc" }, { name: "asc" }],
    });

    const enriched = nodes.map((node) => {
      const policy = getSyncPolicy(node.code);
      return {
        ...node,
        policy,
        isRetroplanningLocked: isRetroplanningNodeCode(node.code),
      };
    });

    const driftCount = enriched.filter(
      (n) => !n.isRetroplanningLocked && n.syncStatus?.driftDetected
    ).length;

    return NextResponse.json({
      project,
      nodes: enriched,
      driftCount,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const gateway = await getGoogleGateway(id);
    const result = await provisionProjectTree(prisma, gateway.drive, id);

    await prisma.auditLog.create({
      data: {
        projectId: id,
        actor: "user",
        action: "DRIVE_TREE_PROVISIONED",
        targetType: "PROJECT",
        targetId: id,
        detailsJson: JSON.stringify({
          internalNodesCount: result.internalNodesCount,
          externalNodesCount: result.externalNodesCount,
        }),
      },
    });

    return NextResponse.json({
      ok: true,
      project: result.project,
      internalNodesCount: result.internalNodesCount,
      externalNodesCount: result.externalNodesCount,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
