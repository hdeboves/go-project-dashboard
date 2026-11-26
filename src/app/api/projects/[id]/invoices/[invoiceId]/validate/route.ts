import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { validateInvoicePipeline } from "@/lib/invoices/validate";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; invoiceId: string }> }
) {
  try {
    const { id, invoiceId } = await context.params;
    const rawText = await req.text();
    const body = rawText.trim() ? JSON.parse(rawText) : {};

    const { prisma, getGoogleGateway } = getServices();
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");

    const result = await validateInvoicePipeline({
      prisma,
      getGoogleGateway,
      projectId: id,
      invoiceId,
      rawInput: body,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
