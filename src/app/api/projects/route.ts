import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  buildVisibleProjectsWhere,
  getCurrentUser,
  toPublicUser,
} from "@/lib/auth/session";
import { getGoogleGateway } from "@/lib/container";
import { provisionProjectTree } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import {
  SandboxViolationError,
  isSandboxModeEnabled,
} from "@/lib/google/sandbox-guard";
import { normalizeCp } from "@/lib/isolation/cp-guard";
import { prisma } from "@/lib/prisma";
import {
  normalizeProjectCategory,
  seedBlankBudgetForProject,
  seedBlankRetroForProject,
} from "@/lib/templates/project-templates";

const CreateProjectSchema = z.object({
  codeProjet: z.string().min(2),
  client: z.string().min(1),
  nomJeu: z.string().min(1),
  category: z.enum(["JEU", "YOUTUBE", "EVENEMENT", "SPONSOR"]).optional(),
  isSandbox: z.boolean().optional(),
  provisionDrive: z.boolean().optional(),
  seedBlankTemplates: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser(prisma);
    const includeAll =
      req.nextUrl.searchParams.get("scope") === "all" &&
      currentUser?.role === "ADMIN";
    const whereClause = buildVisibleProjectsWhere(currentUser, {
      includeAllForAdmin: includeAll,
    });

    const projects = await prisma.project.findMany({
      where: whereClause,
      orderBy: [{ isSandbox: "desc" }, { createdAt: "desc" }],
      include: {
        owner: true,
        members: {
          include: { user: true },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: {
            driveNodes: true,
            invoices: true,
            retroTasks: true,
            auditLogs: true,
            meetingNotes: true,
          },
        },
        syncStatuses: {
          where: { driftDetected: true },
          select: { id: true },
        },
        invoices: {
          select: {
            id: true,
            status: true,
            cpConflict: true,
          },
        },
        budgetLines: {
          select: {
            saleTotalHt: true,
            preOpTotalHt: true,
            postOpTotalHt: true,
          },
        },
        retroTasks: {
          select: {
            id: true,
            tache: true,
            status: true,
            endDate: true,
            isMilestone: true,
          },
        },
        meetingNotes: {
          orderBy: { meetingDate: "desc" },
          take: 1,
          select: {
            id: true,
            title: true,
            meetingDate: true,
          },
        },
      },
    });

    const now = new Date();
    const formatted = projects.map((p) => {
      const cpConflictCount = p.invoices.filter(
        (i) => i.cpConflict && i.status === "CONFLICT_BLOCKED"
      ).length;
      const pendingInvoicesCount = p.invoices.filter(
        (i) => i.status === "PENDING_VALIDATION"
      ).length;

      const totalSoldHt = p.budgetLines.reduce(
        (acc, l) => acc + (l.saleTotalHt || 0),
        0
      );
      const totalPreOpHt = p.budgetLines.reduce(
        (acc, l) => acc + (l.preOpTotalHt || 0),
        0
      );
      const totalActualHt = p.budgetLines.reduce(
        (acc, l) => acc + (l.postOpTotalHt || 0),
        0
      );
      const forecastCostHt = p.budgetLines.reduce(
        (acc, l) => acc + Math.max(l.preOpTotalHt || 0, l.postOpTotalHt || 0),
        0
      );
      const budgetBase = totalPreOpHt > 0 ? totalPreOpHt : totalSoldHt;
      const consumedPct =
        budgetBase > 0 ? Math.round((totalActualHt / budgetBase) * 100) : 0;
      const marginHt = totalSoldHt - totalActualHt;
      const marginPct =
        totalSoldHt > 0 ? Math.round((marginHt / totalSoldHt) * 100) : 0;
      const forecastMarginHt = totalSoldHt - forecastCostHt;
      const forecastMarginPct =
        totalSoldHt > 0 ? Math.round((forecastMarginHt / totalSoldHt) * 100) : 0;
      const budgetAlertCount = p.budgetLines.filter(
        (l) =>
          (l.preOpTotalHt > 0 && l.postOpTotalHt > l.preOpTotalHt) ||
          (l.preOpTotalHt > 0 &&
            l.postOpTotalHt < l.preOpTotalHt &&
            l.postOpTotalHt / l.preOpTotalHt >= 0.9) ||
          (l.preOpTotalHt === 0 && l.postOpTotalHt > 0)
      ).length;
      const budgetOverrunCount = p.budgetLines.filter(
        (l) => l.postOpTotalHt > l.preOpTotalHt
      ).length;

      const totalTasks = p.retroTasks.length;
      const doneTasks = p.retroTasks.filter((t) => t.status === "TERMINE").length;
      const lateTasks = p.retroTasks.filter(
        (t) =>
          t.status !== "TERMINE" &&
          t.endDate !== null &&
          new Date(t.endDate) < now
      ).length;
      const progressPct =
        totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

      const upcomingTasks = p.retroTasks
        .filter((t) => t.status !== "TERMINE" && t.endDate !== null)
        .sort(
          (a, b) =>
            new Date(a.endDate!).getTime() - new Date(b.endDate!).getTime()
        );
      const nextMilestoneRow =
        upcomingTasks.find((t) => t.isMilestone) ?? upcomingTasks[0] ?? null;

      const healthReasons: string[] = [];
      if (cpConflictCount > 0) {
        healthReasons.push(`${cpConflictCount} facture(s) en conflit CP`);
      }
      if (consumedPct > 100 || budgetOverrunCount > 0) {
        healthReasons.push(
          budgetOverrunCount > 0
            ? `${budgetOverrunCount} poste(s) en dépassement`
            : `Budget dépassé (${consumedPct}%)`
        );
      } else if (consumedPct >= 90 && consumedPct < 100) {
        healthReasons.push(`Budget à ${consumedPct}% (seuil 90%)`);
      }
      if (budgetAlertCount > budgetOverrunCount) {
        healthReasons.push(
          `${budgetAlertCount - budgetOverrunCount} poste(s) ≥ 90%`
        );
      }
      if (lateTasks > 0) {
        healthReasons.push(`${lateTasks} tâche(s) en retard`);
      }
      if (pendingInvoicesCount > 0) {
        healthReasons.push(`${pendingInvoicesCount} facture(s) à valider`);
      }

      let health: "SAIN" | "VIGILANCE" | "CRITIQUE" = "SAIN";
      if (cpConflictCount > 0 || consumedPct > 100 || lateTasks >= 3) {
        health = "CRITIQUE";
      } else if (
        (consumedPct >= 90 && consumedPct < 100) ||
        budgetAlertCount > 0 ||
        lateTasks > 0 ||
        pendingInvoicesCount > 0
      ) {
        health = "VIGILANCE";
      }

      const lastMeeting = p.meetingNotes[0] ?? null;

      const myMembership = currentUser
        ? p.members.find((m) => m.userId === currentUser.id)
        : undefined;
      const accessRole = !currentUser
        ? "OWNER"
        : p.ownerId === currentUser.id
          ? "OWNER"
          : myMembership?.role ?? (p.ownerId === null ? "LEGACY" : "VIEWER");

      return {
        id: p.id,
        codeProjet: p.codeProjet,
        client: p.client,
        nomJeu: p.nomJeu,
        category: normalizeProjectCategory(p.category),
        ownerId: p.ownerId,
        owner: p.owner ? toPublicUser(p.owner) : null,
        members: p.members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          user: toPublicUser(m.user),
        })),
        accessRole,
        isSandbox: p.isSandbox,
        driveInternalRootId: p.driveInternalRootId,
        driveExternalRootId: p.driveExternalRootId,
        budgetSheetId: p.budgetSheetId,
        retroplanningSheetId: p.retroplanningSheetId,
        reportingSheetId: p.reportingSheetId,
        talentsJson: p.talentsJson,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        _count: p._count,
        driftCount: p.syncStatuses.length,
        cpConflictCount,
        pendingInvoicesCount,
        health,
        healthReasons,
        budget: {
          totalSoldHt,
          totalPreOpHt,
          totalActualHt,
          consumedPct,
          marginHt,
          marginPct,
          forecastCostHt,
          forecastMarginHt,
          forecastMarginPct,
          budgetAlertCount,
        },
        tasks: {
          total: totalTasks,
          done: doneTasks,
          late: lateTasks,
          progressPct,
          nextMilestone: nextMilestoneRow
            ? {
                title: nextMilestoneRow.tache,
                date: nextMilestoneRow.endDate!.toISOString(),
                isMilestone: nextMilestoneRow.isMilestone,
              }
            : null,
        },
        lastMeeting: lastMeeting
          ? {
              id: lastMeeting.id,
              title: lastMeeting.title,
              meetingDate: lastMeeting.meetingDate.toISOString(),
            }
          : null,
      };
    });

    const totalSoldHt = formatted.reduce(
      (acc, p) => acc + p.budget.totalSoldHt,
      0
    );
    const totalActualHt = formatted.reduce(
      (acc, p) => acc + p.budget.totalActualHt,
      0
    );
    const totalForecastCostHt = formatted.reduce(
      (acc, p) => acc + p.budget.forecastCostHt,
      0
    );
    const portfolioSummary = {
      totalProjects: formatted.length,
      healthyCount: formatted.filter((p) => p.health === "SAIN").length,
      watchCount: formatted.filter((p) => p.health === "VIGILANCE").length,
      criticalCount: formatted.filter((p) => p.health === "CRITIQUE").length,
      totalSoldHt,
      totalActualHt,
      globalMarginPct:
        totalSoldHt > 0
          ? Math.round(((totalSoldHt - totalActualHt) / totalSoldHt) * 100)
          : 0,
      globalForecastMarginPct:
        totalSoldHt > 0
          ? Math.round(
              ((totalSoldHt - totalForecastCostHt) / totalSoldHt) * 100
            )
          : 0,
      avgProgressPct:
        formatted.length > 0
          ? Math.round(
              formatted.reduce((acc, p) => acc + p.tasks.progressPct, 0) /
                formatted.length
            )
          : 0,
      totalPendingInvoices: formatted.reduce(
        (acc, p) => acc + p.pendingInvoicesCount,
        0
      ),
      totalLateTasks: formatted.reduce((acc, p) => acc + p.tasks.late, 0),
      totalMeetings: formatted.reduce(
        (acc, p) => acc + p._count.meetingNotes,
        0
      ),
    };

    return NextResponse.json({ projects: formatted, portfolioSummary });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser(prisma);
    const body = CreateProjectSchema.parse(await req.json());
    const codeProjet = normalizeCp(body.codeProjet) ?? body.codeProjet.trim();
    const client = body.client.trim();
    const nomJeu = body.nomJeu.trim();
    const category = normalizeProjectCategory(body.category);
    const isSandbox = body.isSandbox ?? true;
    const shouldSeedBlank = body.seedBlankTemplates !== false;

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
        category,
        ownerId: currentUser?.id ?? null,
        isSandbox,
      },
    });

    let seededBudgetLines = 0;
    let seededRetroTasks = 0;
    if (shouldSeedBlank) {
      const [budgetSeed, retroSeed] = await Promise.all([
        seedBlankBudgetForProject(prisma, project.id, category),
        seedBlankRetroForProject(prisma, project.id, { category }),
      ]);
      seededBudgetLines = budgetSeed.createdCount;
      seededRetroTasks = retroSeed.createdCount;
    }

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
        actor: currentUser?.email ?? "user",
        action: "PROJECT_CREATED",
        targetType: "PROJECT",
        targetId: project.id,
        detailsJson: JSON.stringify({
          codeProjet,
          client,
          nomJeu,
          category,
          isSandbox,
          provisionDrive: Boolean(body.provisionDrive),
          seededBudgetLines,
          seededRetroTasks,
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
        templatesSeeded: {
          category,
          budgetLinesCount: seededBudgetLines,
          retroTasksCount: seededRetroTasks,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
