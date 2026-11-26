import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { requireAdminOrBootstrap } from "@/lib/auth/session";
import { getGeminiClient } from "@/lib/container";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    await requireAdminOrBootstrap(prisma);
    const gemini = await getGeminiClient();
    const result = await gemini.ping();
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
