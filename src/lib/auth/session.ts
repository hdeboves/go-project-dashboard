import type { Prisma, PrismaClient, User } from "@prisma/client";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import {
  AVATAR_BG_OPTIONS,
  AVATAR_OPTIONS,
  DEFAULT_AVATAR_BG,
  DEFAULT_AVATAR_ID,
} from "@/lib/avatars";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { AppHttpError } from "@/lib/errors";

export const USER_SESSION_COOKIE = "go_user_session";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_ALLOWED_AUTH_DOMAINS = [
  "gamersorigin.com",
  "lintrus.fr",
  "lintrus.com",
] as const;

export function isAllowedWorkspaceEmail(email: string): boolean {
  const clean = normalizeEmail(email);
  const atIdx = clean.lastIndexOf("@");
  if (atIdx <= 0) return false;
  const domain = clean.slice(atIdx + 1);

  const extraEmails = (process.env.ALLOWED_AUTH_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
  if (extraEmails.includes(clean)) return true;

  const extraDomains = (process.env.ALLOWED_AUTH_DOMAINS ?? "")
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);

  const allowedDomains = new Set<string>([
    ...DEFAULT_ALLOWED_AUTH_DOMAINS,
    ...extraDomains,
  ]);
  return allowedDomains.has(domain);
}

export const PROJECT_MEMBER_ROLES = ["OWNER", "EDITOR", "VIEWER"] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export interface PublicUserDto {
  id: string;
  email: string;
  name: string;
  jobTitle: string | null;
  role: string;
  avatarId: string;
  avatarBg: string;
}

export function toPublicUser(user: User): PublicUserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    jobTitle: user.jobTitle,
    role: user.role,
    avatarId: user.avatarId,
    avatarBg: user.avatarBg,
  };
}

function pickDeterministicAvatar(email: string): {
  avatarId: string;
  avatarBg: string;
} {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  }
  const avatar = AVATAR_OPTIONS[hash % AVATAR_OPTIONS.length];
  const bg = AVATAR_BG_OPTIONS[(hash >>> 4) % AVATAR_BG_OPTIONS.length];
  return {
    avatarId: avatar?.id ?? DEFAULT_AVATAR_ID,
    avatarBg: bg?.hex ?? DEFAULT_AVATAR_BG,
  };
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function inferNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "Utilisateur";
  return local
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function upsertUserByEmail(
  prisma: PrismaClient,
  params: {
    email: string;
    name?: string | null;
    jobTitle?: string | null;
    avatarId?: string;
    avatarBg?: string;
  }
): Promise<User> {
  const email = normalizeEmail(params.email);
  if (!email || !email.includes("@")) {
    throw new AppHttpError(
      400,
      "INVALID_EMAIL",
      "Adresse email invalide."
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const nextName = params.name?.trim();
    const nextJob = params.jobTitle?.trim();
    if (
      (nextName && nextName !== existing.name) ||
      (params.jobTitle !== undefined && (nextJob || null) !== existing.jobTitle)
    ) {
      return prisma.user.update({
        where: { id: existing.id },
        data: {
          ...(nextName ? { name: nextName } : {}),
          ...(params.jobTitle !== undefined
            ? { jobTitle: nextJob || null }
            : {}),
        },
      });
    }
    return existing;
  }

  const userCount = await prisma.user.count();
  const defaults = pickDeterministicAvatar(email);
  return prisma.user.create({
    data: {
      email,
      name: params.name?.trim() || inferNameFromEmail(email),
      jobTitle: params.jobTitle?.trim() || null,
      role: userCount === 0 ? "ADMIN" : "MEMBER",
      avatarId: params.avatarId ?? defaults.avatarId,
      avatarBg: params.avatarBg ?? defaults.avatarBg,
    },
  });
}

export function encodeSessionToken(userId: string): string {
  return encryptSecret(
    JSON.stringify({
      userId,
      iat: Date.now(),
    })
  );
}

export function decodeSessionToken(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const parsed = JSON.parse(decryptSecret(token)) as {
      userId?: unknown;
      iat?: unknown;
    };
    if (typeof parsed.userId !== "string" || parsed.userId.length === 0) {
      return null;
    }
    if (
      typeof parsed.iat === "number" &&
      Date.now() - parsed.iat > SESSION_MAX_AGE_MS
    ) {
      return null;
    }
    return parsed.userId;
  } catch {
    return null;
  }
}

