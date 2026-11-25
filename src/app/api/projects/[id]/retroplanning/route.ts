import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { PreconditionError, getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import type { GoogleWorkspacePort } from "@/lib/ports";
import { prisma } from "@/lib/prisma";
import {
  createRetroTask,
  deleteRetroTask,
  getRetroplanningOverview,
  syncSheetToDb,
  updateRetroTask,
} from "@/lib/retroplanning/retro-service";

const CreateTaskSchema = z.object({
  phase: z.string(),
  etape: z.string(),
  tache: z.string(),
  owner: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  status: z.string().optional(),
  isMilestone: z.boolean().optional(),
  milestoneType: z.string().nullable().optional(),
});

const SyncActionSchema = z.object({
  action: z.literal("SYNC_FROM_SHEET"),
});

const UpdateTaskSchema = z.object({
  id: z.string().min(1),
  phase: z.string().optional(),
  etape: z.string().nullable().optional(),
  tache: z.string().optional(),
  owner: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  status: z.string().optional(),
  isMilestone: z.boolean().optional(),
  milestoneType: z.string().nullable().optional(),
  expectedUpdatedAt: z.string().optional(),
  version: z.number().optional(),
});

async function tryGetGoogleGateway(
  projectId: string
): Promise<GoogleWorkspacePort | null> {
  try {
    return await getGoogleGateway(projectId);
  } catch (err) {
    if (err instanceof PreconditionError) {
      return null;
    }
    throw err;
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const syncFromSheet =
      req.nextUrl.searchParams.get("syncFromSheet") === "1";

    if (syncFromSheet) {
      const project = await prisma.project.findUnique({ where: { id } });
      if (!project) {
        throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
      }
      const gateway = await getGoogleGateway(id);
      await syncSheetToDb(prisma, gateway, id);
    }

    const overview = await getRetroplanningOverview(prisma, id);
    return NextResponse.json(overview);
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
    const rawBody: unknown = await req.json();

    const syncAttempt = SyncActionSchema.safeParse(rawBody);
    if (syncAttempt.success) {
      const project = await prisma.project.findUnique({ where: { id } });
      if (!project) {
        throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
      }
      const gateway = await getGoogleGateway(id);
      const syncRes = await syncSheetToDb(prisma, gateway, id);
      const overview = await getRetroplanningOverview(prisma, id);
      return NextResponse.json({
        ok: true,
        ...syncRes,
        ...overview,
      });
    }

    const parsed = CreateTaskSchema.parse(rawBody);
    const gateway = await tryGetGoogleGateway(id);
    const result = await createRetroTask(prisma, id, parsed, gateway);

    return NextResponse.json(
      {
        ok: true,
        task: result.task,
        sheetSynced: result.sheetSynced,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const rawBody: unknown = await req.json();
    const parsed = UpdateTaskSchema.parse(rawBody);
    const gateway = await tryGetGoogleGateway(id);
    const result = await updateRetroTask(prisma, id, parsed, gateway);

    return NextResponse.json({
      ok: true,
      task: result.task,
      sheetSynced: result.sheetSynced,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let taskId = req.nextUrl.searchParams.get("taskId")?.trim() ?? "";

    if (!taskId) {
      try {
        const body = (await req.json()) as { taskId?: string; id?: string };
        taskId = (body.taskId ?? body.id ?? "").trim();
      } catch {
        // Ignore empty body
      }
    }

    if (!taskId) {
      throw new AppHttpError(
        400,
        "TASK_ID_REQUIRED",
        "Le paramètre taskId est obligatoire."
      );
    }

    await deleteRetroTask(prisma, id, taskId);
    return NextResponse.json({ ok: true, deletedId: taskId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
