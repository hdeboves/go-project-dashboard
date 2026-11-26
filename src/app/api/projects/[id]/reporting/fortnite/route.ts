import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { CpConflictError, assertNoCpConflict } from "@/lib/isolation/cp-guard";
import { prisma } from "@/lib/prisma";
import {
  computeFortniteSummary,
  parseFortniteReport,
} from "@/lib/reporting/fortnite-parser";

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

    const [rows, rawFiles] = await Promise.all([
      prisma.fortniteMetric.findMany({
        where: { projectId: id },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      }),
      prisma.reportingRawFile.findMany({
        where: {
          projectId: id,
          sourceType: { in: ["FORTNITE_CSV", "FORTNITE_XLSX"] },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const summary = computeFortniteSummary(rows);

    return NextResponse.json({
      rows,
      summary,
      rawFiles,
      rawFile: rawFiles[0] ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
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

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      throw new AppHttpError(
        400,
        "MISSING_FILE",
        "Veuillez fournir un fichier CSV ou Excel (.xlsx) Fortnite dans le champ 'file'."
      );
    }

    const arrayBuf = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const filename = file.name || "fortnite_creator_portal.csv";
    const mimeType = file.type || "text/csv";

    try {
      assertNoCpConflict(project.codeProjet, null, filename);
    } catch (err) {
      if (err instanceof CpConflictError) {
        await prisma.auditLog.create({
          data: {
            projectId: id,
            actor: "system:cp-guard",
            action: "CP_CONFLICT_BLOCKED",
            targetType: "FORTNITE_FILE",
            targetId: filename,
            detailsJson: JSON.stringify(err.result),
          },
        });
      }
      throw err;
    }

    const parsed = await parseFortniteReport(buffer, filename, mimeType);

    if (parsed.sourceType === "FORTNITE_CSV") {
      try {
        assertNoCpConflict(project.codeProjet, null, buffer.toString("utf8"));
      } catch (err) {
        if (err instanceof CpConflictError) {
          await prisma.auditLog.create({
            data: {
              projectId: id,
              actor: "system:cp-guard",
              action: "CP_CONFLICT_BLOCKED",
              targetType: "FORTNITE_FILE",
              targetId: filename,
              detailsJson: JSON.stringify(err.result),
            },
          });
        }
        throw err;
      }
    }

    const folder00611 = await prisma.driveNode.findFirst({
      where: { projectId: id, code: "006.1.1" },
    });
    const targetParentId =
      folder00611?.driveFileId ?? project.driveInternalRootId ?? null;

    let driveFileId: string | null = null;
    if (targetParentId) {
      const uploaded = await gateway.drive.createFile({
        name: filename,
        parentId: targetParentId,
        mimeType:
          parsed.sourceType === "FORTNITE_XLSX"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv",
        body: buffer,
      });
      driveFileId = uploaded.id;
    }

    const rawFile = await prisma.$transaction(async (tx) => {
      const createdRaw = await tx.reportingRawFile.create({
        data: {
          projectId: id,
          sourceType: parsed.sourceType,
          driveFileId,
          processed: true,
        },
      });

      await tx.fortniteMetric.createMany({
        data: parsed.rows.map((r) => ({
          projectId: id,
          rawFileId: createdRaw.id,
          date: r.date,
          uniquePlayers: r.uniquePlayers,
          sessions: r.sessions,
          avgPlaytimeSec: r.avgPlaytimeSec,
          retentionD1: r.retentionD1,
          peakConcurrent: r.peakConcurrent,
        })),
      });

      await tx.auditLog.create({
        data: {
          projectId: id,
          actor: "user",
          action: "FORTNITE_REPORT_IMPORTED",
          targetType: "REPORTING_RAW_FILE",
          targetId: createdRaw.id,
          detailsJson: JSON.stringify({
            filename,
            sourceType: parsed.sourceType,
            rowCount: parsed.rows.length,
            driveFileId,
          }),
        },
      });

      return createdRaw;
    });

    const allRows = await prisma.fortniteMetric.findMany({
      where: { projectId: id },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    const summary = computeFortniteSummary(allRows);

    return NextResponse.json(
      {
        ok: true,
        rows: allRows,
        importedCount: parsed.rows.length,
        summary,
        rawFile,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
