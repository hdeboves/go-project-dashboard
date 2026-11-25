import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import {
  getProjectBudget,
  upsertManualBudgetLine,
} from "@/lib/budget/service";
import { getServices } from "@/lib/container";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { prisma } = getServices();
    const data = await getProjectBudget(prisma, id);
    return NextResponse.json(data);
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
    const body = (await req.json()) as { id?: string };
    const { prisma } = getServices();
    const result = await upsertManualBudgetLine(prisma, id, body);
    return NextResponse.json(result, { status: body?.id ? 200 : 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
