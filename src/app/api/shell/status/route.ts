import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import {
  buildVisibleProjectsWhere,
  getCurrentUser,
  getProjectAccess,
  toPublicUser,
} from "@/lib/auth/session";
import { decryptSecret } from "@/lib/crypto";
import { isSandboxModeEnabled } from "@/lib/google/sandbox-guard";
import { prisma } from "@/lib/prisma";

export const ACTIVE_PROJECT_COOKIE = "go_active_project_id";

export async function GET() {
  try {
    const [cookieStore, currentUser, settingsRows, googleConn] =
      await Promise.all([
        cookies(),
        getCurrentUser(prisma),
        prisma.appSetting.findMany({
          where: { key: { in: ["ACTIVE_PROJECT_ID", "GEMINI_API_KEY"] } },
        }),
        prisma.googleConnection.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { userEmail: true, scope: true, expiresAt: true },
        }),
      ]);

    const settingsMap = new Map(settingsRows.map((s) => [s.key, s]));
    const dbActiveSetting = settingsMap.get("ACTIVE_PROJECT_ID");
    const geminiSetting = settingsMap.get("GEMINI_API_KEY");

    const cookieProjectId =
      cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value ?? null;

    let persistedActiveId: string | null = null;
    if (dbActiveSetting?.valueEnc) {
      try {
        persistedActiveId = decryptSecret(dbActiveSetting.valueEnc);
      } catch {
        persistedActiveId = null;
      }
    }

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

    const preferredId = cookieProjectId || persistedActiveId;
    const activeProject =
      projects.find((p) => p.id === preferredId) ?? projects[0] ?? null;

    let activeProjectAccess = null;
    let cpConflictCount = 0;
    let extDriftCount = 0;
    let pendingInvoicesCount = 0;
    let lateTasksCount = 0;

    if (activeProject) {
      const [access, invoiceConflicts, drifts, pendingInvs, lateTasks] =
        await Promise.all([
          getProjectAccess(prisma, activeProject.id, currentUser),
          prisma.invoice.count({
            where: {
              projectId: activeProject.id,
              cpConflict: true,
              status: "CONFLICT_BLOCKED",
            },
          }),
          prisma.syncStatus.count({
            where: {
              projectId: activeProject.id,
              driftDetected: true,
            },
          }),
          prisma.invoice.count({
            where: {
              projectId: activeProject.id,
              status: "PENDING_VALIDATION",
            },
          }),
          prisma.retroTask.count({
            where: {
              projectId: activeProject.id,
              status: { not: "TERMINE" },
              endDate: { lt: new Date() },
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
      googleConnected: Boolean(googleConn),
      googleEmail: googleConn?.userEmail ?? null,
      geminiConfigured,
      sandboxMode: isSandboxModeEnabled(),
      cpConflictCount,
      extDriftCount,
      pendingInvoicesCount,
      lateTasksCount,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
