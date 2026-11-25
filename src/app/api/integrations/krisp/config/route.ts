import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import {
  getOrCreateKrispWebhookSecret,
  rotateKrispWebhookSecret,
} from "@/lib/krisp/krisp-service";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const secret = await getOrCreateKrispWebhookSecret(prisma);
    const [totalMeetings, savedToDriveCount, lastMeeting, googleConn] =
      await Promise.all([
        prisma.meetingNote.count(),
        prisma.meetingNote.count({ where: { status: "SAVED_TO_DRIVE" } }),
        prisma.meetingNote.findFirst({
          orderBy: { createdAt: "desc" },
          select: { id: true, title: true, createdAt: true, status: true },
        }),
        prisma.googleConnection.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { userEmail: true },
        }),
      ]);

    const origin =
      req.headers.get("origin") ||
      `${req.nextUrl.protocol}//${req.nextUrl.host}`;

    return NextResponse.json({
      webhookUrl: `${origin}/api/integrations/krisp/webhook`,
      webhookUrlWithSecret: `${origin}/api/integrations/krisp/webhook?secret=${secret}`,
      secret,
      googleConnected: Boolean(googleConn),
      stats: {
        totalMeetings,
        savedToDriveCount,
        lastMeeting: lastMeeting
          ? {
              id: lastMeeting.id,
              title: lastMeeting.title,
              createdAt: lastMeeting.createdAt.toISOString(),
              status: lastMeeting.status,
            }
          : null,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action === "rotate") {
      const secret = await rotateKrispWebhookSecret(prisma);
      return NextResponse.json({ ok: true, secret });
    }
    const secret = await getOrCreateKrispWebhookSecret(prisma);
    return NextResponse.json({ ok: true, secret });
  } catch (err) {
    return toErrorResponse(err);
  }
}
