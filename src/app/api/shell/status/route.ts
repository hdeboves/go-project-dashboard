import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { ACTIVE_PROJECT_COOKIE } from "@/lib/auth/cookies";
import {
  buildVisibleInvoicesWhere,
  buildVisibleProjectsWhere,
  getCurrentUser,
  getProjectAccess,
  isGoogleOAuthConfigured,
  isStrictAuthEnforced,
  toPublicUser,
} from "@/lib/auth/session";
import { decryptSecret } from "@/lib/crypto";
import { isSandboxModeEnabled } from "@/lib/google/sandbox-guard";
import { prisma } from "@/lib/prisma";
import { startOfParisTodayUtc } from "@/lib/shared/dates";

export async function GET() {
  try {
    const [cookieStore, currentUser, geminiSetting, oauthConfigured] =
      await Promise.all([
        cookies(),
        getCurrentUser(prisma),
        prisma.appSetting.findUnique({
          where: { key: "GEMINI_API_KEY" },
        }),
        isGoogleOAuthConfigured(prisma),
      ]);

    const authRequired = isStrictAuthEnforced() && oauthConfigured;
    const isAuthenticatedOrPermissive = Boolean(currentUser) || !authRequired;

    const googleConn = currentUser
      ? (await prisma.googleConnection.findFirst({
          where: { userId: currentUser.id },
          orderBy: { updatedAt: "desc" },
          select: { userEmail: true, scope: true, expiresAt: true },
        })) ??
        (await prisma.googleConnection.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { userEmail: true, scope: true, expiresAt: true },
        }))
      : !authRequired
        ? await prisma.googleConnection.findFirst({
            orderBy: { updatedAt: "desc" },
            select: { userEmail: true, scope: true, expiresAt: true },
          })
        : null;

    let hasDbGemini = false;
    if (geminiSetting?.valueEnc) {
      try {
        hasDbGemini = decryptSecret(geminiSetting.valueEnc).trim().length > 0;
      } catch {
        hasDbGemini = false;
      }
    }
    const geminiConfigured =
      hasDbGemini || Boolean(process.env.GEMINI_API_KEY?.trim());

    if (!isAuthenticatedOrPermissive) {
      return NextResponse.json({
        projects: [],
        activeProjectId: null,
        activeProject: null,
        activeProjectAccess: null,
        currentUser: null,
        oauthConfigured,
        authRequired: true,
        googleConnected: false,
        googleEmail: null,
        geminiConfigured,
        sandboxMode: isSandboxModeEnabled(),
        cpConflictCount: 0,
        extDriftCount: 0,
        pendingInvoicesCount: 0,
        lateTasksCount: 0,
        myTasksCount: 0,
      });
    }

    const cookieProjectId =
      cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value ?? null;
    const userLastProjectId = currentUser?.lastActiveProjectId ?? null;

    const projects = await prisma.project.findMany({
      where: {
        ...buildVisibleProjectsWhere(currentUser),
        isArchived: false,
      },
      orderBy: [{ isSandbox: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        codeProjet: true,
        client: true,
        nomJeu: true,
        category: true,
        ownerId: true,
        isArchived: true,
        isSandbox: true,
        driveInternalRootId: true,
        driveExternalRootId: true,
        budgetSheetId: true,
        retroplanningSheetId: true,
        reportingSheetId: true,
        weeklyTemplateSlidesId: true,
        reportingTemplateSlidesId: true,
        calendarId: true,
        talentsJson: true,
      },
    });

    const preferredId = cookieProjectId || userLastProjectId;
    const activeProject =
      projects.find((p) => p.id === preferredId) ?? projects[0] ?? null;

    let activeProjectAccess = null;
    let cpConflictCount = 0;
    let extDriftCount = 0;
    let pendingInvoicesCount = 0;
    let lateTasksCount = 0;
    let myTasksCount = 0;

    const parisToday = startOfParisTodayUtc();
    const visibleProjectIds = projects.map((p) => p.id);

    if (visibleProjectIds.length > 0) {
      myTasksCount = await prisma.retroTask.count({
        where: {
          projectId: { in: visibleProjectIds },
          status: { not: "TERMINE" },
          ...(currentUser
            ? {
                OR: [
                  { ownerUserId: currentUser.id },
                  {
                    ownerUserId: null,
                    project: { ownerId: currentUser.id },
                  },
                ],
              }
            : {}),
        },
      });
    }

    if (activeProject) {
      const [access, invoiceConflicts, drifts, pendingInvs, lateTasks] =
        await Promise.all([
          getProjectAccess(prisma, activeProject.id, currentUser),
          prisma.invoice.count({
            where: buildVisibleInvoicesWhere(activeProject.id, currentUser, {
              onlyConflicts: true,
            }),
          }),
          prisma.syncStatus.count({
            where: {
              projectId: activeProject.id,
              driftDetected: true,
            },
          }),
          prisma.invoice.count({
            where: {
              ...buildVisibleInvoicesWhere(activeProject.id, currentUser, {
                onlyPending: true,
              }),
              status: "PENDING_VALIDATION",
            },
          }),
          prisma.retroTask.count({
            where: {
              projectId: activeProject.id,
              status: { not: "TERMINE" },
              endDate: { lt: parisToday },
            },
          }),
        ]);
      activeProjectAccess = access;
      cpConflictCount = invoiceConflicts;
      extDriftCount = drifts;
      pendingInvoicesCount = pendingInvs;
      lateTasksCount = lateTasks;
    }

    return NextResponse.json({
      projects,
      activeProjectId: activeProject?.id ?? null,
      activeProject,
      activeProjectAccess,
      currentUser: currentUser ? toPublicUser(currentUser) : null,
      oauthConfigured,
      authRequired,
      googleConnected: Boolean(googleConn),
      googleEmail: googleConn?.userEmail ?? null,
      geminiConfigured,
      sandboxMode: isSandboxModeEnabled(),
      cpConflictCount,
      extDriftCount,
      pendingInvoicesCount,
      lateTasksCount,
      myTasksCount,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
