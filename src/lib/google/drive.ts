import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import {
  PROD_IMMUTABLE_IDS,
  SandboxViolationError,
  assertSandboxBootstrapCreateAllowed,
  assertSandboxCopyAllowed,
  assertSandboxWriteAllowed,
  type ParentResolver,
  type SandboxProjectContext,
} from "@/lib/google/sandbox-guard";
import type {
  DriveFileListResult,
  DriveFileRecord,
  DrivePort,
} from "@/lib/ports";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const DEFAULT_FILE_FIELDS =
  "id, name, mimeType, parents, modifiedTime, md5Checksum, webViewLink, driveId, trashed";

function mapDriveFile(raw: drive_v3.Schema$File): DriveFileRecord {
  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    mimeType: raw.mimeType ?? "application/octet-stream",
    parents: raw.parents ?? undefined,
    modifiedTime: raw.modifiedTime ?? null,
    md5Checksum: raw.md5Checksum ?? null,
    webViewLink: raw.webViewLink ?? null,
    driveId: raw.driveId ?? null,
    trashed: raw.trashed ?? false,
  };
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export class DriveAdapter implements DrivePort, ParentResolver {
  private readonly api: drive_v3.Drive;
  private readonly sandboxCtx: SandboxProjectContext;

  constructor(params: {
    auth: InstanceType<typeof google.auth.OAuth2>;
    sandboxCtx: SandboxProjectContext;
    rootUrl?: string;
  }) {
    this.api = google.drive({
      version: "v3",
      auth: params.auth,
      ...(params.rootUrl ? { rootUrl: params.rootUrl } : {}),
    });
    this.sandboxCtx = params.sandboxCtx;
  }

  async getFileMetadata(
    fileId: string,
    fields = DEFAULT_FILE_FIELDS
  ): Promise<DriveFileRecord> {
    const res = await this.api.files.get({
      fileId,
      supportsAllDrives: true,
      fields,
    });
    return mapDriveFile(res.data);
  }

  async listFiles(params: {
    q?: string;
    pageSize?: number;
    pageToken?: string;
    fields?: string;
    orderBy?: string;
  }): Promise<DriveFileListResult> {
    const res = await this.api.files.list({
      q: params.q,
      pageSize: params.pageSize ?? 100,
      pageToken: params.pageToken,
      fields:
        params.fields ?? `nextPageToken, files(${DEFAULT_FILE_FIELDS})`,
      orderBy: params.orderBy,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return {
      files: (res.data.files ?? []).map(mapDriveFile),
      nextPageToken: res.data.nextPageToken ?? null,
    };
  }

  async listChildren(parentId: string): Promise<DriveFileRecord[]> {
    const all: DriveFileRecord[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.listFiles({
        q: `'${escapeDriveQueryValue(parentId)}' in parents and trashed = false`,
        pageSize: 200,
        pageToken,
      });
      all.push(...page.files);
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    return all;
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const res = await this.api.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "arraybuffer" }
    );
    return Buffer.from(res.data as ArrayBuffer);
  }

  async exportFile(fileId: string, mimeType: string): Promise<Buffer> {
    const res = await this.api.files.export(
      {
        fileId,
        mimeType,
      },
      { responseType: "arraybuffer" }
    );
    return Buffer.from(res.data as ArrayBuffer);
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

    const existing = await this.listFiles({
      q: `'${escapeDriveQueryValue(params.parentId)}' in parents and name = '${escapeDriveQueryValue(params.name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      pageSize: 5,
    });
    const folder =
      existing.files.length > 0
        ? existing.files[0]
        : mapDriveFile(
            (
              await this.api.files.create({
                supportsAllDrives: true,
                requestBody: {
                  name: params.name,
                  mimeType: FOLDER_MIME,
                  parents: [params.parentId],
                },
                fields: DEFAULT_FILE_FIELDS,
              })
            ).data
          );

    if (PROD_IMMUTABLE_IDS.has(folder.id)) {
      const err = new SandboxViolationError({
        operation: "drive.bootstrapSandboxRoots",
        targetId: folder.id,
        reason: `Le dossier bootstrap résolu pointe vers un identifiant PROD immuable (${folder.id}).`,
      });
      if (this.sandboxCtx.onViolation) {
        try {
          await this.sandboxCtx.onViolation(err);
        } catch {
          // ignore
        }
      }
      throw err;
    }

    if (folder.id && !this.sandboxCtx.allowedRootIds.includes(folder.id)) {
      this.sandboxCtx.allowedRootIds.push(folder.id);
    }
    return folder;
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

    const existing = await this.listFiles({
      q: `'${escapeDriveQueryValue(params.parentId)}' in parents and name = '${escapeDriveQueryValue(params.name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      pageSize: 5,
    });
    if (existing.files.length > 0) {
      return existing.files[0];
    }

    const res = await this.api.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: params.name,
        mimeType: FOLDER_MIME,
        parents: [params.parentId],
      },
      fields: DEFAULT_FILE_FIELDS,
    });
    return mapDriveFile(res.data);
  }

  async createFile(params: {
    name: string;
    parentId: string;
    mimeType: string;
    body: Buffer | string;
    sourceMimeType?: string;
  }): Promise<DriveFileRecord> {
    await assertSandboxWriteAllowed({
      operation: "drive.createFile",
      parentIds: [params.parentId],
      resolver: this,
      ctx: this.sandboxCtx,
    });

    const buffer =
      typeof params.body === "string"
        ? Buffer.from(params.body, "utf8")
        : params.body;

    const res = await this.api.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: params.name,
        parents: [params.parentId],
        mimeType: params.mimeType,
      },
      media: {
        mimeType: params.sourceMimeType ?? params.mimeType,
        body: Readable.from(buffer),
      },
      fields: DEFAULT_FILE_FIELDS,
    });
    return mapDriveFile(res.data);
  }

  async updateFile(params: {
    fileId: string;
    name?: string;
    mimeType?: string;
    body?: Buffer | string;
    addParents?: string;
    removeParents?: string;
  }): Promise<DriveFileRecord> {
    await assertSandboxWriteAllowed({
      operation: "drive.updateFile",
      targetIds: [params.fileId],
      parentIds: [params.addParents, params.removeParents],
      resolver: this,
      ctx: this.sandboxCtx,
    });

    const buffer =
      params.body !== undefined
        ? typeof params.body === "string"
          ? Buffer.from(params.body, "utf8")
          : params.body
        : undefined;

    const res = await this.api.files.update({
      fileId: params.fileId,
      supportsAllDrives: true,
      addParents: params.addParents,
      removeParents: params.removeParents,
      requestBody: {
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.mimeType !== undefined && !buffer
          ? { mimeType: params.mimeType }
          : {}),
      },
      ...(buffer
        ? {
            media: {
              mimeType: params.mimeType ?? "application/octet-stream",
              body: Readable.from(buffer),
            },
          }
        : {}),
      fields: DEFAULT_FILE_FIELDS,
    });
    return mapDriveFile(res.data);
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

    const res = await this.api.files.copy({
      fileId: params.sourceFileId,
      supportsAllDrives: true,
      requestBody: {
        name: params.name,
        parents: [params.destinationParentId],
      },
      fields: DEFAULT_FILE_FIELDS,
    });
    return mapDriveFile(res.data);
  }

  async deleteFile(fileId: string): Promise<void> {
    await assertSandboxWriteAllowed({
      operation: "drive.deleteFile",
      targetIds: [fileId],
      resolver: this,
      ctx: this.sandboxCtx,
    });

    await this.api.files.delete({
      fileId,
      supportsAllDrives: true,
    });
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

    const res = await this.api.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: {
        type: "anyone",
        role: "reader",
      },
      fields: "id",
    });
    return { permissionId: res.data.id ?? "" };
  }

  async deletePermission(fileId: string, permissionId: string): Promise<void> {
    await assertSandboxWriteAllowed({
      operation: "drive.permissions.delete",
      targetIds: [fileId],
      resolver: this,
      ctx: this.sandboxCtx,
    });

    await this.api.permissions.delete({
      fileId,
      permissionId,
      supportsAllDrives: true,
    });
  }
}
