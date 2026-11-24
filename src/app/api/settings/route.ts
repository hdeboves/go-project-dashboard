import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { computeMissingScopes } from "@/lib/google/oauth";
import {
  APRES_VENTE_FOLDER_ID,
  PROD_IMMUTABLE_IDS,
  PROD_ROOT_FOLDER_ID,
  SHARED_DRIVE_ID,
  isSandboxModeEnabled,
} from "@/lib/google/sandbox-guard";
import { prisma } from "@/lib/prisma";

const DEFAULT_PENNYLANE_EMAIL = "gamersorigin-8j117x7x@suppliers.pennylane.com";
const DEFAULT_CC_LIST = "Souléimane, Louis, Paul";

const UpdateSettingsSchema = z.object({
  googleClientId: z.string().optional(),
  googleClientSecret: z.string().optional(),
  geminiApiKey: z.string().optional(),
  pennylaneEmail: z.string().email().optional().or(z.literal("")),
  defaultCcEmails: z.string().optional(),
});

async function readSettingSafe(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row?.valueEnc) return null;
  try {
    return decryptSecret(row.valueEnc);
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const [
      dbClientId,
      dbClientSecret,
      dbGeminiKey,
      dbPennylane,
      dbDefaultCc,
      googleConn,
    ] = await Promise.all([
      readSettingSafe("GOOGLE_CLIENT_ID"),
      readSettingSafe("GOOGLE_CLIENT_SECRET"),
      readSettingSafe("GEMINI_API_KEY"),
      readSettingSafe("PENNYLANE_EMAIL"),
      readSettingSafe("DEFAULT_CC_EMAILS"),
      prisma.googleConnection.findFirst({ orderBy: { updatedAt: "desc" } }),
    ]);

    const envClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
    const envClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || null;
    const envGeminiKey = process.env.GEMINI_API_KEY?.trim() || null;

    const effectiveClientId = dbClientId?.trim() || envClientId;
    const effectiveClientSecret = dbClientSecret?.trim() || envClientSecret;
    const effectiveGeminiKey = dbGeminiKey?.trim() || envGeminiKey;

    const missingScopes = googleConn
      ? computeMissingScopes(googleConn.scope)
      : [];

    return NextResponse.json({
      envStatus: {
        googleClientId: {
          configured: Boolean(effectiveClientId),
          source: dbClientId?.trim() ? "db" : envClientId ? "env" : "none",
          masked: maskSecret(effectiveClientId),
        },
        googleClientSecret: {
          configured: Boolean(effectiveClientSecret),
          source: dbClientSecret?.trim()
            ? "db"
            : envClientSecret
              ? "env"
              : "none",
          masked: maskSecret(effectiveClientSecret),
        },
        geminiApiKey: {
          configured: Boolean(effectiveGeminiKey),
          source: dbGeminiKey?.trim() ? "db" : envGeminiKey ? "env" : "none",
          masked: maskSecret(effectiveGeminiKey),
        },
      },
      oauth: {
        connected: Boolean(googleConn),
        userEmail: googleConn?.userEmail ?? null,
        expiresAt: googleConn?.expiresAt?.toISOString() ?? null,
        scope: googleConn?.scope ?? "",
        missingScopes,
      },
      pennylane: {
        pennylaneEmail: dbPennylane?.trim() || DEFAULT_PENNYLANE_EMAIL,
        defaultCcEmails: dbDefaultCc?.trim() || DEFAULT_CC_LIST,
      },
      sandbox: {
        sandboxMode: isSandboxModeEnabled(),
        sharedDriveId: SHARED_DRIVE_ID,
        apresVenteFolderId: APRES_VENTE_FOLDER_ID,
        prodRootFolderId: PROD_ROOT_FOLDER_ID,
        prodImmutableIds: Array.from(PROD_IMMUTABLE_IDS),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = UpdateSettingsSchema.parse(await req.json());
    const updatedKeys: string[] = [];

    const pairs: Array<{
      key: string;
      value: string | undefined;
      isSecret: boolean;
    }> = [
      { key: "GOOGLE_CLIENT_ID", value: body.googleClientId, isSecret: true },
      {
        key: "GOOGLE_CLIENT_SECRET",
        value: body.googleClientSecret,
        isSecret: true,
      },
      { key: "GEMINI_API_KEY", value: body.geminiApiKey, isSecret: true },
      { key: "PENNYLANE_EMAIL", value: body.pennylaneEmail, isSecret: false },
      {
        key: "DEFAULT_CC_EMAILS",
        value: body.defaultCcEmails,
        isSecret: false,
      },
    ];

    for (const item of pairs) {
      if (item.value === undefined) continue;
      const trimmed = item.value.trim();
      if (!trimmed) continue;
      // Do not overwrite if user re-submitted masked placeholder
      if (trimmed.includes("••••")) continue;

      await prisma.appSetting.upsert({
        where: { key: item.key },
        update: {
          valueEnc: encryptSecret(trimmed),
          isSecret: item.isSecret,
        },
        create: {
          key: item.key,
          valueEnc: encryptSecret(trimmed),
          isSecret: item.isSecret,
        },
      });
      updatedKeys.push(item.key);
    }

    await prisma.auditLog.create({
      data: {
        actor: "user",
        action: "SETTINGS_UPDATED",
        targetType: "APP_SETTING",
        targetId: updatedKeys.join(",") || "none",
        detailsJson: JSON.stringify({ updatedKeys }),
      },
    });

    return NextResponse.json({
      ok: true,
      updatedKeys,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
