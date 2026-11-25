import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";

const CreateTasksFromMeetingSchema = z.object({
  items: z
    .array(
      z.object({
        text: z.string().min(1),
        owner: z.string().optional().nullable(),
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

    const createdTasks = await prisma.$transaction(
      body.items.map((item) => {
        const parsedDate =
          item.dueDate && !Number.isNaN(Date.parse(item.dueDate))
            ? new Date(item.dueDate)
            : null;
        return prisma.retroTask.create({
          data: {
            projectId,
            phase: "Suivi Réunions (Krisp)",
            etape: meeting.title.slice(0, 80),
            tache: item.text.trim(),
            owner: item.owner?.trim() || "GO",
            endDate: parsedDate,
            status: "A_FAIRE",
          },
        });
      })
    );

    await prisma.auditLog.create({
      data: {
        projectId,
        actor: "user",
        action: "KRISP_ACTIONS_TO_TASKS",
        targetType: "MEETING_NOTE",
        targetId: meeting.id,
        detailsJson: JSON.stringify({
          createdCount: createdTasks.length,
          meetingTitle: meeting.title,
        }),
      },
    });

    return NextResponse.json(
      { createdCount: createdTasks.length, tasks: createdTasks },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
