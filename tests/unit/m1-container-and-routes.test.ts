import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  PreconditionError,
  getServices,
  isTestBoundaryHarnessActive,
} from "@/lib/container";
import { provisionProjectTree, provisionTalentFolders } from "@/lib/drive/tree-service";
import { GmailAdapter } from "@/lib/google/gmail";
import { GOOGLE_OAUTH_SCOPES } from "@/lib/google/oauth";
import { createInMemoryGoogleDouble } from "../doubles/in-memory-google";

describe("Container 412 preconditions, OAuth scopes, Gmail Draft-First & Talent provisioning", () => {
  let tempDir: string;
  let prisma: PrismaClient;
  const origNodeEnv = process.env.NODE_ENV;
  const origHarness = process.env.TEST_BOUNDARY_HARNESS;
  const origGeminiKey = process.env.GEMINI_API_KEY;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-container-test-"));
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

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
    process.env.TEST_BOUNDARY_HARNESS = origHarness;
    if (origGeminiKey !== undefined) {
      process.env.GEMINI_API_KEY = origGeminiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    globalThis.__GO_TEST_BOUNDARY__ = undefined;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("throws typed 412 PreconditionError when Google OAuth2 or Gemini key are missing (zero dummy fallback)", async () => {
    delete process.env.TEST_BOUNDARY_HARNESS;
    delete process.env.GEMINI_API_KEY;

    const services = getServices(prisma);

    await expect(services.getGoogleGateway()).rejects.toThrow(PreconditionError);
    try {
      await services.getGoogleGateway();
    } catch (err) {
      expect((err as PreconditionError).httpStatus).toBe(412);
      expect((err as PreconditionError).code).toBe("GOOGLE_NOT_CONNECTED");
      expect((err as PreconditionError).setupUrl).toBe("/settings");
    }

    await expect(services.getGeminiClient()).rejects.toThrow(PreconditionError);
    try {
      await services.getGeminiClient();
    } catch (err) {
      expect((err as PreconditionError).httpStatus).toBe(412);
      expect((err as PreconditionError).code).toBe("GEMINI_KEY_MISSING");
      expect((err as PreconditionError).setupUrl).toBe("/settings");
    }
  });

  it("ignores TEST_BOUNDARY_HARNESS=1 when NODE_ENV is production", () => {
    process.env.TEST_BOUNDARY_HARNESS = "1";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    expect(isTestBoundaryHarnessActive()).toBe(false);

    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    expect(isTestBoundaryHarnessActive()).toBe(true);
  });

  it("includes exact 10 OAuth2 scopes without gmail.send and omits sendMessage on GmailAdapter", () => {
    expect(GOOGLE_OAUTH_SCOPES).toHaveLength(10);
    expect(
      GOOGLE_OAUTH_SCOPES.some((s) => s.includes("gmail.send"))
    ).toBe(false);
    expect("sendMessage" in GmailAdapter.prototype).toBe(false);
  });

  it("provisions dynamic talent subfolders idempotently in 004.3.2 (4 folders) and 006.1.2 (4 folders)", async () => {
    const gateway = createInMemoryGoogleDouble();
    const project = await prisma.project.create({
      data: {
        codeProjet: "326099",
        client: "Test Client",
        nomJeu: "Fortnite",
        isSandbox: true,
      },
    });
    await provisionProjectTree(prisma, gateway.drive, project.id);

    const first = await provisionTalentFolders(
      prisma,
      gateway.drive,
      project.id,
      "Kalut"
    );
    expect(first.createdNodes).toHaveLength(10);

    const prodSub = first.createdNodes.filter((n) =>
      n.code.startsWith("004.3.2.kalut.")
    );
    const rawSub = first.createdNodes.filter((n) =>
      n.code.startsWith("006.1.2.kalut.")
    );
    expect(prodSub).toHaveLength(4);
    expect(rawSub).toHaveLength(4);
    expect(prodSub.every((n) => n.isExtEligible)).toBe(true);
    expect(rawSub.every((n) => !n.isExtEligible)).toBe(true);

    // Idempotent second call reuses existing folders without creating duplicates
    const second = await provisionTalentFolders(
      prisma,
      gateway.drive,
      project.id,
      "Kalut"
    );
    expect(second.createdNodes).toHaveLength(10);
    const dbCount = await prisma.driveNode.count({
      where: { projectId: project.id, code: { startsWith: "004.3.2.kalut" } },
    });
    expect(dbCount).toBe(5);
  });
});
