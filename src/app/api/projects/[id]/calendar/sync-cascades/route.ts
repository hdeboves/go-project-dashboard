import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { syncCalendarCascades } from "@/lib/calendar/calendar-service";
import { getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import {
  SandboxViolationError,
  assertCalendarIdAllowed,
} from "@/lib/google/sandbox-guard";
import { prisma } from "@/lib/prisma";
import {
  MILESTONE_TYPES,
  parseStrictCalendarDate,
  type MilestoneType,
} from "@/lib/retroplanning/validation";

const SyncCascadesSchema = z
  .object({
    retroTaskId: z.string().optional(),
    milestoneType: z.string().optional(),
    anchorDate: z.string().optional(),
    calendarId: z.string().optional(),
    targetCalendarId: z.string().optional(),
  })
  .optional()
  .default({});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
    let rawBody: unknown = {};
    const text = await req.text();
    if (text.trim().length > 0) {
      rawBody = JSON.parse(text);
    }
    const parsed = SyncCascadesSchema.parse(rawBody);

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    // Independently validate BOTH calendarId and targetCalendarId BEFORE getGoogleGateway
    const allowedCalendarIds = project.calendarId ? [project.calendarId] : [];
    for (const explicitCalId of [parsed.calendarId, parsed.targetCalendarId]) {
      if (explicitCalId === undefined) continue;
      try {
        assertCalendarIdAllowed(explicitCalId, allowedCalendarIds);
      } catch (err) {
        if (err instanceof SandboxViolationError) {
          await prisma.auditLog.create({
            data: {
              projectId: project.id,
              actor: "system:sandbox-guard",
              action: "SANDBOX_VIOLATION_BLOCKED",
              targetType: "GOOGLE_CALENDAR",
              targetId: explicitCalId || "(empty)",
              detailsJson: JSON.stringify({
                operation: "calendar.syncCascades",
                reason: err.reason,
              }),
            },
          });
        }
        throw err;
      }
    }

    // Validate milestoneType and anchorDate upfront (400)
    if (parsed.milestoneType !== undefined) {
      if (!MILESTONE_TYPES.includes(parsed.milestoneType as MilestoneType)) {
        throw new AppHttpError(
          400,
          "INVALID_MILESTONE_TYPE",
          `Type de jalon invalide : "${parsed.milestoneType}".`
        );
      }
      if (!parsed.retroTaskId && !parseStrictCalendarDate(parsed.anchorDate)) {
        throw new AppHttpError(
          400,
          "INVALID_ANCHOR_DATE",
          "anchorDate est requis au format YYYY-MM-DD valide."
        );
      }
    }

    const gateway = await getGoogleGateway(id);
    const result = await syncCalendarCascades(prisma, gateway.calendar, id, parsed);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
