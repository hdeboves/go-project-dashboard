import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  buildVisibleInvoicesWhere,
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
import { startOfParisTodayUtc } from "@/lib/shared/dates";
import {
  normalizeProjectCategory,
  seedBlankBudgetForProject,
  seedBlankRetroForProject,
} from "@/lib/templates/project-templates";

const CreateProjectSchema = z.object({
  codeProjet: z.string().min(2),
  client: z.string().min(1),
  nomJeu: z.string().min(1),
  category: z
    .enum(["JEU", "YOUTUBE", "PROD_CREA", "EVENEMENT", "SPONSOR"])
    .optional(),
  isSandbox: z.boolean().optional(),
  provisionDrive: z.boolean().optional(),
  seedBlankTemplates: z.boolean().optional(),
  cloneFromProjectId: z.string().trim().optional(),
  kickoffDate: z.string().trim().optional(),
  launchDate: z.string().trim().optional(),
  memberEmails: z.array(z.string().email()).optional(),
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
            uploadedById: true,
            gmailMessageId: true,
            createdAt: true,
          },
        },
        quotes: {
          where: { status: "ACCEPTE" },
          select: {
            budgetLineId: true,
            amountHt: true,
          },
        },
        budgetLines: {
          select: {
            id: true,
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

    const todayStartUtc = startOfParisTodayUtc();
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000);
    // Keep unused import check happy while scoping pending invoices per user
    void buildVisibleInvoicesWhere;

    const formatted = projects.map((p) => {
      const visiblePending = p.invoices.filter((i) => {
        if (i.status === "VALIDATED") return false;
        if (!currentUser) return i.uploadedById === null;
        return (
          i.uploadedById === currentUser.id ||
          (i.uploadedById === null && i.gmailMessageId !== null)
        );
      });
      const cpConflictCount = visiblePending.filter(
        (i) => i.cpConflict && i.status === "CONFLICT_BLOCKED"
      ).length;
      const pendingInvoicesCount = visiblePending.filter(
        (i) => i.status === "PENDING_VALIDATION"
      ).length;
      const stalePendingInvoicesCount = visiblePending.filter(
        (i) => i.status === "PENDING_VALIDATION" && i.createdAt < fiveDaysAgo
      ).length;

      const acceptedQuoteByLine = new Map<string, number>();
      let unlinkedAcceptedQuotesHt = 0;
      for (const q of p.quotes) {
        if (q.budgetLineId) {
          acceptedQuoteByLine.set(
            q.budgetLineId,
            (acceptedQuoteByLine.get(q.budgetLineId) ?? 0) + (q.amountHt || 0)
          );
        } else {
          unlinkedAcceptedQuotesHt += q.amountHt || 0;
        }
      }

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
      const forecastCostHt =
        p.budgetLines.reduce(
          (acc, l) =>
            acc +
            Math.max(
              l.preOpTotalHt || 0,
              l.postOpTotalHt || 0,
              acceptedQuoteByLine.get(l.id) ?? 0
            ),
          0
        ) + unlinkedAcceptedQuotesHt;
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
        (l) =>
          l.postOpTotalHt > l.preOpTotalHt ||
          (acceptedQuoteByLine.get(l.id) ?? 0) > l.preOpTotalHt
      ).length;

      const totalTasks = p.retroTasks.length;
      const doneTasks = p.retroTasks.filter((t) => t.status === "TERMINE").length;
      const lateTasks = p.retroTasks.filter(
        (t) =>
          t.status !== "TERMINE" &&
          t.endDate !== null &&
          new Date(t.endDate) < todayStartUtc
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
        healthReasons.push(
          `${cpConflictCount} facture${cpConflictCount > 1 ? "s" : ""} en conflit CP`
        );
      }
      if (consumedPct > 100 || budgetOverrunCount > 0) {
        healthReasons.push(
          budgetOverrunCount > 0
            ? `${budgetOverrunCount} poste${budgetOverrunCount > 1 ? "s" : ""} en dépassement`
            : `Budget dépassé (${consumedPct}%)`
        );
      } else if (consumedPct >= 90 && consumedPct <= 100) {
        healthReasons.push(
          consumedPct === 100
            ? "Budget soldé à 100%"
            : `Budget à ${consumedPct}% (seuil 90%)`
        );
      }
      if (budgetAlertCount > budgetOverrunCount) {
        const nearCount = budgetAlertCount - budgetOverrunCount;
        healthReasons.push(
          `${nearCount} poste${nearCount > 1 ? "s" : ""} ≥ 90%`
        );
      }
      if (lateTasks > 0) {
        healthReasons.push(
          `${lateTasks} tâche${lateTasks > 1 ? "s" : ""} en retard`
        );
      }
      if (stalePendingInvoicesCount > 0) {
        healthReasons.push(
          `${stalePendingInvoicesCount} facture${stalePendingInvoicesCount > 1 ? "s" : ""} en attente > 5j`
        );
      }

      let health: "SAIN" | "VIGILANCE" | "CRITIQUE" = "SAIN";
      if (cpConflictCount > 0 || consumedPct > 100 || budgetOverrunCount > 0 || lateTasks >= 3) {
        health = "CRITIQUE";
      } else if (
        (consumedPct >= 90 && consumedPct < 100) ||
        budgetAlertCount > 0 ||
        lateTasks > 0 ||
        stalePendingInvoicesCount > 0
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
        isArchived: p.isArchived,
        archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
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

    const activeOnly = formatted.filter((p) => !p.isArchived);
    const archivedCount = formatted.length - activeOnly.length;

    const totalSoldHt = activeOnly.reduce(
      (acc, p) => acc + p.budget.totalSoldHt,
      0
    );
    const totalActualHt = activeOnly.reduce(
      (acc, p) => acc + p.budget.totalActualHt,
      0
    );
    const totalForecastCostHt = activeOnly.reduce(
      (acc, p) => acc + p.budget.forecastCostHt,
      0
    );
    const portfolioSummary = {
      totalProjects: activeOnly.length,
      archivedCount,
      healthyCount: activeOnly.filter((p) => p.health === "SAIN").length,
      watchCount: activeOnly.filter((p) => p.health === "VIGILANCE").length,
      criticalCount: activeOnly.filter((p) => p.health === "CRITIQUE").length,
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
        activeOnly.length > 0
          ? Math.round(
              activeOnly.reduce((acc, p) => acc + p.tasks.progressPct, 0) /
                activeOnly.length
            )
          : 0,
      totalPendingInvoices: activeOnly.reduce(
        (acc, p) => acc + p.pendingInvoicesCount,
        0
      ),
      totalLateTasks: activeOnly.reduce((acc, p) => acc + p.tasks.late, 0),
      totalMeetings: activeOnly.reduce(
        (acc, p) => acc + p._count.meetingNotes,
        0
      ),
    };

    return NextResponse.json({
      projects: formatted,
      portfolioSummary,
      isAdmin: currentUser?.role === "ADMIN",
    });
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
    if (body.cloneFromProjectId) {
      const sourceProject = await prisma.project.findFirst({
        where: {
          id: body.cloneFromProjectId,
          ...buildVisibleProjectsWhere(currentUser),
        },
        include: {
          budgetLines: { orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }] },
          retroTasks: { orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }] },
        },
      });
      if (sourceProject) {
        if (sourceProject.budgetLines.length > 0) {
          await prisma.budgetLine.createMany({
            data: sourceProject.budgetLines.map((l, idx) => ({
              projectId: project.id,
              category: l.category,
              objet: l.objet,
              realisePar: l.realisePar,
              expenseType: l.expenseType,
              saleQty: 1,
              saleDays: 1,
              saleUnitPrice: 0,
              saleTotalHt: 0,
              preOpUnitCost: 0,
              preOpTotalHt: 0,
              postOpQty: 0,
              postOpDays: 0,
              postOpUnitCost: 0,
              postOpTotalHt: 0,
              sheetRowIndex: 12 + idx,
            })),
          });
          seededBudgetLines = sourceProject.budgetLines.length;
        }
        if (sourceProject.retroTasks.length > 0) {
          await prisma.retroTask.createMany({
            data: sourceProject.retroTasks.map((t, idx) => ({
              projectId: project.id,
              phase: t.phase,
              etape: t.etape,
              tache: t.tache,
              owner: null,
              startDate: null,
              endDate: null,
              status: "A_FAIRE",
              sheetRowIndex: 3 + idx,
              isMilestone: t.isMilestone,
              milestoneType: t.milestoneType,
            })),
          });
          seededRetroTasks = sourceProject.retroTasks.length;
        }
      }
    } else if (shouldSeedBlank) {
      const [budgetSeed, retroSeed] = await Promise.all([
        seedBlankBudgetForProject(prisma, project.id, category),
        seedBlankRetroForProject(prisma, project.id, { category }),
      ]);
      seededBudgetLines = budgetSeed.createdCount;
      seededRetroTasks = retroSeed.createdCount;
    }

    // Auto-schedule seeded retroplanning tasks if kickoffDate or launchDate provided
    const kickoffParsed =
      body.kickoffDate && /^\d{4}-\d{2}-\d{2}$/.test(body.kickoffDate)
        ? new Date(`${body.kickoffDate}T12:00:00Z`)
        : null;
    const launchParsed =
      body.launchDate && /^\d{4}-\d{2}-\d{2}$/.test(body.launchDate)
        ? new Date(`${body.launchDate}T12:00:00Z`)
        : null;

    if ((kickoffParsed || launchParsed) && seededRetroTasks > 0) {
      const tasksToDate = await prisma.retroTask.findMany({
        where: { projectId: project.id },
        orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
      });
      const phaseOrder: string[] = [];
      for (const t of tasksToDate) {
        if (!phaseOrder.includes(t.phase)) phaseOrder.push(t.phase);
      }
      const totalPhases = Math.max(1, phaseOrder.length);
      const baseAnchor = kickoffParsed
        ? kickoffParsed
        : new Date(
            launchParsed!.getTime() - Math.max(1, totalPhases - 2) * 7 * 86_400_000
          );
      await prisma.$transaction(
        tasksToDate.map((t) => {
          const pIdx = Math.max(0, phaseOrder.indexOf(t.phase));
          const start = new Date(baseAnchor.getTime() + pIdx * 7 * 86_400_000);
          const dow = start.getUTCDay();
          if (dow === 6) start.setUTCDate(start.getUTCDate() + 2);
          else if (dow === 0) start.setUTCDate(start.getUTCDate() + 1);
          const end = new Date(start.getTime() + 4 * 86_400_000);
          return prisma.retroTask.update({
            where: { id: t.id },
            data: { startDate: start, endDate: end },
          });
        })
      );
    }

    // Optional initial team sharing
    if (body.memberEmails && body.memberEmails.length > 0) {
      for (const email of body.memberEmails) {
        const clean = email.trim().toLowerCase();
        const found = await prisma.user.findUnique({ where: { email: clean } });
        if (found && found.id !== currentUser?.id) {
          await prisma.projectMember
            .upsert({
              where: {
                projectId_userId: { projectId: project.id, userId: found.id },
              },
              update: {},
              create: {
                projectId: project.id,
                userId: found.id,
                role: "EDITOR",
              },
            })
            .catch(() => undefined);
        }
      }
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
