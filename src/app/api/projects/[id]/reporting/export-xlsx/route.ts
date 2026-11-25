import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  buildConsolidatedDataset,
  exportReportingWorkbookBuffer,
} from "@/lib/reporting/consolidator";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const dataset = await buildConsolidatedDataset(prisma, id);
    const buffer = await exportReportingWorkbookBuffer(dataset);
    const safeCp = project.codeProjet.replace(/[^a-zA-Z0-9_-]/g, "");
    const filename = `reporting_${safeCp || project.id}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
