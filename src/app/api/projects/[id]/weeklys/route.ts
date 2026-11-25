import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  generateWeeklyReport,
  getWeeklyPreview,
} from "@/lib/weeklys/weekly-service";

const GenerateWeeklySchema = z
  .object({
    weekStart: z.string().optional(),
    weekEnd: z.string().optional(),
    nextStepsClient: z.array(z.string()).optional(),
    nextStepsGo: z.array(z.string()).optional(),
    visualDriveIds: z.array(z.string()).optional(),
    recipientEmail: z.string().optional(),
  })
  .optional()
  .default({});

export async function GET(
  req: NextRequest,
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

    const weeklys = await prisma.weeklyReport.findMany({
      where: { projectId: id },
      orderBy: [{ weekEnd: "desc" }, { createdAt: "desc" }],
    });

    const wantPreview = req.nextUrl.searchParams.get("preview") === "1";
    if (wantPreview) {
      const preview = await getWeeklyPreview(
        prisma,
        id,
        req.nextUrl.searchParams.get("weekStart") ?? undefined,
        req.nextUrl.searchParams.get("weekEnd") ?? undefined
      );
      return NextResponse.json({ weeklys, preview });
    }

    return NextResponse.json({ weeklys });
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
    let rawBody: unknown = {};
    const text = await req.text();
    if (text.trim().length > 0) {
      rawBody = JSON.parse(text);
    }
    const parsed = GenerateWeeklySchema.parse(rawBody);

    const res = await generateWeeklyReport(
      prisma,
      id,
      () => getGoogleGateway(id),
      parsed,
      currentUser?.email ?? "user"
    );

    return NextResponse.json(
      {
        ok: true,
        weekly: res.weekly,
        warnings: res.warnings,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
