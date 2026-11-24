import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { getGoogleGateway } from "@/lib/container";
import { provisionProjectTree } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import {
  SandboxViolationError,
  isSandboxModeEnabled,
} from "@/lib/google/sandbox-guard";
import { normalizeCp } from "@/lib/isolation/cp-guard";
import { prisma } from "@/lib/prisma";

const CreateProjectSchema = z.object({
  codeProjet: z.string().min(2),
  client: z.string().min(1),
  nomJeu: z.string().min(1),
  isSandbox: z.boolean().optional(),
  provisionDrive: z.boolean().optional(),
});

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      orderBy: [{ isSandbox: "desc" }, { createdAt: "desc" }],
      include: {
        _count: {
          select: {
            driveNodes: true,
            invoices: true,
            retroTasks: true,
            auditLogs: true,
          },
        },
        syncStatuses: {
          where: { driftDetected: true },
          select: { id: true },
        },
        invoices: {
          where: { cpConflict: true, status: "CONFLICT_BLOCKED" },
          select: { id: true },
        },
      },
    });

    const formatted = projects.map((p) => ({
      ...p,
      driftCount: p.syncStatuses.length,
      cpConflictCount: p.invoices.length,
    }));

    return NextResponse.json({ projects: formatted });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = CreateProjectSchema.parse(await req.json());
    const codeProjet = normalizeCp(body.codeProjet) ?? body.codeProjet.trim();
    const client = body.client.trim();
    const nomJeu = body.nomJeu.trim();
    const isSandbox = body.isSandbox ?? true;

    const duplicate = await prisma.project.findUnique({
      where: {
        codeProjet_client_nomJeu: {
          codeProjet,
          client,
          nomJeu,
        },
      },
    });

    if (duplicate) {
      throw new AppHttpError(
        409,
        "PROJECT_ALREADY_EXISTS",
        `Le projet (${codeProjet}, ${client}, ${nomJeu}) existe déjà.`
      );
    }

    if (body.provisionDrive && isSandboxModeEnabled() && !isSandbox) {
      throw new SandboxViolationError({
        operation: "projects.create",
        targetId: codeProjet,
        reason:
          "Le mode bac à sable strict est actif : impossible de provisionner un projet avec isSandbox: false.",
      });
    }

    // Verify Google OAuth2 BEFORE creating DB row if Drive provisioning is requested
    let gateway: Awaited<ReturnType<typeof getGoogleGateway>> | null = null;
    if (body.provisionDrive) {
      gateway = await getGoogleGateway();
    }

    const project = await prisma.project.create({
      data: {
        codeProjet,
        client,
        nomJeu,
        isSandbox,
      },
    });

    let provisioningResult: {
      internalNodesCount: number;
      externalNodesCount: number;
    } | null = null;

    if (gateway) {
      try {
        const tree = await provisionProjectTree(prisma, gateway.drive, project.id);
        provisioningResult = {
          internalNodesCount: tree.internalNodesCount,
          externalNodesCount: tree.externalNodesCount,
        };
      } catch (err) {
        await prisma.project
          .delete({ where: { id: project.id } })
          .catch(() => undefined);
        throw err;
      }
    }

    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: "user",
        action: "PROJECT_CREATED",
        targetType: "PROJECT",
        targetId: project.id,
        detailsJson: JSON.stringify({
          codeProjet,
          client,
          nomJeu,
          isSandbox,
          provisionDrive: Boolean(body.provisionDrive),
        }),
      },
    });

    const refreshed = await prisma.project.findUnique({
      where: { id: project.id },
    });

    return NextResponse.json(
      {
        project: refreshed ?? project,
        provisioning: provisioningResult,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
