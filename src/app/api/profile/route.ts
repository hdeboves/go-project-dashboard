import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  getCurrentUser,
  setUserSessionCookie,
  toPublicUser,
  upsertUserByEmail,
} from "@/lib/auth/session";
import {
  AVATAR_BG_OPTIONS,
  AVATAR_OPTIONS,
  isValidAvatarBg,
  isValidAvatarId,
} from "@/lib/avatars";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const UpdateProfileSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().trim().min(1, "Le nom est requis.").max(80).optional(),
  jobTitle: z.string().trim().max(80).nullable().optional(),
  avatarId: z.string().trim().optional(),
  avatarBg: z.string().trim().optional(),
});

export async function GET() {
  try {
    const user = await getCurrentUser(prisma);
    return NextResponse.json({
      user: user ? toPublicUser(user) : null,
      avatarOptions: AVATAR_OPTIONS,
      avatarBgOptions: AVATAR_BG_OPTIONS,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = UpdateProfileSchema.parse(await req.json());

    if (body.avatarId && !isValidAvatarId(body.avatarId)) {
      throw new AppHttpError(400, "INVALID_AVATAR", "Icône d'avatar inconnue.");
    }
    if (body.avatarBg && !isValidAvatarBg(body.avatarBg)) {
      throw new AppHttpError(
        400,
        "INVALID_AVATAR_BG",
        "Couleur de fond d'avatar invalide."
      );
    }

    let user = await getCurrentUser(prisma);
    let createdSession = false;

    if (!user) {
      if (body.email) {
        user = await upsertUserByEmail(prisma, {
          email: body.email,
          name: body.name,
          jobTitle: body.jobTitle,
          avatarId: body.avatarId,
          avatarBg: body.avatarBg,
        });
        createdSession = true;
      } else {
        throw new AppHttpError(
          401,
          "NOT_AUTHENTICATED",
          "Connectez-vous ou créez votre profil pour personnaliser votre avatar."
        );
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.jobTitle !== undefined
          ? { jobTitle: body.jobTitle?.trim() || null }
          : {}),
        ...(body.avatarId !== undefined ? { avatarId: body.avatarId } : {}),
        ...(body.avatarBg !== undefined ? { avatarBg: body.avatarBg } : {}),
      },
    });

    const response = NextResponse.json({
      ok: true,
      user: toPublicUser(updated),
    });
    if (createdSession) {
      setUserSessionCookie(response, updated.id);
    }
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
