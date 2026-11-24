import {
  assertSandboxBootstrapCreateAllowed,
  assertSandboxCopyAllowed,
  assertSandboxWriteAllowed,
  type SandboxProjectContext,
} from "@/lib/google/sandbox-guard";
import type {
  CalendarEventItem,
  CalendarPort,
  DriveFileListResult,
  DriveFileRecord,
  DrivePort,
  GeminiPort,
  GmailMessageDetail,
  GmailPort,
  GoogleWorkspacePort,
  InfluenceVisionOutput,
  InvoiceExtractionOutput,
  RetroVeilleOutput,
  SheetsPort,
  SlidesPort,
} from "@/lib/ports";

export interface StoredDriveNode extends DriveFileRecord {
  content?: Buffer;
}

export class InMemoryDriveDouble implements DrivePort {
  private seq = 1;
  readonly files = new Map<string, StoredDriveNode>();
  readonly updateCalls: Array<{ fileId: string; name?: string }> = [];
  readonly copyCalls: Array<{ sourceFileId: string; destinationParentId: string; name: string }> = [];
  readonly createCalls: Array<{ parentId: string; name: string; mimeType: string }> = [];
  readonly exportCalls: Array<{ fileId: string; mimeType: string }> = [];

  constructor(private readonly sandboxCtx: SandboxProjectContext) {
    // Seed known PROD & container IDs so ancestry checks work realistically
    this.files.set("0AH0MevQO5Eh6Uk9PVA", {
      id: "0AH0MevQO5Eh6Uk9PVA",
      name: "13 - Projets New",
      mimeType: "application/vnd.google-apps.folder",
      parents: [],
    });
    this.files.set("1MM7Gaz-ZkJ64pqqt7rGZF56OiiWjoWyb", {
      id: "1MM7Gaz-ZkJ64pqqt7rGZF56OiiWjoWyb",
      name: "3 - Après-vente",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["0AH0MevQO5Eh6Uk9PVA"],
    });
    this.files.set("16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD", {
      id: "16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD",
      name: "Caisse d'Épargne - Fortnite",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["1MM7Gaz-ZkJ64pqqt7rGZF56OiiWjoWyb"],
    });
    this.files.set("1QUSOShHJmAlch3kP5F0RIf5txwyQ7Y6wf20A0jgCtMw", {
      id: "1QUSOShHJmAlch3kP5F0RIf5txwyQ7Y6wf20A0jgCtMw",
      name: "Budget : CE - Fortnite",
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: ["16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD"],
    });
    this.files.set("1ZG9mRIyDYDqTzJIGjGtJ4-ridgl6Cm2hqb75m1ba9XQ", {
      id: "1ZG9mRIyDYDqTzJIGjGtJ4-ridgl6Cm2hqb75m1ba9XQ",
      name: "RETROPLANNING CAISSE EPARGNE",
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: ["16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD"],
    });
    this.files.set("1C136EAzwoOUJI1DypSzBjr-vO6riZk3ncRKbI_9XAY0", {
      id: "1C136EAzwoOUJI1DypSzBjr-vO6riZk3ncRKbI_9XAY0",
      name: "Reporting Caisse d'Epargne",
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: ["16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD"],
    });
    this.files.set("1969-5uTXrKOlfOnEcYDfANfvl4trkn9wQNVPFJEckRU", {
      id: "1969-5uTXrKOlfOnEcYDfANfvl4trkn9wQNVPFJEckRU",
      name: "Reporting - Caisse d'Epargne",
      mimeType: "application/vnd.google-apps.presentation",
      parents: ["16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD"],
    });
    this.files.set("1HWSWvNiTRxINZwsPHIHAa8SvhgwpP9euh3L-h1XCMrE", {
      id: "1HWSWvNiTRxINZwsPHIHAa8SvhgwpP9euh3L-h1XCMrE",
      name: "Caisse d'Épargne - Weekly 11 septembre",
      mimeType: "application/vnd.google-apps.presentation",
      parents: ["16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD"],
    });
  }

  private nextId(prefix = "sbx"): string {
    return `${prefix}_${this.seq++}`;
  }

  async getFileMetadata(fileId: string): Promise<DriveFileRecord> {
    const found = this.files.get(fileId);
    if (!found) {
      throw new Error(`File not found in InMemoryDriveDouble: ${fileId}`);
    }
    return { ...found };
  }

  async listFiles(): Promise<DriveFileListResult> {
    return { files: Array.from(this.files.values()).map((f) => ({ ...f })) };
  }

  async listChildren(parentId: string): Promise<DriveFileRecord[]> {
    return Array.from(this.files.values())
      .filter((f) => f.parents?.includes(parentId) && !f.trashed)
      .map((f) => ({ ...f }));
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const found = this.files.get(fileId);
    return found?.content ?? Buffer.from(`content:${fileId}`, "utf8");
  }

