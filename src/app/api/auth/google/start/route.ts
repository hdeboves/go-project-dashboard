import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import {
  OAUTH_STATE_COOKIE_NAME,
  createOAuthStartUrl,
} from "@/lib/google/oauth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const origin = req.nextUrl.origin;
    const { url, state } = await createOAuthStartUrl(prisma, origin);
    const mode = req.nextUrl.searchParams.get("mode");

    const response =
      mode === "json"
        ? NextResponse.json({ authUrl: url })
        : NextResponse.redirect(url);

    response.cookies.set(OAUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
