import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EXTERNAL_MIRROR_TREE,
  INTERNAL_FOLDER_TREE,
  InternalOnlySyncForbiddenError,
  RetroplanningPermanentSyncForbiddenError,
  SyncMode,
  ValidationStatus,
  assertExtSyncAllowed,
  getSyncPolicy,
} from "@/lib/drive/sync-policy";
import {
  exportRetroplanningOnce,
  syncProjectToExternal,
  updateDriveNodeStatus,
} from "@/lib/drive/sync-service";
import { bootstrapPilotSandbox } from "@/lib/drive/tree-service";
import { createInMemoryGoogleDouble } from "../doubles/in-memory-google";

describe("Drive SyncPolicy, 61-folder tree, [EXT] sync & 002.1 lock", () => {
  let tempDir: string;
  let prisma: PrismaClient;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-sync-test-"));
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

  it("defines 61 unique internal folders and 8 unique [EXT] folders with valid parent references", () => {
    expect(INTERNAL_FOLDER_TREE.length).toBe(61);
    expect(EXTERNAL_MIRROR_TREE.length).toBe(8);

    const internalCodes = new Set(INTERNAL_FOLDER_TREE.map((f) => f.code));
    expect(internalCodes.size).toBe(61);
    for (const folder of INTERNAL_FOLDER_TREE) {
      if (folder.parentCode) {
        expect(internalCodes.has(folder.parentCode)).toBe(true);
      }
    }

    const extCodes = new Set(EXTERNAL_MIRROR_TREE.map((f) => f.code));
    expect(extCodes.size).toBe(8);
    for (const folder of EXTERNAL_MIRROR_TREE) {
      if (folder.parentCode) {
        expect(extCodes.has(folder.parentCode)).toBe(true);
      }
    }
  });

  it("locks 002.1 & 002.1.* as NO_PERMANENT_EXT_SYNC and throws 403 on assertExtSyncAllowed", () => {
    expect(getSyncPolicy("002.1").syncMode).toBe(
      SyncMode.NO_PERMANENT_EXT_SYNC
    );
    expect(getSyncPolicy("002.1.sheet").syncMode).toBe(
      SyncMode.NO_PERMANENT_EXT_SYNC
    );
    expect(getSyncPolicy("002.1").allowPermanentExtSync).toBe(false);

    expect(() => assertExtSyncAllowed("002.1")).toThrow(
      RetroplanningPermanentSyncForbiddenError
    );
    expect(() => assertExtSyncAllowed("002.1.sheet")).toThrow(
      RetroplanningPermanentSyncForbiddenError
    );
  });

  it("marks 001.*, 002.2, 003.3, 005.*, 006.1*, 006.2 as INTERNAL_ONLY and throws 403", () => {
    for (const code of [
      "001",
      "001.1",
      "001.3",
      "002.2",
      "003.3",
      "005.1",
      "005.2",
      "005.3",
      "006.1",
      "006.1.2.kalut",
      "006.2",
    ]) {
      expect(getSyncPolicy(code).syncMode).toBe(SyncMode.INTERNAL_ONLY);
      expect(() => assertExtSyncAllowed(code)).toThrow(
        InternalOnlySyncForbiddenError
      );
    }

    expect(getSyncPolicy("002.3").extMirrorCode).toBe("EXT.01");
    expect(getSyncPolicy("003.2").extMirrorCode).toBe("EXT.02");
    expect(getSyncPolicy("004.3.2.kalut.video").extMirrorCode).toBe("EXT.03.2");
    expect(getSyncPolicy("006.3").extMirrorCode).toBe("EXT.04");
  });

  it("enforces two-layer 002.1 lock, in-place files.update sync, drift detection, and manual one-off export", async () => {
    const gateway = createInMemoryGoogleDouble();
    const { project } = await bootstrapPilotSandbox(prisma, gateway.drive);

    const retroSheetNode = await prisma.driveNode.findFirstOrThrow({
      where: { projectId: project.id, code: "002.1.sheet" },
      include: { syncStatus: true },
    });

    // Reject enabling permanent sync on 002.1
    await expect(
      updateDriveNodeStatus(prisma, {
        projectId: project.id,
        nodeId: retroSheetNode.id,
        allowPermanentExtSync: true,
      })
    ).rejects.toThrow(RetroplanningPermanentSyncForbiddenError);

    // Even if validationStatus is set to VALIDE_CLIENT, permanent sync remains false and no drift
    const retroAfterStatus = await updateDriveNodeStatus(prisma, {
      projectId: project.id,
      nodeId: retroSheetNode.id,
      validationStatus: ValidationStatus.VALIDE_CLIENT,
    });
    expect(retroAfterStatus.syncStatus.allowPermanentExtSync).toBe(false);
    expect(retroAfterStatus.syncStatus.driftDetected).toBe(false);

    // Explicit sync targeting 002.1 is rejected 403
    await expect(
      syncProjectToExternal(prisma, gateway.drive, project.id, {
        nodeIds: [retroSheetNode.id],
      })
    ).rejects.toThrow(RetroplanningPermanentSyncForbiddenError);

    // Create a syncable binary file under 004.4.2.1 (Kit Com) and validate it
    const folder004421 = await prisma.driveNode.findFirstOrThrow({
      where: { projectId: project.id, code: "004.4.2.1" },
    });
    const uploaded = await gateway.drive.createFile({
      parentId: folder004421.driveFileId!,
      name: "Visuel_Annonce_V1.png",
      mimeType: "image/png",
      body: Buffer.from("png-v1"),
    });
    const assetNode = await prisma.driveNode.create({
      data: {
        projectId: project.id,
        code: "004.4.2.1.annonce_v1",
        name: "Visuel_Annonce_V1.png",
        driveFileId: uploaded.id,
        parentNodeId: folder004421.id,
        isFolder: false,
        mimeType: "image/png",
        isExtEligible: true,
        internalModifiedAt: new Date(),
      },
    });
    await prisma.syncStatus.create({
      data: {
        projectId: project.id,
        driveNodeId: assetNode.id,
        validationStatus: ValidationStatus.BROUILLON_INTERNE,
        allowPermanentExtSync: true,
      },
    });

    // Global sync while BROUILLON_INTERNE does not sync asset or 002.1
    const firstSync = await syncProjectToExternal(
      prisma,
      gateway.drive,
      project.id
    );
    expect(firstSync.syncedCount).toBe(0);

    // Validate asset -> driftDetected becomes true -> global sync copies it
    const validated = await updateDriveNodeStatus(prisma, {
      projectId: project.id,
      nodeId: assetNode.id,
      validationStatus: ValidationStatus.VALIDE_CLIENT,
    });
    expect(validated.syncStatus.driftDetected).toBe(true);

    const secondSync = await syncProjectToExternal(
      prisma,
      gateway.drive,
      project.id
    );
    expect(secondSync.syncedCount).toBe(1);
    const syncedMirrorId = secondSync.syncedNodes[0].extMirrorFileId;
    expect(secondSync.syncedNodes[0].method).toBe("files.copy");
    // 002.1 was NOT synced
    expect(
      secondSync.syncedNodes.some((s) => s.code.startsWith("002.1"))
    ).toBe(false);

    // Modify internal file -> drift -> next sync uses files.update in place (preserving mirror ID!)
    await prisma.driveNode.update({
      where: { id: assetNode.id },
      data: { internalModifiedAt: new Date(Date.now() + 5000) },
    });
    const thirdSync = await syncProjectToExternal(
      prisma,
      gateway.drive,
      project.id
    );
    expect(thirdSync.syncedCount).toBe(1);
    expect(thirdSync.syncedNodes[0].method).toBe("files.update");
    expect(thirdSync.syncedNodes[0].extMirrorFileId).toBe(syncedMirrorId);

    // Manual one-off export of 002.1 requires explicitManualExportConfirm: true
    await expect(
      exportRetroplanningOnce(prisma, gateway.drive, project.id, {
        explicitManualExportConfirm: false,
      })
    ).rejects.toThrow();

    const oneOff = await exportRetroplanningOnce(
      prisma,
      gateway.drive,
      project.id,
      { explicitManualExportConfirm: true }
    );
    expect(oneOff.exportedFileName).toContain("_Export_Ponctuel_Retroplanning.pdf");

    const retroAfterExport = await prisma.driveNode.findUniqueOrThrow({
      where: { id: retroSheetNode.id },
      include: { syncStatus: true },
    });
    expect(retroAfterExport.extMirrorFileId).toBeNull();
    expect(retroAfterExport.syncStatus?.allowPermanentExtSync).toBe(false);
  });
});
