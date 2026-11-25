import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import {
  setUserSessionCookie,
  upsertUserByEmail,
} from "@/lib/auth/session";
import { isTestBoundaryHarnessActive } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import {
  OAUTH_STATE_COOKIE_NAME,
  completeOAuthCallback,
} from "@/lib/google/oauth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const errorParam = req.nextUrl.searchParams.get("error");
    if (errorParam) {
      throw new AppHttpError(
        400,
        "GOOGLE_OAUTH_DENIED",
        `Autorisation Google refusée : ${errorParam}`
      );
    }

    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const cookieState = req.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value;

    if (!code) {
      throw new AppHttpError(
        400,
        "OAUTH_CODE_MISSING",
        "Code d'autorisation OAuth2 manquant."
      );
    }

    const harnessRootUrl = isTestBoundaryHarnessActive()
      ? process.env.TEST_BOUNDARY_HARNESS_URL?.trim()
      : undefined;

    const oauthResult = await completeOAuthCallback(prisma, {
      code,
      state,
      cookieState,
      origin: req.nextUrl.origin,
      harnessRootUrl,
    });

    const user = await upsertUserByEmail(prisma, {
      email: oauthResult.userEmail,
      name: oauthResult.userName,
    });

    const redirectUrl = new URL("/settings?oauth_status=connected", req.url);
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(OAUTH_STATE_COOKIE_NAME);
    setUserSessionCookie(response, user.id);
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