  async exportFile(fileId: string, mimeType: string): Promise<Buffer> {
    this.exportCalls.push({ fileId, mimeType });
    return Buffer.from(`%PDF-1.4 exported:${fileId}:${mimeType}`, "utf8");
  }

  async bootstrapSandboxRootFolder(params: {
    parentId: string;
    name: string;
  }): Promise<DriveFileRecord> {
    await assertSandboxBootstrapCreateAllowed({
      parentId: params.parentId,
      folderName: params.name,
      onViolation: this.sandboxCtx.onViolation,
    });

    const existing = Array.from(this.files.values()).find(
      (f) =>
        f.parents?.includes(params.parentId) &&
        f.name === params.name &&
        !f.trashed
    );
    if (existing) {
      if (!this.sandboxCtx.allowedRootIds.includes(existing.id)) {
        this.sandboxCtx.allowedRootIds.push(existing.id);
      }
      return { ...existing };
    }

    const id = this.nextId("root");
    const rec: StoredDriveNode = {
      id,
      name: params.name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [params.parentId],
      modifiedTime: new Date().toISOString(),
    };
    this.files.set(id, rec);
    this.sandboxCtx.allowedRootIds.push(id);
    return { ...rec };
  }

  async createFolder(params: {
    name: string;
    parentId: string;
  }): Promise<DriveFileRecord> {
    await assertSandboxWriteAllowed({
      operation: "drive.createFolder",
      parentIds: [params.parentId],
      resolver: this,
      ctx: this.sandboxCtx,
    });

    const existing = Array.from(this.files.values()).find(
      (f) =>
        f.parents?.includes(params.parentId) &&
        f.name === params.name &&
        f.mimeType === "application/vnd.google-apps.folder" &&
        !f.trashed
    );
    if (existing) return { ...existing };

    const id = this.nextId("fld");
    const rec: StoredDriveNode = {
      id,
      name: params.name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [params.parentId],
      modifiedTime: new Date().toISOString(),
    };
    this.files.set(id, rec);
    return { ...rec };
  }

  async createFile(params: {
    name: string;
    parentId: string;
    mimeType: string;
    body: Buffer | string;
  }): Promise<DriveFileRecord> {
    await assertSandboxWriteAllowed({
      operation: "drive.createFile",
      parentIds: [params.parentId],
      resolver: this,
      ctx: this.sandboxCtx,
    });

    const id = this.nextId("file");
    const content =
      typeof params.body === "string"
        ? Buffer.from(params.body, "utf8")
        : params.body;
    const rec: StoredDriveNode = {
      id,
      name: params.name,
      mimeType: params.mimeType,
      parents: [params.parentId],
      modifiedTime: new Date().toISOString(),
      content,
    };
    this.files.set(id, rec);
    this.createCalls.push({
      parentId: params.parentId,
      name: params.name,
      mimeType: params.mimeType,
    });
    return { ...rec };
  }

  async updateFile(params: {
    fileId: string;
    name?: string;
    mimeType?: string;
    body?: Buffer | string;
  }): Promise<DriveFileRecord> {
    await assertSandboxWriteAllowed({
      operation: "drive.updateFile",
      targetIds: [params.fileId],
      resolver: this,
      ctx: this.sandboxCtx,
    });

    const existing = this.files.get(params.fileId);
    if (!existing) {
      throw new Error(`Missing file ${params.fileId}`);
    }
    if (params.name !== undefined) existing.name = params.name;
    if (params.mimeType !== undefined) existing.mimeType = params.mimeType;
    if (params.body !== undefined) {
      existing.content =
        typeof params.body === "string"
          ? Buffer.from(params.body, "utf8")
          : params.body;
    }
    existing.modifiedTime = new Date().toISOString();
    this.updateCalls.push({ fileId: params.fileId, name: params.name });
    return { ...existing };
  }

  async copyFile(params: {
    sourceFileId: string;
    destinationParentId: string;
    name: string;
  }): Promise<DriveFileRecord> {
    await assertSandboxCopyAllowed({
      operation: "drive.copyFile",
      sourceFileId: params.sourceFileId,
      destinationParentId: params.destinationParentId,
      resolver: this,
      ctx: this.sandboxCtx,
    });

    const src = this.files.get(params.sourceFileId);
    const id = this.nextId("copy");
    const rec: StoredDriveNode = {
      id,
      name: params.name,
      mimeType: src?.mimeType ?? "application/octet-stream",
      parents: [params.destinationParentId],
      modifiedTime: new Date().toISOString(),
      content: src?.content ?? Buffer.from(`copied:${params.sourceFileId}`),
    };
    this.files.set(id, rec);
    this.copyCalls.push(params);
    return { ...rec };
  }

