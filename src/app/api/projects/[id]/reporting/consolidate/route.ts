import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { consolidateReportingToSheets } from "@/lib/reporting/consolidator";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const gateway = await getGoogleGateway(id);
    const result = await consolidateReportingToSheets(prisma, gateway, id);

    return NextResponse.json({
      ok: true,
      reportingSheetId: result.reportingSheetId,
      sheetId: result.reportingSheetId,
      nodeId: result.node0062Id,
      tabs: result.tabs,
      chartId: result.chartId,
      excludedUnverifiedCount: result.dataset.excludedUnverifiedCount,
      warnings:
        result.dataset.excludedUnverifiedCount > 0
          ? [
              `${result.dataset.excludedUnverifiedCount} métrique(s) Influence non vérifiée(s) par un humain exclue(s) de la consolidation.`,
            ]
          : [],
      summary: {
        fortnite: result.dataset.fortniteSummary,
        byTalent: result.dataset.byTalent,
        byPlatform: result.dataset.byPlatform,
        totals: result.dataset.totals,
        verbatimsCount: result.dataset.verbatims.length,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
