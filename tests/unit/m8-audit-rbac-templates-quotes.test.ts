import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, User } from "@prisma/client";
import { getProjectAccess } from "@/lib/auth/session";
import {
  formatAuditActionFr,
  formatAuditDetailsFr,
} from "@/lib/shared/audit-labels";
import { sanitizeContentDispositionFilename } from "@/lib/shared/filenames";
import {
  formatEur,
  normalizeIsoDate,
  parseFrenchAmount,
  stripDiacritics,
} from "@/lib/shared/format";
import {
  DEFAULT_WEEKLY_TEMPLATE,
  PROJECT_CATEGORIES,
  DEFAULT_BUDGET_TEMPLATES,
} from "@/lib/templates/project-templates";

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u-1",
    email: "paul@gamersorigin.com",
    name: "Paul",
    jobTitle: "PM",
    role: "MEMBER",
    avatarId: "gamer-cat",
    avatarBg: "#FDE68A",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("M8 Audit Hardening: Shared Utils, RBAC Admin Bypass, Templates & Security", () => {
  it("formats EUR, strips diacritics, normalizes ISO/FR dates and parses French decimals", () => {
    expect(formatEur(12500)).toBe("12\u00A0500\u00A0€");
    expect(formatEur(1250.5, { decimals: 2 })).toBe("1\u00A0250,50\u00A0€");
    expect(stripDiacritics("Événement & Création")).toBe("Evenement & Creation");
    expect(normalizeIsoDate("25/11/2026")).toBe("2026-11-25");
    expect(normalizeIsoDate("2028-02-29")).toBe("2028-02-29");
    expect(normalizeIsoDate("2026-02-29")).toBeNull();
    expect(normalizeIsoDate("2026-02-31")).toBeNull();
    expect(parseFrenchAmount("1 250,75")).toBe(1250.75);
    expect(parseFrenchAmount("420.5")).toBe(420.5);
  });

  it("sanitizes Content-Disposition filenames against CRLF and quote injection", () => {
    const clean = sanitizeContentDispositionFilename(
      'devis"\r\nX-Injected: evil.pdf'
    );
    expect(clean).not.toContain("\r");
    expect(clean).not.toContain("\n");
    expect(clean).not.toContain('"');
  });

  it("translates audit log actions & details into clean French summaries", () => {
    expect(formatAuditActionFr("BACKUP_CREATED")).toBe("Sauvegarde créée");
    expect(formatAuditActionFr("PROJECT_ARCHIVED")).toBe("Projet archivé");
    expect(
      formatAuditDetailsFr(
        "USER_ROLE_UPDATED",
        JSON.stringify({ email: "alex@go.com", nextRole: "ADMIN" })
      )
    ).toBe("alex@go.com → Administrateur");
    expect(
      formatAuditDetailsFr(
        "BACKUP_CREATED",
        JSON.stringify({
          trigger: "WEEKLY_SCHEDULE",
          projectsCount: 4,
          quotesCount: 3,
          invoicesCount: 9,
        })
      )
    ).toBe("Auto hebdo · 4 projet(s), 3 devis, 9 facture(s)");
  });

  it("grants ADMIN full access to any agency project in getProjectAccess", async () => {
    const mockPrisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "proj-other",
          ownerId: "u-owner",
          members: [],
        }),
      },
    } as unknown as PrismaClient;

    const admin = fakeUser({ id: "u-admin", role: "ADMIN" });
    const access = await getProjectAccess(mockPrisma, "proj-other", admin);
    expect(access).toEqual({
      canView: true,
      canEdit: true,
      canManageMembers: true,
      accessRole: "OWNER",
    });

    const outsider = fakeUser({ id: "u-outsider", role: "MEMBER" });
    const denied = await getProjectAccess(mockPrisma, "proj-other", outsider);
    expect(denied.canView).toBe(false);
    expect(denied.canEdit).toBe(false);
  });

  it("provides valid default blank templates for Budget (4 categories) and Weekly", () => {
    expect(PROJECT_CATEGORIES).toEqual([
      "JEU",
      "YOUTUBE",
      "EVENEMENT",
      "SPONSOR",
    ]);
    for (const cat of PROJECT_CATEGORIES) {
      expect(DEFAULT_BUDGET_TEMPLATES[cat].length).toBeGreaterThan(0);
    }
    expect(DEFAULT_WEEKLY_TEMPLATE.nextStepsClient.length).toBeGreaterThan(0);
    expect(DEFAULT_WEEKLY_TEMPLATE.nextStepsGo.length).toBeGreaterThan(0);
    expect(DEFAULT_WEEKLY_TEMPLATE.summaryPlaceholder.length).toBeGreaterThan(0);
  });
});
