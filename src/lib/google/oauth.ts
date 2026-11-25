import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { OAuthStateError, PreconditionError } from "@/lib/errors";

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "openid",
  "email",
  "profile",
] as const;

export const REQUIRED_SERVICE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
] as const;

export const OAUTH_STATE_COOKIE_NAME = "go_oauth_state";

export interface ResolvedGoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  source: {
    clientId: "db" | "env";
    clientSecret: "db" | "env";
  };
}

let refreshInFlight: Promise<void> | null = null;

export function clearOAuthRefreshLockForTests(): void {
  refreshInFlight = null;
}

async function readSettingDecrypted(
  prisma: PrismaClient,
  key: string
): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row || !row.valueEnc) return null;
  try {
    return decryptSecret(row.valueEnc);
  } catch {
    return null;
  }
}

export async function resolveGoogleOAuthConfig(
  prisma: PrismaClient,
  requestOrigin?: string
): Promise<ResolvedGoogleOAuthConfig> {
  const dbClientId = await readSettingDecrypted(prisma, "GOOGLE_CLIENT_ID");
  const dbClientSecret = await readSettingDecrypted(
    prisma,
    "GOOGLE_CLIENT_SECRET"
  );

  const envClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
  const envClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || null;

  const clientId = dbClientId?.trim() || envClientId;
  const clientSecret = dbClientSecret?.trim() || envClientSecret;

  if (!clientId || !clientSecret) {
    throw new PreconditionError(
      "GOOGLE_OAUTH_CONFIG_MISSING",
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET non configurés. Rendez-vous dans Paramètres."
    );
  }

  const origin =
    process.env.APP_BASE_URL?.trim() ||
    requestOrigin?.trim() ||
    "http://localhost:3000";
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    `${origin.replace(/\/+$/, "")}/api/auth/google/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
    source: {
      clientId: dbClientId?.trim() ? "db" : "env",
      clientSecret: dbClientSecret?.trim() ? "db" : "env",
    },
  };
}

export async function createOAuthStartUrl(
  prisma: PrismaClient,
  requestOrigin?: string
): Promise<{ url: string; state: string; redirectUri: string }> {
  const config = await resolveGoogleOAuthConfig(prisma, requestOrigin);
  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );
  const state = crypto.randomBytes(32).toString("hex");
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [...GOOGLE_OAUTH_SCOPES],
    state,
  });

  return { url, state, redirectUri: config.redirectUri };
}

export function verifyOAuthState(
  state: string | null | undefined,
  cookieState: string | null | undefined
): void {
  if (!state || !cookieState) {
    throw new OAuthStateError("Paramètre state OAuth2 manquant.");
  }
  const a = Buffer.from(state, "utf8");
  const b = Buffer.from(cookieState, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new OAuthStateError("Jeton state OAuth2 CSRF invalide.");
  }
}

export function computeMissingScopes(grantedScopeString: string): string[] {
  const granted = new Set(
    grantedScopeString
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return REQUIRED_SERVICE_SCOPES.filter((s) => !granted.has(s));
}

export async function completeOAuthCallback(
  prisma: PrismaClient,
  params: {
    code: string;
    state: string | null | undefined;
    cookieState: string | null | undefined;
    origin?: string;
    harnessRootUrl?: string;
  }
): Promise<{
  userEmail: string;
  userName?: string | null;
  missingScopes: string[];
}> {
  verifyOAuthState(params.state, params.cookieState);

  const config = await resolveGoogleOAuthConfig(prisma, params.origin);
  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  const { tokens } = await oauth2Client.getToken(params.code);
  oauth2Client.setCredentials(tokens);

  const oauth2Api = google.oauth2({
    version: "v2",
    auth: oauth2Client,
    ...(params.harnessRootUrl ? { rootUrl: params.harnessRootUrl } : {}),
  });
  const userInfo = await oauth2Api.userinfo.get();
  const userEmail = userInfo.data.email;
  const userName = userInfo.data.name ?? null;
  if (!userEmail) {
    throw new OAuthStateError(
      "Impossible de récupérer l'adresse email Google associée."
    );
  }

  const existing = await prisma.googleConnection.findUnique({
    where: { userEmail },
  });

  const accessToken = tokens.access_token;
  if (!accessToken) {
    throw new OAuthStateError("Aucun access_token retourné par Google OAuth2.");
  }

  const refreshTokenEnc = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : existing?.refreshTokenEnc ?? null;

  if (!refreshTokenEnc) {
    throw new OAuthStateError(
      "Aucun refresh_token reçu. Révoquez l'accès dans votre compte Google ou reconnectez avec prompt=consent."
    );
  }

  const expiresAt = tokens.expiry_date
    ? new Date(tokens.expiry_date)
    : new Date(Date.now() + 3600 * 1000);
  const scopeStr = tokens.scope ?? existing?.scope ?? GOOGLE_OAUTH_SCOPES.join(" ");

  await prisma.googleConnection.upsert({
    where: { userEmail },
    update: {
      accessTokenEnc: encryptSecret(accessToken),
      refreshTokenEnc,
      expiresAt,
      scope: scopeStr,
    },
    create: {
      userEmail,
      accessTokenEnc: encryptSecret(accessToken),
      refreshTokenEnc,
      expiresAt,
      scope: scopeStr,
    },
  });

  await prisma.auditLog.create({
    data: {
      actor: userEmail,
      action: "GOOGLE_OAUTH_CONNECTED",
      targetType: "GOOGLE_CONNECTION",
      targetId: userEmail,
      detailsJson: JSON.stringify({
        missingScopes: computeMissingScopes(scopeStr),
        expiresAt: expiresAt.toISOString(),
      }),
    },
  });

  return {
    userEmail,
    userName,
    missingScopes: computeMissingScopes(scopeStr),
  };
}

export async function getAuthenticatedOAuth2Client(
  prisma: PrismaClient,
  origin?: string
): Promise<{
  oauth2Client: InstanceType<typeof google.auth.OAuth2>;
  userEmail: string;
  scope: string;
}> {
  const connection = await prisma.googleConnection.findFirst({
    orderBy: { updatedAt: "desc" },
  });

  if (!connection) {
    throw new PreconditionError(
      "GOOGLE_NOT_CONNECTED",
      "Compte Google Workspace non connecté. Connectez votre compte dans Paramètres."
    );
  }

  // If TEST_BOUNDARY_HARNESS_URL is configured and dev mode, OAuth client ID/secret may come from DB/env or fallback for harness
  let clientId = "harness-client-id";
  let clientSecret = "harness-client-secret";
  let redirectUri = `${(origin || process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "")}/api/auth/google/callback`;

  try {
    const resolved = await resolveGoogleOAuthConfig(prisma, origin);
    clientId = resolved.clientId;
    clientSecret = resolved.clientSecret;
    redirectUri = resolved.redirectUri;
  } catch (err) {
    const harnessActive =
      process.env.TEST_BOUNDARY_HARNESS === "1" &&
      process.env.NODE_ENV !== "production" &&
      Boolean(process.env.TEST_BOUNDARY_HARNESS_URL);
    if (!harnessActive) {
      throw err;
    }
  }

  const accessToken = decryptSecret(connection.accessTokenEnc);
  const refreshToken = connection.refreshTokenEnc
    ? decryptSecret(connection.refreshTokenEnc)
    : undefined;

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: connection.expiresAt.getTime(),
    scope: connection.scope,
  });

  oauth2Client.on("tokens", (tokens) => {
    void (async () => {
      try {
        const updates: {
          accessTokenEnc?: string;
          refreshTokenEnc?: string;
          expiresAt?: Date;
          scope?: string;
        } = {};
        if (tokens.access_token) {
          updates.accessTokenEnc = encryptSecret(tokens.access_token);
        }
        if (tokens.refresh_token) {
          updates.refreshTokenEnc = encryptSecret(tokens.refresh_token);
        }
        if (tokens.expiry_date) {
          updates.expiresAt = new Date(tokens.expiry_date);
        }
        if (tokens.scope) {
          updates.scope = tokens.scope;
        }
        if (Object.keys(updates).length > 0) {
          await prisma.googleConnection.update({
            where: { userEmail: connection.userEmail },
            data: updates,
          });
        }
      } catch {
        // Ignore background token persistence failure
      }
    })();
  });

  // Proactive refresh if token expires within 120 seconds (skip if harness URL handles fake tokens)
  const isNearExpiry = connection.expiresAt.getTime() - Date.now() < 120_000;
  if (isNearExpiry && refreshToken) {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        try {
          const refreshed = await oauth2Client.refreshAccessToken();
          const creds = refreshed.credentials;
          if (creds.access_token) {
            await prisma.googleConnection.update({
              where: { userEmail: connection.userEmail },
              data: {
                accessTokenEnc: encryptSecret(creds.access_token),
                ...(creds.refresh_token
                  ? { refreshTokenEnc: encryptSecret(creds.refresh_token) }
                  : {}),
                expiresAt: creds.expiry_date
                  ? new Date(creds.expiry_date)
                  : new Date(Date.now() + 3600 * 1000),
                ...(creds.scope ? { scope: creds.scope } : {}),
              },
            });
          }
        } finally {
          refreshInFlight = null;
        }
      })();
    }
    await refreshInFlight;
  }

  return {
    oauth2Client,
    userEmail: connection.userEmail,
    scope: connection.scope,
  };
}
