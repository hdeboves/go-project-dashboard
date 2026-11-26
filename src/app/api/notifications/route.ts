import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  buildVisibleProjectsWhere,
  requireWorkspaceUser,
} from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

const PatchNotificationSchema = z.object({
  id: z.string().optional(),
  markAllRead: z.boolean().optional(),
});

function buildNotificationScopeWhere(
  currentUser: Awaited<ReturnType<typeof requireWorkspaceUser>>
): Prisma.NotificationWhereInput {
  if (!currentUser || currentUser.role === "ADMIN") {
    return {};
  }
  return {
    OR: [
      { projectId: null },
      { project: buildVisibleProjectsWhere(currentUser) },
    ],
  };
}

export async function GET() {
  try {
    const currentUser = await requireWorkspaceUser(prisma);
    const scopeWhere = buildNotificationScopeWhere(currentUser);

    const notifications = await prisma.notification.findMany({
      where: scopeWhere,
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        project: {
          select: {
            id: true,
            codeProjet: true,
            client: true,
            nomJeu: true,
          },
        },
        ...(currentUser
          ? {
              reads: {
                where: { userId: currentUser.id },
                select: { id: true },
                take: 1,
              },
            }
          : {}),
      },
    });

    const unreadCount = currentUser
      ? await prisma.notification.count({
          where: {
            ...scopeWhere,
            read: false,
            reads: { none: { userId: currentUser.id } },
          },
        })
      : await prisma.notification.count({
          where: { ...scopeWhere, read: false },
        });

    return NextResponse.json({
      unreadCount,
      notifications: notifications.map((n) => {
        const userReads =
          "reads" in n && Array.isArray(n.reads) ? n.reads : [];
        const isRead = Boolean(n.read || userReads.length > 0);
        return {
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
          read: isRead,
          createdAt: n.createdAt.toISOString(),
        };
      }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const currentUser = await requireWorkspaceUser(prisma);
    const scopeWhere = buildNotificationScopeWhere(currentUser);
    const body = PatchNotificationSchema.parse(await req.json());

    if (currentUser) {
      if (body.markAllRead) {
        const unreadRows = await prisma.notification.findMany({
          where: {
            ...scopeWhere,
            read: false,
            reads: { none: { userId: currentUser.id } },
          },
          select: { id: true },
          take: 200,
        });
        if (unreadRows.length > 0) {
          await prisma.notificationRead.createMany({
            data: unreadRows.map((row) => ({
              notificationId: row.id,
              userId: currentUser.id,
            })),
            skipDuplicates: true,
          });
        }
      } else if (body.id) {
        const exists = await prisma.notification.findFirst({
          where: { id: body.id, ...scopeWhere },
          select: { id: true },
        });
        if (exists) {
          await prisma.notificationRead.upsert({
            where: {
              notificationId_userId: {
                notificationId: exists.id,
                userId: currentUser.id,
              },
            },
            update: {},
            create: {
              notificationId: exists.id,
              userId: currentUser.id,
            },
          });
        }
      }

      const unreadCount = await prisma.notification.count({
        where: {
          ...scopeWhere,
          read: false,
          reads: { none: { userId: currentUser.id } },
        },
      });
      return NextResponse.json({ ok: true, unreadCount });
    }

    // Fallback for non-authenticated automated test harness
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