  async deleteFile(fileId: string): Promise<void> {
    await assertSandboxWriteAllowed({
      operation: "drive.deleteFile",
      targetIds: [fileId],
      resolver: this,
      ctx: this.sandboxCtx,
    });
    this.files.delete(fileId);
  }

  async createAnyoneReaderPermission(
    fileId: string
  ): Promise<{ permissionId: string }> {
    await assertSandboxWriteAllowed({
      operation: "drive.permissions.create",
      targetIds: [fileId],
      resolver: this,
      ctx: this.sandboxCtx,
    });
    return { permissionId: `perm_${fileId}` };
  }

  async deletePermission(fileId: string): Promise<void> {
    await assertSandboxWriteAllowed({
      operation: "drive.permissions.delete",
      targetIds: [fileId],
      resolver: this,
      ctx: this.sandboxCtx,
    });
  }
}

export function createInMemoryGoogleDouble(
  allowedRootIds: string[] = []
): GoogleWorkspacePort & { drive: InMemoryDriveDouble } {
  const sandboxCtx: SandboxProjectContext = {
    allowedRootIds: [...allowedRootIds],
  };
  const drive = new InMemoryDriveDouble(sandboxCtx);

  const sheets: SheetsPort = {
    async getSpreadsheet() {
      return {};
    },
    async getValues() {
      return [];
    },
    async updateValues() {},
    async appendValues() {},
    async batchUpdate() {
      return {};
    },
    async updateCellNote() {},
    async addChart() {
      return { chartId: 1 };
    },
  };

  const slides: SlidesPort = {
    async getPresentation() {
      return { slides: [] };
    },
    async batchUpdate() {
      return {};
    },
    async duplicateSlide() {
      return { duplicatedSlideId: "slide_copy" };
    },
    async replaceAllText() {},
    async replaceShapesWithDriveImage() {
      return { applied: true };
    },
    async embedSheetsChart() {},
    async updateTableCells() {},
  };

  const gmail: GmailPort = {
    async listMessages() {
      return { messages: [] };
    },
    async getMessage(id): Promise<GmailMessageDetail> {
      return {
        id,
        subject: "",
        from: "",
        to: "",
        date: "",
        snippet: "",
        textBody: "",
        htmlBody: "",
        labelIds: [],
        attachments: [],
      };
    },
    async getAttachment() {
      return Buffer.alloc(0);
    },
    async listLabels() {
      return [];
    },
    async ensureLabel(name) {
      return { id: `lbl_${name}`, name };
    },
    async modifyMessageLabels() {},
    async createDraft() {
      return { draftId: "draft_1", messageId: "msg_1" };
    },
  };

  const calendar: CalendarPort = {
    async createSecondaryCalendar(params) {
      return { calendarId: `cal_${Date.now()}`, summary: params.summary };
    },
    async shareCalendar() {
      return { ruleId: "rule_1" };
    },
    async listEvents(): Promise<CalendarEventItem[]> {
      return [];
    },
    async insertEvent() {
      return { eventId: "evt_1" };
    },
    async patchEvent(params) {
      return { eventId: params.eventId };
    },
    async deleteEvent() {},
  };

  return {
    userEmail: "test-sandbox@gamersorigin.com",
    drive,
    sheets,
    slides,
    gmail,
    calendar,
  };
}

export function createInMemoryGeminiDouble(): GeminiPort {
  return {
    async ping() {
      return { ok: true, model: "gemini-2.5-flash", latencyMs: 12 };
    },
    async extractInvoiceFromPdf(): Promise<InvoiceExtractionOutput> {
      return {
        prestataire: "Studio Test",
        numeroFacture: "F-001",
        dateFacture: "2026-11-24",
        montantHT: 1000,
        tvaRate: 20,
        montantTTC: 1200,
        typeFacture: "UNIQUE",
        codeProjetDetecte: "326027",
        prestationSummary: "Prestation test",
        suggestedBudgetLineId: null,
        suggestedBudgetLineLabel: null,
        confidence: 0.99,
        rawWarnings: [],
        extractedRawTextSnippet: "CP 326027",
      };
    },
    async analyzeRetroplanningVeille(): Promise<RetroVeilleOutput> {
      return { proposals: [] };
    },
    async extractInfluenceMetricsFromImage(): Promise<InfluenceVisionOutput> {
      return {
        detectedPlatform: "TIKTOK",
        views: 1000,
        likes: 100,
        comments: 10,
        shares: 5,
        reposts: 0,
        saves: 5,
        engagementRate: 12,
        detectedHandleOrCaption: "@talent",
        fieldConfidence: {},
        extractionNotes: [],
      };
    },
  };
}
