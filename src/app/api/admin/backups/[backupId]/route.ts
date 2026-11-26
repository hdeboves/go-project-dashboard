import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { requireAdmin } from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ backupId: string }> }
) {
  try {
    await requireAdmin(prisma);

    const { backupId } = await context.params;
    const snap = await prisma.backupSnapshot.findUnique({
      where: { id: backupId },
    });
    if (!snap) {
      throw new AppHttpError(404, "BACKUP_NOT_FOUND", "Backup introuvable.");
    }

    const stamp = snap.createdAt.toISOString().slice(0, 10);
    const filename = `go-hub-backup_${stamp}_${snap.id.slice(0, 8)}.json`;

    return new NextResponse(snap.payloadJson, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
