import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { exportRetroplanningToXlsxBuffer } from "@/lib/retroplanning/export-service";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "VIEW");

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const tasks = await prisma.retroTask.findMany({
      where: { projectId: id },
      orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
    });

    const buffer = await exportRetroplanningToXlsxBuffer(project, tasks);
    const safeCp = project.codeProjet.replace(/[^a-zA-Z0-9_-]/g, "");
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `retroplanning_${safeCp || project.id}_${dateStamp}.xlsx`;

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
