import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import {
  deleteCalendarRule,
  getCalendarState,
  provisionProjectCalendar,
  upsertCalendarRule,
} from "@/lib/calendar/calendar-service";
import { getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import {
  SandboxViolationError,
  assertCalendarIdAllowed,
} from "@/lib/google/sandbox-guard";
import { prisma } from "@/lib/prisma";
import { MILESTONE_TYPES, type MilestoneType } from "@/lib/retroplanning/validation";

const UpsertRuleSchema = z.object({
  action: z.literal("UPSERT_RULE").optional(),
  id: z.string().optional(),
  milestoneType: z.enum(MILESTONE_TYPES),
  offsetDays: z.number().int(),
  titleTemplate: z.string().trim().min(1),
  descriptionTemplate: z.string().nullable().optional(),
});

const ProvisionCalendarSchema = z
  .object({
    summary: z.string().optional(),
    description: z.string().optional(),
    shareWithEmails: z.array(z.string()).optional(),
    role: z.enum(["reader", "writer", "owner"]).optional(),
    calendarId: z.string().optional(),
    targetCalendarId: z.string().optional(),
  })
  .optional()
  .default({});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "VIEW");
    const state = await getCalendarState(prisma, id);
    return NextResponse.json(state);
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
    let rawBody: unknown = {};
    const text = await req.text();
    if (text.trim().length > 0) {
      rawBody = JSON.parse(text);
    }

    if (
      typeof rawBody === "object" &&
      rawBody !== null &&
      (rawBody as { action?: string }).action === "UPSERT_RULE"
    ) {
      const ruleInput = UpsertRuleSchema.parse(rawBody);
      const rule = await upsertCalendarRule(prisma, id, {
        ...ruleInput,
        milestoneType: ruleInput.milestoneType as MilestoneType,
      });
      return NextResponse.json({ ok: true, rule });
    }

    const parsed = ProvisionCalendarSchema.parse(rawBody);
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }

    // Independently validate BOTH calendarId and targetCalendarId (never ?? coalesce away smuggling)
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
                operation: "calendar.attach",
                reason: err.reason,
              }),
            },
          });
        }
        throw err;
      }
    }
    const explicitCalendarId = parsed.calendarId ?? parsed.targetCalendarId;

    const gateway = await getGoogleGateway(id);
    const res = await provisionProjectCalendar(prisma, gateway.calendar, id, {
      summary: parsed.summary,
      description: parsed.description,
      shareWithEmails: parsed.shareWithEmails,
      role: parsed.role,
      explicitCalendarId,
    });

    return NextResponse.json({ ok: true, ...res }, { status: 201 });
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
    const ruleInput = UpsertRuleSchema.parse(rawBody);
    const rule = await upsertCalendarRule(prisma, id, {
      ...ruleInput,
      milestoneType: ruleInput.milestoneType as MilestoneType,
    });
    return NextResponse.json({ ok: true, rule });
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
    const ruleId = req.nextUrl.searchParams.get("ruleId")?.trim() ?? "";
    if (!ruleId) {
      throw new AppHttpError(
        400,
        "RULE_ID_REQUIRED",
        "Le paramètre ruleId est obligatoire."
      );
    }
    await deleteCalendarRule(prisma, id, ruleId);
    return NextResponse.json({ ok: true, deletedRuleId: ruleId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
