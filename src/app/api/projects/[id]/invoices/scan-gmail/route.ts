import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { scanProjectGmailInvoices } from "@/lib/invoices/scan-job";

const ScanGmailSchema = z.object({
  maxResults: z.number().int().min(1).max(100).optional(),
  customQuery: z.string().trim().optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { prisma, getGoogleGateway, getGeminiClient } = getServices();
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
    const rawText = await req.text();
    const parsedJson = rawText.trim() ? JSON.parse(rawText) : {};
    const body = ScanGmailSchema.parse(parsedJson);

    const result = await scanProjectGmailInvoices({
      prisma,
      getGoogleGateway,
      getGeminiClient,
      projectId: id,
      maxResults: body.maxResults,
      customQuery: body.customQuery,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
