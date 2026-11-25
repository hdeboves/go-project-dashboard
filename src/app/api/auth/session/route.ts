import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  clearUserSessionCookie,
  getCurrentUser,
  setUserSessionCookie,
  toPublicUser,
  upsertUserByEmail,
} from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

const SignInSchema = z.object({
  email: z.string().email("Adresse email invalide."),
  name: z.string().trim().min(1).max(80).optional(),
  jobTitle: z.string().trim().max(80).optional(),
});

export async function GET() {
  try {
    const [currentUser, allUsers] = await Promise.all([
      getCurrentUser(prisma),
      prisma.user.findMany({
        orderBy: [{ createdAt: "asc" }],
      }),
    ]);

    return NextResponse.json({
      user: currentUser ? toPublicUser(currentUser) : null,
      users: allUsers.map(toPublicUser),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = SignInSchema.parse(await req.json());
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