export function setUserSessionCookie(
  response: NextResponse,
  userId: string
): void {
  const token = encodeSessionToken(userId);
  response.cookies.set(USER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearUserSessionCookie(response: NextResponse): void {
  response.cookies.set(USER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Resolves the currently signed-in User from the encrypted HTTP-only session cookie.
 * Returns null if no session cookie is set (e.g. first visit before sign-in or automated API tests).
 */
export async function getCurrentUser(
  prisma: PrismaClient
): Promise<User | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(USER_SESSION_COOKIE)?.value;
    const userId = decodeSessionToken(raw);
    if (!userId) return null;
    return await prisma.user.findUnique({ where: { id: userId } });
  } catch {
    return null;
  }
}

export async function requireCurrentUser(
  prisma: PrismaClient
): Promise<User> {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new AppHttpError(
      401,
      "UNAUTHORIZED",
      "Connexion requise via Google Workspace (@gamersorigin.com ou @lintrus.fr)."
    );
  }
  return user;
}

export async function requireAdmin(prisma: PrismaClient): Promise<User> {
  const user = await requireCurrentUser(prisma);
  if (user.role !== "ADMIN") {
    throw new AppHttpError(
      403,
      "ADMIN_ONLY",
      "Accès réservé aux administrateurs."
    );
  }
  return user;
}

export async function isGoogleOAuthConfigured(
  prisma: PrismaClient
): Promise<boolean> {
  if (
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  ) {
    return true;
  }
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] } },
  });
  let hasId = false;
  let hasSecret = false;
  for (const r of rows) {
    if (!r.valueEnc) continue;
    try {
      const val = decryptSecret(r.valueEnc).trim();
      if (!val) continue;
      if (r.key === "GOOGLE_CLIENT_ID") hasId = true;
      if (r.key === "GOOGLE_CLIENT_SECRET") hasSecret = true;
    } catch {
      // ignore corrupted entry
    }
  }
  return hasId && hasSecret;
}

