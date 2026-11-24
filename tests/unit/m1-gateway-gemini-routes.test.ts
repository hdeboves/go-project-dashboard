import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as startOAuthGet } from "@/app/api/auth/google/start/route";
import { POST as projectsPost } from "@/app/api/projects/route";
import { POST as bootstrapSandboxPost } from "@/app/api/projects/bootstrap-sandbox/route";
import { POST as testGeminiPost } from "@/app/api/settings/test-gemini/route";
import { DriveAdapter } from "@/lib/google/drive";
import { GmailAdapter } from "@/lib/google/gmail";
import {
  APRES_VENTE_FOLDER_ID,
  SandboxViolationError,
  clearSandboxCacheForTests,
} from "@/lib/google/sandbox-guard";
import { SheetsAdapter } from "@/lib/google/sheets";
import { withGeminiRetry } from "@/lib/gemini/client";
import { prisma } from "@/lib/prisma";

describe("Gateway flags, MIME draft, Gemini retry & Route 412 preconditions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TEST_BOUNDARY_HARNESS;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    globalThis.__GO_TEST_BOUNDARY__ = undefined;
  });

  it("passes supportsAllDrives: true and includeItemsFromAllDrives: true on DriveAdapter.listFiles", async () => {
    const adapter = new DriveAdapter({
      auth: {} as never,
      sandboxCtx: { allowedRootIds: [] },
    });
    const listSpy = vi
      .spyOn(
        (adapter as unknown as { api: { files: { list: (...args: unknown[]) => unknown } } })
          .api.files,
        "list"
      )
      .mockResolvedValue({ data: { files: [] } } as never);

    await adapter.listFiles({ q: "trashed = false" });
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
    );
  });

  it("emits updateCells with fields: 'note' in SheetsAdapter.updateCellNote", async () => {
    const resolver = {
      async getFileMetadata(id: string) {
        return {
          id,
          name: "[PILOTE - 326027] Budget",
          parents: ["sbx_root"],
        };
      },
    };
    const adapter = new SheetsAdapter({
      auth: {} as never,
      resolver,
      sandboxCtx: { allowedRootIds: ["sbx_sheet_1"] },
    });
    const batchSpy = vi
      .spyOn(
        (adapter as unknown as { api: { spreadsheets: { batchUpdate: (...args: unknown[]) => unknown } } })
          .api.spreadsheets,
        "batchUpdate"
      )
      .mockResolvedValue({ data: {} } as never);

    await adapter.updateCellNote({
      spreadsheetId: "sbx_sheet_1",
      sheetId: 0,
      rowIndex: 4,
      columnIndex: 9,
      note: "Factures cumulées : F-101, F-102",
    });

    expect(batchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: "sbx_sheet_1",
        requestBody: {
          requests: [
            {
              updateCells: {
                range: {
                  sheetId: 0,
                  startRowIndex: 4,
                  endRowIndex: 5,
                  startColumnIndex: 9,
                  endColumnIndex: 10,
                },
                rows: [{ values: [{ note: "Factures cumulées : F-101, F-102" }] }],
                fields: "note",
              },
            },
          ],
        },
      })
    );
  });

  it("builds valid base64url RFC 2822 MIME draft with UTF-8 subject and PDF attachment", async () => {
    const adapter = new GmailAdapter({ auth: {} as never });
    const draftSpy = vi
      .spyOn(
        (adapter as unknown as { api: { users: { drafts: { create: (...args: unknown[]) => unknown } } } })
          .api.users.drafts,
        "create"
      )
      .mockResolvedValue({
        data: { id: "draft_abc", message: { id: "msg_xyz" } },
      } as never);

    const res = await adapter.createDraft({
      to: "gamersorigin-8j117x7x@suppliers.pennylane.com",
      cc: ["souleimane@gamersorigin.com"],
      subject: "Facture | Studio Éclair - Mapping | CP 326027",
      textBody: "Bonjour, ci-joint la facture.",
      attachments: [
        {
          filename: "2026-11-24_326027_Studio_1000EUR.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("%PDF-1.4 mock"),
        },
      ],
    });

    expect(res.draftId).toBe("draft_abc");
    const callArg = draftSpy.mock.calls[0][0] as {
      requestBody: { message: { raw: string } };
    };
    const decoded = Buffer.from(
      callArg.requestBody.message.raw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");

    expect(decoded).toContain("To: gamersorigin-8j117x7x@suppliers.pennylane.com");
    expect(decoded).toContain("Subject: =?UTF-8?B?");
    expect(decoded).toContain('filename="2026-11-24_326027_Studio_1000EUR.pdf"');
  });

  it("retries Gemini calls on 429/503 up to 3 attempts and fails fast on 400", async () => {
    let calls = 0;
    const result = await withGeminiRetry(
      async () => {
        calls++;
        if (calls < 3) {
          const err = new Error("429 RESOURCE_EXHAUSTED");
          (err as unknown as { status: number }).status = 429;
          throw err;
        }
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 5 }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);

    let nonRetryCalls = 0;
    await expect(
      withGeminiRetry(
        async () => {
          nonRetryCalls++;
          const err = new Error("400 Bad Request");
          (err as unknown as { status: number }).status = 400;
          throw err;
        },
        { maxAttempts: 3, baseDelayMs: 5 }
      )
    ).rejects.toThrow("400 Bad Request");
    expect(nonRetryCalls).toBe(1);
  });

  it("returns HTTP 412 Precondition Failed from M1 API routes when credentials are unconfigured", async () => {
    // Spy on prisma queries so we don't mutate or depend on local dev.db state
    vi.spyOn(prisma.appSetting, "findUnique").mockResolvedValue(null);
    vi.spyOn(prisma.googleConnection, "findFirst").mockResolvedValue(null);

    const geminiRes = await testGeminiPost();
    expect(geminiRes.status).toBe(412);
    const geminiJson = await geminiRes.json();
    expect(geminiJson.code).toBe("GEMINI_KEY_MISSING");
    expect(geminiJson.setupUrl).toBe("/settings");

    const bootstrapRes = await bootstrapSandboxPost();
    expect(bootstrapRes.status).toBe(412);
    const bootstrapJson = await bootstrapRes.json();
    expect(bootstrapJson.code).toBe("GOOGLE_NOT_CONNECTED");

    const oauthReq = new NextRequest(
      "http://localhost:3000/api/auth/google/start?mode=json"
    );
    const oauthRes = await startOAuthGet(oauthReq);
    expect(oauthRes.status).toBe(412);
    const oauthJson = await oauthRes.json();
    expect(oauthJson.code).toBe("GOOGLE_OAUTH_CONFIG_MISSING");
  });

  it("registers bootstrapped root in DriveAdapter.sandboxCtx.allowedRootIds so subsequent createFolder succeeds while non-sandbox IDs still throw", async () => {
    clearSandboxCacheForTests();
    const sandboxCtx = { allowedRootIds: [] as string[] };
    const adapter = new DriveAdapter({
      auth: {} as never,
      sandboxCtx,
    });

    const filesApi = (
      adapter as unknown as {
        api: {
          files: {
            list: (...args: unknown[]) => Promise<unknown>;
            create: (...args: unknown[]) => Promise<unknown>;
            get: (...args: unknown[]) => Promise<unknown>;
          };
        };
      }
    ).api.files;

    vi.spyOn(filesApi, "list").mockResolvedValue({ data: { files: [] } });
    vi.spyOn(filesApi, "create").mockImplementation(async (args: unknown) => {
      const req = args as { requestBody?: { name?: string; parents?: string[] } };
      if (req.requestBody?.parents?.[0] === APRES_VENTE_FOLDER_ID) {
        return {
          data: {
            id: "sbx_boot_root",
            name: req.requestBody.name,
            mimeType: "application/vnd.google-apps.folder",
            parents: [APRES_VENTE_FOLDER_ID],
          },
        };
      }
      return {
        data: {
          id: "sbx_sub_001",
          name: req.requestBody?.name ?? "sub",
          mimeType: "application/vnd.google-apps.folder",
          parents: req.requestBody?.parents ?? [],
        },
      };
    });
    vi.spyOn(filesApi, "get").mockImplementation(async (args: unknown) => {
      const req = args as { fileId: string };
      if (req.fileId === "sbx_boot_root") {
        return {
          data: {
            id: "sbx_boot_root",
            name: "[PILOTE - 326027] Caisse d'Épargne - Fortnite",
            mimeType: "application/vnd.google-apps.folder",
            parents: [APRES_VENTE_FOLDER_ID],
          },
        };
      }
      return {
        data: {
          id: req.fileId,
          name: "PROD Unauthorized Folder",
          mimeType: "application/vnd.google-apps.folder",
          parents: [APRES_VENTE_FOLDER_ID],
        },
      };
    });

    const root = await adapter.bootstrapSandboxRootFolder({
      parentId: APRES_VENTE_FOLDER_ID,
      name: "[PILOTE - 326027] Caisse d'Épargne - Fortnite",
    });
    expect(root.id).toBe("sbx_boot_root");
    expect(sandboxCtx.allowedRootIds).toContain("sbx_boot_root");

    const sub = await adapter.createFolder({
      name: "001. Budget & Finance",
      parentId: root.id,
    });
    expect(sub.id).toBe("sbx_sub_001");

    await expect(
      adapter.createFolder({
        name: "Unauthorized",
        parentId: "non_sandbox_folder",
      })
    ).rejects.toThrow(SandboxViolationError);
  });

  it("maps malformed JSON to HTTP 400 INVALID_JSON and prevents orphaned Project rows when provisionDrive rejects non-sandbox", async () => {
    const badReq = new NextRequest("http://localhost:3000/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad-json",
    });
    const badRes = await projectsPost(badReq);
    expect(badRes.status).toBe(400);
    const badJson = await badRes.json();
    expect(badJson.code).toBe("INVALID_JSON");

    const findUniqueSpy = vi
      .spyOn(prisma.project, "findUnique")
      .mockResolvedValue(null);
    const createSpy = vi.spyOn(prisma.project, "create");

    const nonSandboxReq = new NextRequest("http://localhost:3000/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codeProjet: "326088",
        client: "Client Test",
        nomJeu: "Fortnite",
        isSandbox: false,
        provisionDrive: true,
      }),
    });
    const nonSandboxRes = await projectsPost(nonSandboxReq);
    expect(nonSandboxRes.status).toBe(403);
    const nonSandboxJson = await nonSandboxRes.json();
    expect(nonSandboxJson.code).toBe("SANDBOX_VIOLATION");
    expect(findUniqueSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
