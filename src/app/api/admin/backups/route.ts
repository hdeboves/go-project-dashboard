import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { requireAdmin } from "@/lib/auth/session";
import { createBackupSnapshot } from "@/lib/backup/backup-service";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await requireAdmin(prisma);

    const backups = await prisma.backupSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      take: 26,
      select: {
        id: true,
        trigger: true,
        executionId: true,
        status: true,
        projectsCount: true,
        usersCount: true,
        invoicesCount: true,
        quotesCount: true,
        sizeBytes: true,
        createdBy: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      schedule: {
        cron: "0 4 * * 1",
        timezone: "Europe/Paris",
        humanLabel: "Chaque lundi à 04h00 (heure de Paris)",
      },
      backups: backups.map((b) => ({
        ...b,
        createdAt: b.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST() {
  try {
    const currentUser = await requireAdmin(prisma);

    const result = await createBackupSnapshot(prisma, {
      trigger: "MANUAL",
      createdBy: currentUser.email,
    });

    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
