import { google, type slides_v1 } from "googleapis";
import {
  assertSandboxWriteAllowed,
  type ParentResolver,
  type SandboxProjectContext,
} from "@/lib/google/sandbox-guard";
import type { DrivePort, SlidesPort } from "@/lib/ports";

export class SlidesAdapter implements SlidesPort {
  private readonly api: slides_v1.Slides;
  private readonly drive: DrivePort;
  private readonly resolver: ParentResolver;
  private readonly sandboxCtx: SandboxProjectContext;

  constructor(params: {
    auth: InstanceType<typeof google.auth.OAuth2>;
    drive: DrivePort;
    resolver: ParentResolver;
    sandboxCtx: SandboxProjectContext;
    rootUrl?: string;
  }) {
    this.api = google.slides({
      version: "v1",
      auth: params.auth,
      ...(params.rootUrl ? { rootUrl: params.rootUrl } : {}),
    });
    this.drive = params.drive;
    this.resolver = params.resolver;
    this.sandboxCtx = params.sandboxCtx;
  }

  async getPresentation(
    presentationId: string
  ): Promise<Record<string, unknown>> {
    const res = await this.api.presentations.get({
      presentationId,
    });
    return res.data as unknown as Record<string, unknown>;
  }

  async batchUpdate(params: {
    presentationId: string;
    requests: Record<string, unknown>[];
  }): Promise<Record<string, unknown>> {
    await assertSandboxWriteAllowed({
      operation: "slides.batchUpdate",
      targetIds: [params.presentationId],
      resolver: this.resolver,
      ctx: this.sandboxCtx,
    });

    const res = await this.api.presentations.batchUpdate({
      presentationId: params.presentationId,
      requestBody: {
        requests: params.requests as slides_v1.Schema$Request[],
      },
    });
    return res.data as unknown as Record<string, unknown>;
  }

  async duplicateSlide(params: {
    presentationId: string;
    sourceSlideId: string;
    newObjectId?: string;
    objectIdsMap?: Record<string, string>;
  }): Promise<{ duplicatedSlideId: string | null }> {
    const objectIds: Record<string, string> = {
      ...(params.objectIdsMap ?? {}),
    };
    if (params.newObjectId) {
      objectIds[params.sourceSlideId] = params.newObjectId;
    }

    const res = await this.batchUpdate({
      presentationId: params.presentationId,
      requests: [
        {
          duplicateObject: {
            objectId: params.sourceSlideId,
            ...(Object.keys(objectIds).length > 0 ? { objectIds } : {}),
          },
        },
      ],
    });

    const replies = res.replies as
      | Array<{ duplicateObject?: { objectId?: string } }>
      | undefined;
    return {
      duplicatedSlideId: replies?.[0]?.duplicateObject?.objectId ?? null,
    };
  }

  async replaceAllText(params: {
    presentationId: string;
    replacements: Array<{
      token: string;
      value: string;
      pageObjectIds?: string[];
    }>;
  }): Promise<void> {
    if (params.replacements.length === 0) return;

    const requests = params.replacements.map((r) => ({
      replaceAllText: {
        containsText: {
          text: r.token,
          matchCase: true,
        },
        replaceText: r.value,
        ...(r.pageObjectIds && r.pageObjectIds.length > 0
          ? { pageObjectIds: r.pageObjectIds }
          : {}),
      },
    }));

    await this.batchUpdate({
      presentationId: params.presentationId,
      requests,
    });
  }

  async replaceShapesWithDriveImage(params: {
    presentationId: string;
    containsText: string;
    driveFileId: string;
    replaceMethod?: "CENTER_INSIDE" | "CENTER_CROP";
    pageObjectIds?: string[];
  }): Promise<{ applied: boolean; warning?: string }> {
    await assertSandboxWriteAllowed({
      operation: "slides.replaceShapesWithDriveImage",
      targetIds: [params.presentationId],
      resolver: this.resolver,
      ctx: this.sandboxCtx,
    });

    let permissionId: string | null = null;
    try {
      const perm = await this.drive.createAnyoneReaderPermission(
        params.driveFileId
      );
      permissionId = perm.permissionId;

      const imageUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(params.driveFileId)}`;
      await this.batchUpdate({
        presentationId: params.presentationId,
        requests: [
          {
            replaceAllShapesWithImage: {
              imageUrl,
              replaceMethod: params.replaceMethod ?? "CENTER_INSIDE",
              containsText: {
                text: params.containsText,
                matchCase: true,
              },
              ...(params.pageObjectIds && params.pageObjectIds.length > 0
                ? { pageObjectIds: params.pageObjectIds }
                : {}),
            },
          },
        ],
      });
      return { applied: true };
    } catch (err) {
      const status =
        (err as { code?: number; status?: number })?.code ??
        (err as { status?: number })?.status;
      if (status === 403) {
        return {
          applied: false,
          warning: "DOMAIN_SHARING_BLOCKED",
        };
      }
      throw err;
    } finally {
      if (permissionId) {
        try {
          await this.drive.deletePermission(params.driveFileId, permissionId);
        } catch {
          // Ignore cleanup errors on temporary permission
        }
      }
    }
  }

  async embedSheetsChart(params: {
    presentationId: string;
    pageObjectId: string;
    spreadsheetId: string;
    chartId: number;
    linkingMode?: "LINKED" | "NOT_LINKED_IMAGE";
    elementProperties?: Record<string, unknown>;
  }): Promise<void> {
    await this.batchUpdate({
      presentationId: params.presentationId,
      requests: [
        {
          createSheetsChart: {
            spreadsheetId: params.spreadsheetId,
            chartId: params.chartId,
            linkingMode: params.linkingMode ?? "LINKED",
            elementProperties: {
              pageObjectId: params.pageObjectId,
              ...(params.elementProperties ?? {}),
            },
          },
        },
      ],
    });
  }

  async updateTableCells(params: {
    presentationId: string;
    tableObjectId: string;
    updates: Array<{ rowIndex: number; columnIndex: number; text: string }>;
  }): Promise<void> {
    if (params.updates.length === 0) return;

    // Inspect presentation first so we NEVER issue deleteText on an empty table cell (Slides throws 400)
    const presentation = (await this.getPresentation(
      params.presentationId
    )) as slides_v1.Schema$Presentation;

    let targetTable: slides_v1.Schema$Table | undefined;
    for (const slide of presentation.slides ?? []) {
      for (const el of slide.pageElements ?? []) {
        if (el.objectId === params.tableObjectId && el.table) {
          targetTable = el.table;
          break;
        }
      }
      if (targetTable) break;
    }

    const requests: Record<string, unknown>[] = [];
    for (const upd of params.updates) {
      const cell =
        targetTable?.tableRows?.[upd.rowIndex]?.tableCells?.[upd.columnIndex];
      const existingContent = (cell?.text?.textElements ?? [])
        .map((te) => te.textRun?.content ?? "")
        .join("");

      if (existingContent.trim().length > 0) {
        requests.push({
          deleteText: {
            objectId: params.tableObjectId,
            cellLocation: {
              rowIndex: upd.rowIndex,
              columnIndex: upd.columnIndex,
            },
            textRange: { type: "ALL" },
          },
        });
      }

      if (upd.text.length > 0) {
        requests.push({
          insertText: {
            objectId: params.tableObjectId,
            cellLocation: {
              rowIndex: upd.rowIndex,
              columnIndex: upd.columnIndex,
            },
            text: upd.text,
            insertionIndex: 0,
          },
        });
      }
    }

    if (requests.length > 0) {
      await this.batchUpdate({
        presentationId: params.presentationId,
        requests,
      });
    }
  }
}
