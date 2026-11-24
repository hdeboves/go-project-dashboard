import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { getGeminiClient } from "@/lib/container";

export async function POST() {
  try {
    const gemini = await getGeminiClient();
    const result = await gemini.ping();
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
