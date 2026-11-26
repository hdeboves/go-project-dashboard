import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  clearUserSessionCookie,
  getCurrentUser,
  isAllowedWorkspaceEmail,
  isGoogleOAuthConfigured,
  isStrictAuthEnforced,
  setUserSessionCookie,
  toPublicUser,
  upsertUserByEmail,
} from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const SignInSchema = z.object({
  email: z.string().email("Adresse email invalide."),
  name: z.string().trim().min(1).max(80).optional(),
  jobTitle: z.string().trim().max(80).optional(),
});

export async function GET() {
  try {
    const [currentUser, oauthConfigured] = await Promise.all([
      getCurrentUser(prisma),
      isGoogleOAuthConfigured(prisma),
    ]);

    const allowDirectory = Boolean(currentUser) || !isStrictAuthEnforced();
    const allUsers = allowDirectory
      ? await prisma.user.findMany({
          orderBy: [{ createdAt: "asc" }],
        })
      : [];

    return NextResponse.json({
      user: currentUser ? toPublicUser(currentUser) : null,
      users: allUsers.map(toPublicUser),
      oauthConfigured,
      authRequired: isStrictAuthEnforced(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const oauthConfigured = await isGoogleOAuthConfigured(prisma);
    if (isStrictAuthEnforced() && oauthConfigured) {
      throw new AppHttpError(
        403,
        "GOOGLE_OAUTH_REQUIRED",
        "La connexion par email simple est désactivée. Connectez-vous avec votre compte Google Workspace (@gamersorigin.com ou @lintrus.fr)."
      );
    }

    const body = SignInSchema.parse(await req.json());
    if (isStrictAuthEnforced() && !isAllowedWorkspaceEmail(body.email)) {
      throw new AppHttpError(
        403,
        "EMAIL_DOMAIN_FORBIDDEN",
        "Accès réservé aux comptes @gamersorigin.com et @lintrus.fr."
      );
    }

    const user = await upsertUserByEmail(prisma, {
      email: body.email,
      name: body.name,
      jobTitle: body.jobTitle,
    });

    await prisma.auditLog.create({
      data: {
        actor: user.email,
        action: "USER_SIGNED_IN",
        targetType: "USER",
        targetId: user.id,
        detailsJson: JSON.stringify({ email: user.email, name: user.name }),
      },
    });

    const response = NextResponse.json({
      ok: true,
      user: toPublicUser(user),
    });
    setUserSessionCookie(response, user.id);
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const response = NextResponse.json({ ok: true });
    clearUserSessionCookie(response);
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
