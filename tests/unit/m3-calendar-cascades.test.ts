import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  provisionProjectCalendar,
  syncCalendarCascades,
} from "@/lib/calendar/calendar-service";
import { computeCascadeWindow } from "@/lib/calendar/cascade-rules";
import { SandboxViolationError } from "@/lib/google/sandbox-guard";
import type { CalendarPort } from "@/lib/ports";
import { createRetroTask, updateRetroTask } from "@/lib/retroplanning/retro-service";

function makeStatefulCalendarDouble(): {
  calendar: CalendarPort;
  insertedCount: number;
  patchedCount: number;
  deletedEventIds: string[];
  sharedEmails: string[];
} {
  let seq = 1;
  const state = {
    insertedCount: 0,
    patchedCount: 0,
    deletedEventIds: [] as string[],
    sharedEmails: [] as string[],
    calendar: {
      async createSecondaryCalendar(params: { summary: string }) {
        return { calendarId: `sbx_cal_${seq++}`, summary: params.summary };
      },
      async shareCalendar(params: { email: string }) {
        state.sharedEmails.push(params.email);
        return { ruleId: `acl_${seq++}` };
      },
      async listEvents() {
        return [];
      },
      async insertEvent() {
        state.insertedCount++;
        return { eventId: `g_evt_${seq++}` };
      },
      async patchEvent(params: { eventId: string }) {
        state.patchedCount++;
        return { eventId: params.eventId };
      },
      async deleteEvent(params: { eventId: string }) {
        state.deletedEventIds.push(params.eventId);
      },
    } satisfies CalendarPort,
  };
  return state;
}

