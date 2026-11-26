import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getGoogleGateway } from "@/lib/container";
import { prisma } from "@/lib/prisma";
import { applyOrDismissProposal } from "@/lib/retroplanning/proposal-service";

const ApplySchema = z.object({
  action: z.enum(["APPLY", "DISMISS"]),
  retroTaskId: z.string().optional(),
  proposedStatus: z.string().optional(),
  proposedStartDate: z.string().nullable().optional(),
  proposedEndDate: z.string().nullable().optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; proposalId: string }> }
) {
  try {
    const { id, proposalId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
    const rawBody: unknown = await req.json();
    const parsed = ApplySchema.parse(rawBody);

    const result = await applyOrDismissProposal(
      prisma,
      id,
      proposalId,
      parsed,
      () => getGoogleGateway(id)
    );

    return NextResponse.json({
      ok: true,
      proposal: result.proposal,
      task: result.task,
      calendarSynced: result.calendarSynced,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
