import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";

const PatchNotificationSchema = z.object({
  id: z.string().optional(),
  markAllRead: z.boolean().optional(),
});

export async function GET() {
  try {
    const [unreadCount, notifications] = await Promise.all([
      prisma.notification.count({ where: { read: false } }),
      prisma.notification.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          project: {
            select: {
              id: true,
              codeProjet: true,
              client: true,
              nomJeu: true,
            },
          },
        },
      }),
    ]);

    return NextResponse.json({
      unreadCount,
      notifications: notifications.map((n) => ({
        id: n.id,
        projectId: n.projectId,
        projectLabel: n.project
          ? `${n.project.client} (${n.project.codeProjet})`
          : null,
        type: n.type,
        title: n.title,
        message: n.message,
        actionUrl: n.actionUrl,
        driveUrl: n.driveUrl,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = PatchNotificationSchema.parse(await req.json());
    if (body.markAllRead) {
      await prisma.notification.updateMany({
        where: { read: false },
        data: { read: true },
      });
    } else if (body.id) {
      await prisma.notification.update({
        where: { id: body.id },
        data: { read: true },
      });
    }
    const unreadCount = await prisma.notification.count({
      where: { read: false },
    });
    return NextResponse.json({ ok: true, unreadCount });
  } catch (err) {
    return toErrorResponse(err);
  }
}
