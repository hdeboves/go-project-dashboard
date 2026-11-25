import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DriveFileRecord, DrivePort } from "@/lib/ports";
import {
  getOrCreateKrispWebhookSecret,
  ingestKrispMeeting,
} from "@/lib/krisp/krisp-service";
import { prisma } from "@/lib/prisma";

function createFakeDrivePort(captured: Array<{ name: string; parentId: string; mimeType: string }>): DrivePort {
  const noop = async () => {
    throw new Error("not implemented");
  };
  return {
    getFileMetadata: noop,
    listFiles: noop,
    listChildren: noop,
    downloadFile: noop,
    exportFile: noop,
    bootstrapSandboxRootFolder: noop,
    createFolder: noop,
    createFile: async (params) => {
      captured.push({
        name: params.name,
        parentId: params.parentId,
        mimeType: params.mimeType,
      });
      const rec: DriveFileRecord = {
        id: "gdoc_krisp_test_001",
        name: params.name,
        mimeType: params.mimeType,
        webViewLink: "https://docs.google.com/document/d/gdoc_krisp_test_001/edit",
      };
      return rec;
    },
    updateFile: noop,
    copyFile: noop,
    deleteFile: noop,
    createAnyoneReaderPermission: noop,
    deletePermission: noop,
  };
}

describe("M5 — Krisp → Drive 002.3 CR Ingestion & Notification Pipeline", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        codeProjet: "399881",
        client: "TestBrand",
        nomJeu: "TestGame",
        isSandbox: true,
        driveInternalRootId: "root_internal_399881",
      },
    });
    projectId = project.id;

    await prisma.driveNode.create({
      data: {
        projectId,
        code: "002.3",
        name: "002.3 Comptes Rendus",
        driveFileId: "folder_002_3_399881",
        isFolder: true,
        isExtEligible: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectId } });
  });

  it("generates and persists a secure Krisp webhook secret", async () => {
    const s1 = await getOrCreateKrispWebhookSecret(prisma);
    const s2 = await getOrCreateKrispWebhookSecret(prisma);
    expect(s1.startsWith("go_krisp_")).toBe(true);
    expect(s1).toBe(s2);
  });

  it("routes Krisp meeting by CP in title, creates Google Doc in 002.3, and emits unread Notification", async () => {
    const uploaded: Array<{ name: string; parentId: string; mimeType: string }> = [];
    const fakeDrive = createFakeDrivePort(uploaded);

    const res = await ingestKrispMeeting(
      prisma,
      {
        source: "KRISP_WEBHOOK",
        title: "Point Hebdo TestBrand 399881",
        summary: "Validation des assets créa et calage planning influence.",
        durationMinutes: 25,
        participants: ["Hugo", "Client"],
        keyDecisions: ["Go prod kit com"],
        actionItems: [{ text: "Publier kit com", owner: "Hugo" }],
      },
      { drivePort: fakeDrive }
    );

    expect(res.savedToDrive).toBe(true);
    expect(res.meeting.projectId).toBe(projectId);
    expect(res.meeting.driveFileId).toBe("gdoc_krisp_test_001");
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].parentId).toBe("folder_002_3_399881");
    expect(uploaded[0].mimeType).toBe("application/vnd.google-apps.document");

    const notif = await prisma.notification.findUnique({
      where: { id: res.notificationId },
    });
    expect(notif).not.toBeNull();
    expect(notif?.read).toBe(false);
    expect(notif?.type).toBe("KRISP_CR");
    expect(notif?.driveUrl).toContain("gdoc_krisp_test_001");
  });
});
