import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildVisibleProjectsWhere,
  decodeSessionToken,
  encodeSessionToken,
  inferNameFromEmail,
} from "@/lib/auth/session";
import {
  AVATAR_BG_OPTIONS,
  AVATAR_OPTIONS,
  getAvatarMeta,
  getRandomAvatar,
  isValidAvatarBg,
  isValidAvatarId,
} from "@/lib/avatars";
import { exportRetroplanningToXlsxBuffer } from "@/lib/retroplanning/export-service";
import {
  DEFAULT_BUDGET_TEMPLATES,
  DEFAULT_RETRO_TEMPLATE_TASKS,
  PROJECT_CATEGORIES,
  normalizeProjectCategory,
} from "@/lib/templates/project-templates";

describe("M6 — Blank Templates by Category, Retro XLSX Export, RBAC Session & Cute Avatars", () => {
  it("provides blank budget templates for all 4 categories (Jeu, YouTube, Événement, Sponsor)", () => {
    expect(PROJECT_CATEGORIES).toEqual([
      "JEU",
      "YOUTUBE",
      "EVENEMENT",
      "SPONSOR",
    ]);

    for (const cat of PROJECT_CATEGORIES) {
      const lines = DEFAULT_BUDGET_TEMPLATES[cat];
      expect(lines.length).toBeGreaterThanOrEqual(10);
      for (const line of lines) {
        expect(line.category.trim().length).toBeGreaterThan(0);
        expect(line.objet.trim().length).toBeGreaterThan(0);
        expect(["Externe", "RH Internes", "Amortissement"]).toContain(
          line.expenseType
        );
      }
    }

    expect(normalizeProjectCategory("youtube")).toBe("YOUTUBE");
    expect(normalizeProjectCategory("Événement")).toBe("EVENEMENT");
    expect(normalizeProjectCategory("sponsor")).toBe("SPONSOR");
    expect(normalizeProjectCategory("unknown")).toBe("JEU");
  });

  it("provides a unified blank retroplanning template with tasks and zero hardcoded dates", () => {
    expect(DEFAULT_RETRO_TEMPLATE_TASKS.length).toBeGreaterThanOrEqual(12);
    for (const task of DEFAULT_RETRO_TEMPLATE_TASKS) {
      expect(task.phase.trim().length).toBeGreaterThan(0);
      expect(task.etape.trim().length).toBeGreaterThan(0);
      expect(task.tache.trim().length).toBeGreaterThan(0);
      expect("startDate" in task).toBe(false);
      expect("endDate" in task).toBe(false);
    }
  });

  it("exports retroplanning tasks (including undated template tasks) to a clean Excel .xlsx workbook", async () => {
    const now = new Date();
    const tasks = [
      {
        id: "t1",
        projectId: "p1",
        phase: "1. Cadrage & Kick-off",
        etape: "Lancement",
        tache: "Réunion Kick-off",
        owner: "Paul",
        ownerUserId: null,
        startDate: null,
        endDate: null,
        status: "A_FAIRE",
        sheetRowIndex: 3,
        isMilestone: true,
        milestoneType: "CUSTOM",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "t2",
        projectId: "p1",
        phase: "3. Production",
        etape: "Réalisation",
        tache: "Montage vidéo V1",
        owner: "Hugo",
        ownerUserId: null,
        startDate: new Date("2026-12-01T12:00:00.000Z"),
        endDate: new Date("2026-12-05T12:00:00.000Z"),
        status: "EN_COURS",
        sheetRowIndex: 4,
        isMilestone: false,
        milestoneType: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const buffer = await exportRetroplanningToXlsxBuffer(
      {
        codeProjet: "326999",
        client: "Client Test",
        nomJeu: "Série YouTube",
        category: "YOUTUBE",
      },
      tasks
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    const mainSheet = wb.getWorksheet("Par semaine");
    expect(mainSheet).toBeDefined();
    expect(String(mainSheet?.getCell("A1").value ?? "")).toContain("326999");
    expect(mainSheet?.getCell("B2").value).toBe("PHASES");
    expect(mainSheet?.getCell("D2").value).toBe("TACHES");
    expect(mainSheet?.getCell("D3").value).toBe("Réunion Kick-off");
    expect(mainSheet?.getCell("F3").value).toBe("");
    expect(mainSheet?.getCell("F4").value).toBe("2026-12-01");
    expect(mainSheet?.getCell("G4").value).toBe("2026-12-05");

    const summarySheet = wb.getWorksheet("Synthèse phases");
    expect(summarySheet).toBeDefined();
    expect(summarySheet?.rowCount).toBe(3); // header + 2 phases
  });

  it("encrypts and decrypts user session cookies and scopes project visibility per user", () => {
    const token = encodeSessionToken("user_paul_123");
    expect(token).not.toContain("user_paul_123");
    expect(decodeSessionToken(token)).toBe("user_paul_123");
    expect(decodeSessionToken("invalid-token")).toBeNull();
    expect(inferNameFromEmail("paul.samuelson@gamersorigin.com")).toBe(
      "Paul Samuelson"
    );

    const where = buildVisibleProjectsWhere({
      id: "user_paul_123",
      email: "paul@gamersorigin.com",
      name: "Paul",
      jobTitle: null,
      role: "MEMBER",
      avatarId: "gamer-cat",
      avatarBg: "#FDE68A",
      lastActiveProjectId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(where).toEqual({
      OR: [
        { ownerId: "user_paul_123" },
        { members: { some: { userId: "user_paul_123" } } },
        { ownerId: null },
      ],
    });
  });

  it("validates cute avatar options, colors, and randomizer", () => {
    expect(AVATAR_OPTIONS.length).toBeGreaterThanOrEqual(16);
    expect(AVATAR_BG_OPTIONS.length).toBeGreaterThanOrEqual(10);
    expect(isValidAvatarId("cozy-capybara")).toBe(true);
    expect(isValidAvatarId("not-an-avatar")).toBe(false);
    expect(isValidAvatarBg("#FDE68A")).toBe(true);
    expect(isValidAvatarBg("#000000")).toBe(false);

    const rand = getRandomAvatar();
    expect(isValidAvatarId(rand.avatarId)).toBe(true);
    expect(isValidAvatarBg(rand.avatarBg)).toBe(true);
    expect(getAvatarMeta(rand.avatarId).id).toBe(rand.avatarId);
  });
});
