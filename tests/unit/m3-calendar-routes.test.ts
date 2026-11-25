import fs from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { provisionProjectCalendar } from "@/lib/calendar/calendar-service";
import type { CalendarPort } from "@/lib/ports";
import { createRetroTask } from "@/lib/retroplanning/retro-service";
import {
  createInMemoryGeminiDouble,
  createInMemoryGoogleDouble,
} from "../doubles/in-memory-google";

// vi.hoisted runs before static imports are initialised, so its dependencies
// must be loaded dynamically inside the factory.
const hoisted = await vi.hoisted(async () => {
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { PrismaClient } = await import("@prisma/client");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-m3-cal-routes-"));
  const dbPath = path.join(tempDir, "test.db");
  const baseDb = path.join(process.cwd(), "prisma", "dev.db");
  if (fs.existsSync(baseDb)) {
    fs.copyFileSync(baseDb, dbPath);
  } else {
    execFileSync("npx.cmd", ["prisma", "db", "push", "--skip-generate"], {
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    });
  }
  const prismaClient = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
  });
  return { tempDir, prisma: prismaClient };
});

vi.mock("@/lib/prisma", () => ({
  prisma: hoisted.prisma,
}));

import { POST as postCalendar } from "@/app/api/projects/[id]/calendar/route";
import { POST as postSyncCascades } from "@/app/api/projects/[id]/calendar/sync-cascades/route";

describe("M3 F18 — Calendar API Route Sandbox Guard (blocks 'primary' & dual-field smuggling)", () => {
  const prisma = hoisted.prisma;
  const origHarness = process.env.TEST_BOUNDARY_HARNESS;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(() => {
    process.env.TEST_BOUNDARY_HARNESS = origHarness;
    globalThis.__GO_TEST_BOUNDARY__ = undefined;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    fs.rmSync(hoisted.tempDir, { recursive: true, force: true });
  });

  it("returns 403 SANDBOX_VIOLATION with zero Google mutations on primary or dual-field smuggling in /calendar and /calendar/sync-cascades", async () => {
    let insertCount = 0;
    let patchCount = 0;
    let createCalCount = 0;

    const baseDouble = createInMemoryGoogleDouble();
    const spyCalendar: CalendarPort = {
      ...baseDouble.calendar,
      async createSecondaryCalendar(params) {
        createCalCount++;
        return { calendarId: "sbx_cal_route_1", summary: params.summary };
      },
      async insertEvent() {
        insertCount++;
        return { eventId: `evt_${insertCount}` };
      },
      async patchEvent(params) {
        patchCount++;
        return { eventId: params.eventId };
      },
    };

    process.env.TEST_BOUNDARY_HARNESS = "1";
    globalThis.__GO_TEST_BOUNDARY__ = {
      respectCredentials: false,
      googleGateway: { ...baseDouble, calendar: spyCalendar },
      geminiClient: createInMemoryGeminiDouble(),
    };

    const project = await prisma.project.create({
      data: {
        codeProjet: "326910",
        client: "Route Guard",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });

    const provisioned = await provisionProjectCalendar(
      prisma,
      spyCalendar,
      project.id
    );
    const validCalId = provisioned.calendarId;
    createCalCount = 0; // reset after fixture setup

    const { task: milestone } = await createRetroTask(prisma, project.id, {
      phase: "Phase 3",
      etape: "Influence",
      tache: "Route Guard Milestone",
      startDate: "2027-01-02",
      endDate: "2027-01-02",
      isMilestone: true,
      milestoneType: "INFLUENCE",
    });

    const makeReq = (url: string, body: unknown) =>
      new NextRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    // 1. POST /calendar dual-field smuggling: valid calendarId + targetCalendarId: "primary"
    const resDualCal = await postCalendar(
      makeReq(`http://localhost/api/projects/${project.id}/calendar`, {
        calendarId: validCalId,
        targetCalendarId: "primary",
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(resDualCal.status).toBe(403);
    const jsonDualCal = (await resDualCal.json()) as { code?: string };
    expect(jsonDualCal.code).toBe("SANDBOX_VIOLATION");
    expect(createCalCount).toBe(0);

    // 2. POST /calendar/sync-cascades with calendarId: "primary"
    const resSyncCalPrimary = await postSyncCascades(
      makeReq(
        `http://localhost/api/projects/${project.id}/calendar/sync-cascades`,
        {
          retroTaskId: milestone.id,
          calendarId: "primary",
        }
      ),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(resSyncCalPrimary.status).toBe(403);
    const jsonSyncCalPrimary = (await resSyncCalPrimary.json()) as {
      code?: string;
    };
    expect(jsonSyncCalPrimary.code).toBe("SANDBOX_VIOLATION");
    expect(insertCount).toBe(0);
    expect(patchCount).toBe(0);

    // 3. POST /calendar/sync-cascades with targetCalendarId: "primary"
    const resSyncTargetPrimary = await postSyncCascades(
      makeReq(
        `http://localhost/api/projects/${project.id}/calendar/sync-cascades`,
        {
          retroTaskId: milestone.id,
          targetCalendarId: "primary",
        }
      ),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(resSyncTargetPrimary.status).toBe(403);
    const jsonSyncTargetPrimary = (await resSyncTargetPrimary.json()) as {
      code?: string;
    };
    expect(jsonSyncTargetPrimary.code).toBe("SANDBOX_VIOLATION");
    expect(insertCount).toBe(0);
    expect(patchCount).toBe(0);

    // 4. POST /calendar/sync-cascades dual-field smuggling: valid calendarId + targetCalendarId: "unregistered"
    const resSyncDual = await postSyncCascades(
      makeReq(
        `http://localhost/api/projects/${project.id}/calendar/sync-cascades`,
        {
          retroTaskId: milestone.id,
          calendarId: validCalId,
          targetCalendarId: "foreign_cal_999",
        }
      ),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(resSyncDual.status).toBe(403);
    expect(insertCount).toBe(0);

    // 5. AuditLog recorded SANDBOX_VIOLATION_BLOCKED entries
    const blockedLogs = await prisma.auditLog.findMany({
      where: { projectId: project.id, action: "SANDBOX_VIOLATION_BLOCKED" },
    });
    expect(blockedLogs.length).toBeGreaterThanOrEqual(4);
  });
});