export function isStrictAuthEnforced(): boolean {
  if (process.env.REQUIRE_AUTH === "1") return true;
  if (
    process.env.VITEST === "true" ||
    process.env.TEST_BOUNDARY_HARNESS === "1"
  ) {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

export async function requireAdminOrBootstrap(
  prisma: PrismaClient
): Promise<User | null> {
  const user = await getCurrentUser(prisma);
  if (user) {
    if (user.role !== "ADMIN") {
      throw new AppHttpError(
        403,
        "ADMIN_ONLY",
        "Accès réservé aux administrateurs."
      );
    }
    return user;
  }
  if (!isStrictAuthEnforced()) {
    return null;
  }
  const [oauthConfigured, userCount] = await Promise.all([
    isGoogleOAuthConfigured(prisma),
    prisma.user.count(),
  ]);
  if (!oauthConfigured && userCount === 0) {
    return null;
  }
  throw new AppHttpError(
    401,
    "UNAUTHORIZED",
    "Connexion administrateur requise via Google Workspace."
  );
}

export async function requireWorkspaceUser(
  prisma: PrismaClient
): Promise<User | null> {
  const user = await getCurrentUser(prisma);
  if (user) return user;
  if (!isStrictAuthEnforced()) return null;
  throw new AppHttpError(
    401,
    "UNAUTHORIZED",
    "Connexion requise via Google Workspace (@gamersorigin.com ou @lintrus.fr)."
  );
}

export interface ProjectAccessResult {
  canView: boolean;
  canEdit: boolean;
  canManageMembers: boolean;
  accessRole: ProjectMemberRole | "LEGACY" | null;
}

export function buildVisibleProjectsWhere(
  user: User | null,
  options: { includeAllForAdmin?: boolean } = {}
): Prisma.ProjectWhereInput {
  if (!user) {
    if (isStrictAuthEnforced()) {
      return { id: "__no_access__" };
    }
    return {};
  }
  if (options.includeAllForAdmin && user.role === "ADMIN") {
    return {};
  }
  return {
    OR: [
      { ownerId: user.id },
      { members: { some: { userId: user.id } } },
      { ownerId: null },
    ],
  };
}

export async function getProjectAccess(
  prisma: PrismaClient,
  projectId: string,
  user: User | null
): Promise<ProjectAccessResult> {
  if (!user) {
    if (isStrictAuthEnforced()) {
      throw new AppHttpError(
        401,
        "UNAUTHORIZED",
        "Connexion requise via Google Workspace (@gamersorigin.com ou @lintrus.fr)."
      );
    }
    return {
      canView: true,
      canEdit: true,
      canManageMembers: true,
      accessRole: null,
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      ownerId: true,
      members: {
        where: { userId: user.id },
        select: { role: true },
        take: 1,
      },
    },
  });

  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  if (user.role === "ADMIN") {
    return {
      canView: true,
      canEdit: true,
      canManageMembers: true,
      accessRole: "OWNER",
    };
  }

  if (project.ownerId === user.id) {
    return {
      canView: true,
      canEdit: true,
      canManageMembers: true,
      accessRole: "OWNER",
    };
  }

  const membership = project.members[0];
  if (membership) {
    if (membership.role === "OWNER") {
      return {
        canView: true,
        canEdit: true,
        canManageMembers: true,
        accessRole: "OWNER",
      };
    }
    if (membership.role === "EDITOR") {
      return {
        canView: true,
        canEdit: true,
        canManageMembers: false,
        accessRole: "EDITOR",
      };
    }
    return {
      canView: true,
      canEdit: false,
      canManageMembers: false,
      accessRole: "VIEWER",
    };
  }

  if (project.ownerId === null) {
    return {
      canView: true,
      canEdit: true,
      canManageMembers: true,
      accessRole: "LEGACY",
    };
  }

  return {
    canView: false,
    canEdit: false,
    canManageMembers: false,
    accessRole: null,
  };
}

export async function assertProjectAccess(
  prisma: PrismaClient,
  projectId: string,
  user: User | null,
  required: "VIEW" | "EDIT" | "MANAGE"
): Promise<ProjectAccessResult> {
  const access = await getProjectAccess(prisma, projectId, user);
  if (required === "VIEW" && !access.canView) {
    throw new AppHttpError(
      403,
      "PROJECT_ACCESS_DENIED",
      "Vous n'avez pas accès à ce projet. Demandez au propriétaire de vous le partager."
    );
  }
  if (required === "EDIT" && !access.canEdit) {
    throw new AppHttpError(
      403,
      "PROJECT_READ_ONLY",
      "Vous disposez uniquement d'un accès en lecture (Vue) sur ce projet."
    );
  }
  if (required === "MANAGE" && !access.canManageMembers) {
    throw new AppHttpError(
      403,
      "PROJECT_SHARE_FORBIDDEN",
      "Seul le propriétaire ou un gestionnaire peut partager ce projet."
    );
  }
  return access;
}

/**
 * Per-user invoice visibility filter:
 * - Pending / in-verification invoices (PENDING_VALIDATION, CONFLICT_BLOCKED) uploaded by a user
 *   are strictly private to THAT user so colleagues never see someone else's drafts in progress.
 * - Validated invoices are shared with all members of the project (official project budget).
 * - Automated Gmail-scanned invoices (uploadedById = null, gmailMessageId != null) remain visible.
 */
export function buildVisibleInvoicesWhere(
  projectId: string,
  user: Pick<User, "id"> | null,
  options: { onlyPending?: boolean; onlyConflicts?: boolean } = {}
): Prisma.InvoiceWhereInput {
  const pendingOwnershipFilter: Prisma.InvoiceWhereInput = user
    ? {
        OR: [
          { uploadedById: user.id },
          { uploadedById: null, gmailMessageId: { not: null } },
        ],
      }
    : {
        uploadedById: null,
      };

  if (options.onlyConflicts) {
    return {
      projectId,
      cpConflict: true,
      status: "CONFLICT_BLOCKED",
      ...pendingOwnershipFilter,
    };
  }

  if (options.onlyPending) {
    return {
      projectId,
      status: { in: ["PENDING_VALIDATION", "CONFLICT_BLOCKED"] },
      ...pendingOwnershipFilter,
    };
  }

  return {
    projectId,
    OR: [
      { status: "VALIDATED" },
      {
        status: { not: "VALIDATED" },
        ...pendingOwnershipFilter,
      },
    ],
  };
}

/**
 * Guards single-invoice operations (preview, edit, delete, email-preview, vigilance, validate)
 * so another user cannot view or modify a pending invoice belonging to someone else.
 */
export function assertInvoiceOwnerAccess(
  invoice: { status: string; uploadedById?: string | null },
  user: Pick<User, "id"> | null
): void {
  if (invoice.status === "VALIDATED") return;
  if (!invoice.uploadedById) return;
  if (!user || invoice.uploadedById !== user.id) {
    throw new AppHttpError(
      403,
      "INVOICE_FORBIDDEN",
      "Cette facture en cours de vérification appartient à un autre utilisateur."
    );
  }
}
