import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APRES_VENTE_FOLDER_ID,
  PROD_IMMUTABLE_IDS,
  SHARED_DRIVE_ID,
  SandboxViolationError,
  assertCalendarIdAllowed,
  assertSandboxBootstrapCreateAllowed,
  assertSandboxCopyAllowed,
  assertSandboxWriteAllowed,
  clearSandboxCacheForTests,
  type DriveNodeMetadata,
  type ParentResolver,
} from "@/lib/google/sandbox-guard";

function makeResolver(nodes: Record<string, DriveNodeMetadata>): ParentResolver {
  return {
    async getFileMetadata(fileId: string): Promise<DriveNodeMetadata> {
      const found = nodes[fileId];
      if (!found) throw new Error(`Unknown ID ${fileId}`);
      return found;
    },
  };
}

describe("SandboxGuard (PROD immutability & ancestry protection)", () => {
  beforeEach(() => {
    clearSandboxCacheForTests();
    process.env.SANDBOX_MODE = "true";
  });

  it("blocks all 7 PROD_IMMUTABLE_IDS and protected containers before any write", async () => {
    const resolver = makeResolver({});
    const onViolation = vi.fn();

    for (const prodId of PROD_IMMUTABLE_IDS) {
      await expect(
        assertSandboxWriteAllowed({
          operation: "drive.updateFile",
          targetIds: [prodId],
          resolver,
          ctx: {
            projectId: "proj_1",
            allowedRootIds: ["sbx_root"],
            onViolation,
          },
        })
      ).rejects.toThrow(SandboxViolationError);
    }

    for (const containerId of [SHARED_DRIVE_ID, APRES_VENTE_FOLDER_ID]) {
      await expect(
        assertSandboxWriteAllowed({
          operation: "drive.createFile",
          parentIds: [containerId],
          resolver,
          ctx: { allowedRootIds: ["sbx_root"], onViolation },
        })
      ).rejects.toThrow(SandboxViolationError);
    }

    expect(onViolation).toHaveBeenCalledTimes(PROD_IMMUTABLE_IDS.size + 2);
  });

  it("walks upward ancestry chain and blocks nested children of PROD 16Vi3KE-...", async () => {
    const resolver = makeResolver({
      prod_child_file: {
        id: "prod_child_file",
        name: "Report.pdf",
        parents: ["prod_reporting_folder"],
      },
      prod_reporting_folder: {
        id: "prod_reporting_folder",
        name: "4_Reporting",
        parents: ["16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD"],
      },
    });

    await expect(
      assertSandboxWriteAllowed({
        operation: "sheets.values.update",
        targetIds: ["prod_child_file"],
        resolver,
        ctx: { allowedRootIds: ["sbx_internal_root"] },
      })
    ).rejects.toThrow(SandboxViolationError);
  });

  it("allows copying FROM PROD templates INTO verified [PILOTE - 326027] folder and blocks copying INTO PROD", async () => {
    const resolver = makeResolver({
      sbx_internal_root: {
        id: "sbx_internal_root",
        name: "[PILOTE - 326027] Caisse d'Épargne - Fortnite",
        parents: [APRES_VENTE_FOLDER_ID],
      },
      sbx_001_1: {
        id: "sbx_001_1",
        name: "001.1 Budget",
        parents: ["sbx_internal_root"],
      },
    });

    await expect(
      assertSandboxCopyAllowed({
        sourceFileId: "1QUSOShHJmAlch3kP5F0RIf5txwyQ7Y6wf20A0jgCtMw",
        destinationParentId: "sbx_001_1",
        resolver,
        ctx: { allowedRootIds: ["sbx_internal_root"] },
      })
    ).resolves.toBeUndefined();

    await expect(
      assertSandboxCopyAllowed({
        sourceFileId: "1QUSOShHJmAlch3kP5F0RIf5txwyQ7Y6wf20A0jgCtMw",
        destinationParentId: "16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD",
        resolver,
        ctx: { allowedRootIds: ["sbx_internal_root"] },
      })
    ).rejects.toThrow(SandboxViolationError);
  });

  it("restricts bootstrapSandboxRoots exclusively to [PILOTE / [EXT - PILOTE under 3 - Après-vente", async () => {
    await expect(
      assertSandboxBootstrapCreateAllowed({
        parentId: APRES_VENTE_FOLDER_ID,
        folderName: "[PILOTE - 326027] Caisse d'Épargne - Fortnite",
      })
    ).resolves.toBeUndefined();

    await expect(
      assertSandboxBootstrapCreateAllowed({
        parentId: APRES_VENTE_FOLDER_ID,
        folderName: "[EXT - PILOTE 326027] Caisse d'Épargne - Fortnite",
      })
    ).resolves.toBeUndefined();

    await expect(
      assertSandboxBootstrapCreateAllowed({
        parentId: APRES_VENTE_FOLDER_ID,
        folderName: "Caisse d'Épargne - Fortnite",
      })
    ).rejects.toThrow(SandboxViolationError);

    await expect(
      assertSandboxBootstrapCreateAllowed({
        parentId: "16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD",
        folderName: "[PILOTE - 326027] Test",
      })
    ).rejects.toThrow(SandboxViolationError);
  });

  it("blocks 'primary' and unregistered calendar IDs", () => {
    expect(() =>
      assertCalendarIdAllowed("primary", ["cal_project_326027"])
    ).toThrow(SandboxViolationError);
    expect(() =>
      assertCalendarIdAllowed("PRIMARY", ["cal_project_326027"])
    ).toThrow(SandboxViolationError);
    expect(() =>
      assertCalendarIdAllowed("cal_other", ["cal_project_326027"])
    ).toThrow(SandboxViolationError);
    expect(() =>
      assertCalendarIdAllowed("cal_project_326027", ["cal_project_326027"])
    ).not.toThrow();
  });

  it("fails closed on >15-hop PROD descendants and cyclic parent graphs even when SANDBOX_MODE='false'", async () => {
    const nodes: Record<string, DriveNodeMetadata> = {
      sbx_root: {
        id: "sbx_root",
        name: "[PILOTE - 326027] Caisse d'Épargne - Fortnite",
        parents: [APRES_VENTE_FOLDER_ID],
      },
      non_pilot_shallow: {
        id: "non_pilot_shallow",
        name: "Projet Client Normal",
        parents: [APRES_VENTE_FOLDER_ID],
      },
      cyc_a: { id: "cyc_a", name: "Cycle A", parents: ["cyc_b"] },
      cyc_b: { id: "cyc_b", name: "Cycle B", parents: ["cyc_a"] },
      self_loop: { id: "self_loop", name: "Self Loop", parents: ["self_loop"] },
    };

    // Build a 17-hop chain below PROD_ROOT_FOLDER_ID
    for (let i = 0; i <= 16; i++) {
      nodes[`prod_deep_${i}`] = {
        id: `prod_deep_${i}`,
        name: `Deep ${i}`,
        parents: [
          i === 16 ? "16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD" : `prod_deep_${i + 1}`,
        ],
      };
    }

    const resolver = makeResolver(nodes);
    process.env.SANDBOX_MODE = "false";

    try {
      await expect(
        assertSandboxWriteAllowed({
          operation: "drive.createFile",
          parentIds: ["prod_deep_0"],
          resolver,
          ctx: { allowedRootIds: ["sbx_root"] },
        })
      ).rejects.toThrow(SandboxViolationError);

      await expect(
        assertSandboxWriteAllowed({
          operation: "drive.createFile",
          parentIds: ["cyc_a"],
          resolver,
          ctx: { allowedRootIds: ["sbx_root"] },
        })
      ).rejects.toThrow(SandboxViolationError);

      await expect(
        assertSandboxWriteAllowed({
          operation: "drive.createFile",
          parentIds: ["self_loop"],
          resolver,
          ctx: { allowedRootIds: ["sbx_root"] },
        })
      ).rejects.toThrow(SandboxViolationError);

      // Shallow non-pilot folder terminating cleanly at APRES_VENTE_FOLDER_ID is allowed when SANDBOX_MODE="false"
      await expect(
        assertSandboxWriteAllowed({
          operation: "drive.createFile",
          parentIds: ["non_pilot_shallow"],
          resolver,
          ctx: { allowedRootIds: ["sbx_root"] },
        })
      ).resolves.toBeUndefined();
    } finally {
      process.env.SANDBOX_MODE = "true";
    }
  });

  it("rejects nameless allowedRootIds metadata when SANDBOX_MODE='true'", async () => {
    const resolver = makeResolver({
      nameless_root: {
        id: "nameless_root",
        parents: [APRES_VENTE_FOLDER_ID],
      },
    });

    await expect(
      assertSandboxWriteAllowed({
        operation: "drive.createFile",
        parentIds: ["nameless_root"],
        resolver,
        ctx: { allowedRootIds: ["nameless_root"] },
      })
    ).rejects.toThrow(SandboxViolationError);
  });
});
