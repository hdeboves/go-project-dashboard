import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

const CreateTasksFromMeetingSchema = z.object({
  items: z
    .array(
      z.object({
        index: z.number().int().min(0).optional(),
        text: z.string().min(1),
        owner: z.string().optional().nullable(),
        ownerUserId: z.string().optional().nullable(),
        dueDate: z.string().optional().nullable(),
      })
    )
    .min(1),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; meetingId: string }> }
) {
  try {
    const { id: projectId, meetingId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, projectId, currentUser, "EDIT");

    const meeting = await prisma.meetingNote.findFirst({
      where: { id: meetingId, projectId },
    });
    if (!meeting) {
      return NextResponse.json(
        { error: "Compte rendu introuvable pour ce projet." },
        { status: 404 }
      );
    }

    const body = CreateTasksFromMeetingSchema.parse(await req.json());

    let existingConverted: number[] = [];
    try {
      const parsed = JSON.parse(meeting.convertedActionIndexesJson || "[]");
      if (Array.isArray(parsed)) {
        existingConverted = parsed.filter((n): n is number => typeof n === "number");
      }
    } catch {
      existingConverted = [];
    }

    const newIndexes = body.items
      .map((i) => i.index)
      .filter((n): n is number => typeof n === "number");
    const mergedConverted = Array.from(
      new Set([...existingConverted, ...newIndexes])
    ).sort((a, b) => a - b);

    const createdTasks = await prisma.$transaction(async (tx) => {
      const tasks = [];
      for (const item of body.items) {
        const parsedDate =
          item.dueDate && !Number.isNaN(Date.parse(item.dueDate))
            ? new Date(item.dueDate)
            : null;
        const created = await tx.retroTask.create({
          data: {
            projectId,
            phase: "Suivi Réunions (Krisp)",
            etape: meeting.title.slice(0, 80),
            tache: item.text.trim(),
            owner: item.owner?.trim() || "Équipe projet",
            ownerUserId: item.ownerUserId ?? currentUser?.id ?? null,
            endDate: parsedDate,
            status: "A_FAIRE",
          },
        });
        tasks.push(created);
      }

      if (newIndexes.length > 0) {
        await tx.meetingNote.update({
          where: { id: meeting.id },
          data: {
            convertedActionIndexesJson: JSON.stringify(mergedConverted),
          },
        });
      }

      return tasks;
    });

    await prisma.auditLog.create({
      data: {
        projectId,
        actor: currentUser?.email ?? "user",
        action: "KRISP_ACTIONS_TO_TASKS",
        targetType: "MEETING_NOTE",
        targetId: meeting.id,
        detailsJson: JSON.stringify({
          createdCount: createdTasks.length,
          meetingTitle: meeting.title,
          convertedActionIndexes: mergedConverted,
        }),
      },
    });

    return NextResponse.json(
      {
        createdCount: createdTasks.length,
        tasks: createdTasks,
        convertedActionIndexes: mergedConverted,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
