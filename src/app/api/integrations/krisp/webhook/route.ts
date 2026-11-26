import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  getOrCreateKrispWebhookSecret,
  ingestKrispMeeting,
} from "@/lib/krisp/krisp-service";
import { prisma } from "@/lib/prisma";

const ActionItemSchema = z.union([
  z.string(),
  z.object({
    text: z.string().min(1),
    owner: z.string().optional().nullable(),
    dueDate: z.string().optional().nullable(),
  }),
]);

// Flexible schema accepting native Krisp webhooks, Zapier, Make, or direct POST payloads
const KrispWebhookPayloadSchema = z.object({
  id: z.string().optional(),
  meeting_id: z.string().optional(),
  projectId: z.string().optional(),
  projectCode: z.string().optional(),
  title: z.string().optional(),
  meeting_title: z.string().optional(),
  summary: z.string().optional(),
  meeting_notes: z.string().optional(),
  notes: z.string().optional(),
  meetingDate: z.string().optional(),
  meeting_date: z.string().optional(),
  date: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
  duration_minutes: z.number().int().positive().optional(),
  participants: z.array(z.string()).optional(),
  attendees: z.array(z.string()).optional(),
  keyDecisions: z.array(z.string()).optional(),
  key_points: z.array(z.string()).optional(),
  actionItems: z.array(ActionItemSchema).optional(),
  action_items: z.array(ActionItemSchema).optional(),
  transcript: z.string().optional(),
  rawTranscript: z.string().optional(),
});

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "GO L'Intrus · Krisp Webhook",
    hint: "Envoyez un POST JSON avec l'en-tête x-krisp-secret (ou ?secret=...).",
  });
}

export async function POST(req: NextRequest) {
  try {
    const expectedSecret = await getOrCreateKrispWebhookSecret(prisma);
    const headerSecret =
      req.headers.get("x-krisp-secret") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      req.nextUrl.searchParams.get("secret") ||
      "";

    const providedBuf = Buffer.from(headerSecret.trim(), "utf8");
    const expectedBuf = Buffer.from(expectedSecret, "utf8");
    const secretValid =
      providedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(providedBuf, expectedBuf);

    if (!headerSecret || !secretValid) {
      return NextResponse.json(
        {
          error:
            "Clé secrète Krisp invalide ou manquante (x-krisp-secret / ?secret=).",
          code: "KRISP_UNAUTHORIZED",
        },
        { status: 401 }
      );
    }

    const body = KrispWebhookPayloadSchema.parse(await req.json());
    const title = (body.title || body.meeting_title || "Réunion Krisp").trim();
    const summary = (
      body.summary ||
      body.meeting_notes ||
      body.notes ||
      body.transcript ||
      body.rawTranscript ||
      ""
    ).trim();

    if (!summary) {
      return NextResponse.json(
        {
          error: "Le payload Krisp doit contenir un résumé (summary / meeting_notes) ou une transcription.",
          code: "KRISP_EMPTY_CONTENT",
        },
        { status: 400 }
      );
    }

    const result = await ingestKrispMeeting(prisma, {
      projectId: body.projectId ?? null,
      projectCode: body.projectCode ?? null,
      externalId: body.id ?? body.meeting_id ?? null,
      source: "KRISP_WEBHOOK",
      title,
      meetingDate: body.meetingDate ?? body.meeting_date ?? body.date ?? null,
      durationMinutes: body.durationMinutes ?? body.duration_minutes ?? null,
      participants: body.participants ?? body.attendees ?? [],
      summary,
      keyDecisions: body.keyDecisions ?? body.key_points ?? [],
      actionItems: body.actionItems ?? body.action_items ?? [],
      rawTranscript: body.rawTranscript ?? body.transcript ?? null,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
