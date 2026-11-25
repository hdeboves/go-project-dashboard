import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { getGeminiClient, getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  ingestInfluenceScreenshot,
  listDriveInfluenceCandidates,
} from "@/lib/reporting/influence-service";
import { parseTalentsJson } from "@/lib/reporting/types";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    const [metrics, rawFiles] = await Promise.all([
      prisma.influenceMetric.findMany({
        where: { projectId: id },
        orderBy: [{ createdAt: "desc" }],
      }),
      prisma.reportingRawFile.findMany({
        where: { projectId: id, sourceType: "INFLUENCE_SCREENSHOT" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    let driveCandidates: Awaited<
      ReturnType<typeof listDriveInfluenceCandidates>
    > = [];
    if (req.nextUrl.searchParams.get("listDrive") === "1") {
      const gateway = await getGoogleGateway(id);
      driveCandidates = await listDriveInfluenceCandidates(
        prisma,
        gateway.drive,
        id
      );
    }

    return NextResponse.json({
      metrics,
      rawFiles,
      talents: parseTalentsJson(project.talentsJson),
      driveCandidates,
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
    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();

    let fileBuffer: Buffer | null = null;
    let filename: string | undefined;
    let declaredMimeType: string | undefined;
    let driveFileId: string | null = null;
    let talentName = "";
    let platform = "";
    let contentUrl: string | null = null;
    let sparkCode: string | null = null;
    let publishedAt: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      talentName = String(formData.get("talentName") ?? "");
      platform = String(formData.get("platform") ?? "");
      const rawContentUrl = formData.get("contentUrl");
      const rawSparkCode = formData.get("sparkCode");
      const rawPublishedAt = formData.get("publishedAt");
      const rawDriveFileId = formData.get("driveFileId");

      contentUrl =
        typeof rawContentUrl === "string" && rawContentUrl.trim()
          ? rawContentUrl.trim()
          : null;
      sparkCode =
        typeof rawSparkCode === "string" && rawSparkCode.trim()
          ? rawSparkCode.trim()
          : null;
      publishedAt =
        typeof rawPublishedAt === "string" && rawPublishedAt.trim()
          ? rawPublishedAt.trim()
          : null;
      driveFileId =
        typeof rawDriveFileId === "string" && rawDriveFileId.trim()
          ? rawDriveFileId.trim()
          : null;

      if (file && file instanceof File) {
        fileBuffer = Buffer.from(await file.arrayBuffer());
        filename = file.name;
        declaredMimeType = file.type;
      }
    } else {
      const body = (await req.json()) as Record<string, unknown>;
      talentName = typeof body.talentName === "string" ? body.talentName : "";
      platform = typeof body.platform === "string" ? body.platform : "";
      driveFileId =
        typeof body.driveFileId === "string" ? body.driveFileId : null;
      contentUrl =
        typeof body.contentUrl === "string" ? body.contentUrl : null;
      sparkCode = typeof body.sparkCode === "string" ? body.sparkCode : null;
      publishedAt =
        typeof body.publishedAt === "string" ? body.publishedAt : null;
    }

    const result = await ingestInfluenceScreenshot(
      {
        prisma,
        getGoogleGateway,
        getGeminiClient,
      },
      id,
      {
        fileBuffer,
        filename,
        declaredMimeType,
        driveFileId,
        talentName,
        platform,
        contentUrl,
        sparkCode,
        publishedAt,
      }
    );

    return NextResponse.json(
      {
        ok: true,
        metric: result.metric,
        rawFile: result.rawFile,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