describe("M3 F18 — Dedicated Secondary Calendar, Cascades, Year Rollover & In-Place Patch", () => {
  let tempDir: string;
  let prisma: PrismaClient;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-m3-calendar-"));
    const dbPath = path.join(tempDir, "test.db");
    const baseDb = path.join(process.cwd(), "prisma", "dev.db");
    if (fs.existsSync(baseDb)) {
      fs.copyFileSync(baseDb, dbPath);
    } else {
      execFileSync("npx.cmd", ["prisma", "db", "push", "--skip-generate"], {
        env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      });
    }
    prisma = new PrismaClient({
      datasources: { db: { url: `file:${dbPath}` } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("blocks 'primary' calendar with 403 SANDBOX_VIOLATION and creates/shares dedicated secondary calendar", async () => {
    const calDouble = makeStatefulCalendarDouble();
    const project = await prisma.project.create({
      data: {
        codeProjet: "326901",
        client: "Caisse d'Épargne",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    await expect(
      provisionProjectCalendar(prisma, calDouble.calendar, project.id, {
        explicitCalendarId: "primary",
      })
    ).rejects.toThrow(SandboxViolationError);

    const auditBlocked = await prisma.auditLog.findFirst({
      where: { projectId: project.id, action: "SANDBOX_VIOLATION_BLOCKED" },
    });
    expect(auditBlocked).not.toBeNull();

    const created = await provisionProjectCalendar(
      prisma,
      calDouble.calendar,
      project.id,
      {
        shareWithEmails: ["paul@gamersorigin.com", "souleimane@gamersorigin.com"],
        role: "writer",
      }
    );

    expect(created.calendarId).not.toBe("primary");
    expect(created.summary).toBe("[PILOTE - 326901] Caisse d'Épargne - Fortnite");
    expect(created.rules.length).toBeGreaterThanOrEqual(11);
    expect(calDouble.sharedEmails).toEqual([
      "paul@gamersorigin.com",
      "souleimane@gamersorigin.com",
    ]);
  });

  it("computes exact UTC offsets across year boundaries for INFLUENCE, LANCEMENT_MAP, and WEEKLY", () => {
    const mapDates = [-14, -5, -2, 0].map(
      (offset) => computeCascadeWindow("2027-01-02", offset).dateOnly
    );
    expect(mapDates).toEqual([
      "2026-12-19",
      "2026-12-28",
      "2026-12-31",
      "2027-01-02",
    ]);

    const infDates = [-10, -3, 0, 7].map(
      (offset) => computeCascadeWindow("2026-12-20", offset).dateOnly
    );
    expect(infDates).toEqual([
      "2026-12-10",
      "2026-12-17",
      "2026-12-20",
      "2026-12-27",
    ]);

    const weeklyDates = [-1, 0].map(
      (offset) => computeCascadeWindow("2026-12-11", offset).dateOnly
    );
    expect(weeklyDates).toEqual(["2026-12-10", "2026-12-11"]);
  });

  it("patches googleEventIds in-place on reschedule (zero duplicates) and cancels when unmarked", async () => {
    const calDouble = makeStatefulCalendarDouble();
    const project = await prisma.project.create({
      data: {
        codeProjet: "326902",
        client: "Cascade Test",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });
    const otherProject = await prisma.project.create({
      data: {
        codeProjet: "326903",
        client: "Other Cal",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    // Missing calendarId returns 400
    await expect(
      syncCalendarCascades(prisma, calDouble.calendar, project.id, {})
    ).rejects.toMatchObject({ httpStatus: 400, code: "CALENDAR_NOT_INITIALIZED" });

    await provisionProjectCalendar(prisma, calDouble.calendar, project.id);

    const { task: milestone } = await createRetroTask(prisma, project.id, {
      phase: "Phase 3",
      etape: "Influence",
      tache: "Sortie Wig",
      startDate: "2026-12-20",
      endDate: "2026-12-20",
      isMilestone: true,
      milestoneType: "INFLUENCE",
    });

    const firstSync = await syncCalendarCascades(
      prisma,
      calDouble.calendar,
      project.id,
      { retroTaskId: milestone.id }
    );
    expect(firstSync.syncedCount).toBe(4);
    expect(calDouble.insertedCount).toBe(4);

    const initialGoogleIds = firstSync.events
      .map((e) => e.googleEventId)
      .sort();

    // Reschedule +5 days -> 2026-12-25 (patches in-place)
    await updateRetroTask(prisma, project.id, {
      id: milestone.id,
      startDate: "2026-12-25",
      endDate: "2026-12-25",
    });
    await syncCalendarCascades(prisma, calDouble.calendar, project.id, {
      retroTaskId: milestone.id,
    });

    // Reschedule -3 days -> 2026-12-22 (patches in-place)
    await updateRetroTask(prisma, project.id, {
      id: milestone.id,
      startDate: "2026-12-22",
      endDate: "2026-12-22",
    });
    const finalSync = await syncCalendarCascades(
      prisma,
      calDouble.calendar,
      project.id,
      { retroTaskId: milestone.id }
    );

    expect(calDouble.insertedCount).toBe(4); // zero new inserts!
    expect(calDouble.patchedCount).toBe(8); // 4 patches on +5d + 4 patches on -3d
    expect(finalSync.events).toHaveLength(4);
    expect(finalSync.events.map((e) => e.googleEventId).sort()).toEqual(
      initialGoogleIds
    );
    expect(
      finalSync.events.map((e) => e.startAt.toISOString().slice(0, 10)).sort()
    ).toEqual(["2026-12-12", "2026-12-19", "2026-12-22", "2026-12-29"]);

    // Cross-project task sync rejected with 404
    await provisionProjectCalendar(prisma, calDouble.calendar, otherProject.id);
    await expect(
      syncCalendarCascades(prisma, calDouble.calendar, otherProject.id, {
        retroTaskId: milestone.id,
      })
    ).rejects.toMatchObject({ httpStatus: 404 });

    // Un-mark milestone -> cancels & deletes events
    await updateRetroTask(prisma, project.id, {
      id: milestone.id,
      isMilestone: false,
    });
    const cancelRes = await syncCalendarCascades(
      prisma,
      calDouble.calendar,
      project.id,
      { retroTaskId: milestone.id }
    );
    expect(cancelRes.cancelledCount).toBe(4);
    expect(calDouble.deletedEventIds).toHaveLength(4);
    expect(cancelRes.events.every((e) => e.status === "CANCELLED")).toBe(true);
  });

  it("cancels stale CalendarEvents when milestoneType switches (LANCEMENT_MAP -> INFLUENCE leaves 4 active, not 8)", async () => {
    const calDouble = makeStatefulCalendarDouble();
    const project = await prisma.project.create({
      data: {
        codeProjet: "326904",
        client: "Switch Type",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    await provisionProjectCalendar(prisma, calDouble.calendar, project.id);

    const { task: milestone } = await createRetroTask(prisma, project.id, {
      phase: "Phase 3",
      etape: "Map",
      tache: "Sortie Map Switch",
      startDate: "2027-01-02",
      endDate: "2027-01-02",
      isMilestone: true,
      milestoneType: "LANCEMENT_MAP",
    });

    const first = await syncCalendarCascades(
      prisma,
      calDouble.calendar,
      project.id,
      { retroTaskId: milestone.id }
    );
    expect(first.syncedCount).toBe(4);

    // Switch milestoneType to INFLUENCE and re-sync
    await updateRetroTask(prisma, project.id, {
      id: milestone.id,
      milestoneType: "INFLUENCE",
    });

    const switched = await syncCalendarCascades(
      prisma,
      calDouble.calendar,
      project.id,
      { retroTaskId: milestone.id }
    );
    expect(switched.syncedCount).toBe(4);
    expect(switched.cancelledCount).toBe(4);
    expect(calDouble.deletedEventIds).toHaveLength(4);

    const activeAfterSwitch = switched.events.filter(
      (e) => e.retroTaskId === milestone.id && e.status !== "CANCELLED"
    );
    const cancelledAfterSwitch = switched.events.filter(
      (e) => e.retroTaskId === milestone.id && e.status === "CANCELLED"
    );
    expect(activeAfterSwitch).toHaveLength(4);
    expect(cancelledAfterSwitch).toHaveLength(4);
  });
});
