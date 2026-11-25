import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
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
import {
  addUtcDays,
  parseStrictCalendarDate,
} from "@/lib/retroplanning/validation";
import { seedBlankRetroForProject } from "@/lib/templates/project-templates";

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

const ApplyBlankTemplateSchema = z.object({
  action: z.literal("APPLY_BLANK_TEMPLATE"),
  replaceExisting: z.boolean().optional(),
});

const ShiftDatesActionSchema = z.object({
  action: z.literal("SHIFT_DATES"),
  deltaDays: z.number().int().min(-365).max(365).optional(),
  anchorStartDate: z.string().optional(),
  clearDates: z.boolean().optional(),
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
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "VIEW");
    const syncFromSheet =
      req.nextUrl.searchParams.get("syncFromSheet") === "1";

    if (syncFromSheet) {
      await assertProjectAccess(prisma, id, currentUser, "EDIT");
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
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
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

    const templateAttempt = ApplyBlankTemplateSchema.safeParse(rawBody);
    if (templateAttempt.success) {
      const project = await prisma.project.findUnique({ where: { id } });
      if (!project) {
        throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
      }
      const seeded = await seedBlankRetroForProject(prisma, id, {
        replaceExisting: templateAttempt.data.replaceExisting ?? false,
        category: project.category,
      });
      const overview = await getRetroplanningOverview(prisma, id);
      return NextResponse.json({
        ok: true,
        createdCount: seeded.createdCount,
        ...overview,
      });
    }

    const shiftAttempt = ShiftDatesActionSchema.safeParse(rawBody);
    if (shiftAttempt.success) {
      const tasks = await prisma.retroTask.findMany({
        where: { projectId: id },
        orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
      });

      if (shiftAttempt.data.clearDates) {
        await prisma.retroTask.updateMany({
          where: { projectId: id },
          data: { startDate: null, endDate: null },
        });
      } else if (shiftAttempt.data.anchorStartDate) {
        const anchor = parseStrictCalendarDate(shiftAttempt.data.anchorStartDate);
        if (!anchor) {
          throw new AppHttpError(
            400,
            "INVALID_ANCHOR_DATE",
            "Date de démarrage invalide."
          );
        }
        // Space tasks cleanly week-by-week by phase from anchor date
        const phaseOrder: string[] = [];
        for (const t of tasks) {
          if (!phaseOrder.includes(t.phase)) phaseOrder.push(t.phase);
        }
        await prisma.$transaction(
          tasks.map((t) => {
            const phaseIdx = Math.max(0, phaseOrder.indexOf(t.phase));
            const start = addUtcDays(anchor, phaseIdx * 7);
            const end = addUtcDays(start, 4);
            return prisma.retroTask.update({
              where: { id: t.id },
              data: { startDate: start, endDate: end },
            });
          })
        );
      } else if (
        typeof shiftAttempt.data.deltaDays === "number" &&
        shiftAttempt.data.deltaDays !== 0
      ) {
        const delta = shiftAttempt.data.deltaDays;
        const datedTasks = tasks.filter((t) => t.startDate || t.endDate);
        await prisma.$transaction(
          datedTasks.map((t) =>
            prisma.retroTask.update({
              where: { id: t.id },
              data: {
                startDate: t.startDate ? addUtcDays(t.startDate, delta) : null,
                endDate: t.endDate ? addUtcDays(t.endDate, delta) : null,
              },
            })
          )
        );
      }

      const overview = await getRetroplanningOverview(prisma, id);
      return NextResponse.json({ ok: true, ...overview });
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
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
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
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
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
