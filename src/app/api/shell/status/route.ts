import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { decryptSecret } from "@/lib/crypto";
import { isSandboxModeEnabled } from "@/lib/google/sandbox-guard";
import { prisma } from "@/lib/prisma";

export const ACTIVE_PROJECT_COOKIE = "go_active_project_id";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const cookieProjectId =
      cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value ?? null;
    const dbActiveSetting = await prisma.appSetting.findUnique({
      where: { key: "ACTIVE_PROJECT_ID" },
    });

    let persistedActiveId: string | null = null;
    if (dbActiveSetting?.valueEnc) {
      try {
        persistedActiveId = decryptSecret(dbActiveSetting.valueEnc);
      } catch {
        persistedActiveId = null;
      }
    }

    const projects = await prisma.project.findMany({
      orderBy: [{ isSandbox: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        codeProjet: true,
        client: true,
        nomJeu: true,
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

    const googleConn = await prisma.googleConnection.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { userEmail: true, scope: true, expiresAt: true },
    });

    const geminiSetting = await prisma.appSetting.findUnique({
      where: { key: "GEMINI_API_KEY" },
    });
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

    let cpConflictCount = 0;
    let extDriftCount = 0;

    if (activeProject) {
      const [invoiceConflicts, auditConflicts, drifts] = await Promise.all([
        prisma.invoice.count({
          where: {
            projectId: activeProject.id,
            cpConflict: true,
            status: "CONFLICT_BLOCKED",
          },
        }),
        prisma.auditLog.count({
          where: {
            projectId: activeProject.id,
            action: "CP_CONFLICT_BLOCKED",
          },
        }),
        prisma.syncStatus.count({
          where: {
            projectId: activeProject.id,
            driftDetected: true,
          },
        }),
      ]);
      cpConflictCount = invoiceConflicts > 0 ? invoiceConflicts : auditConflicts;
      extDriftCount = drifts;
    }

    return NextResponse.json({
      projects,
      activeProjectId: activeProject?.id ?? null,
      activeProject,
      googleConnected: Boolean(googleConn),
      googleEmail: googleConn?.userEmail ?? null,
      geminiConfigured,
      sandboxMode: isSandboxModeEnabled(),
      cpConflictCount,
      extDriftCount,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
