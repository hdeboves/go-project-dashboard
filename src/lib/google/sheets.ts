import { google, type sheets_v4 } from "googleapis";
import {
  assertSandboxWriteAllowed,
  type ParentResolver,
  type SandboxProjectContext,
} from "@/lib/google/sandbox-guard";
import type { SheetsPort } from "@/lib/ports";

export class SheetsAdapter implements SheetsPort {
  private readonly api: sheets_v4.Sheets;
  private readonly resolver: ParentResolver;
  private readonly sandboxCtx: SandboxProjectContext;

  constructor(params: {
    auth: InstanceType<typeof google.auth.OAuth2>;
    resolver: ParentResolver;
    sandboxCtx: SandboxProjectContext;
    rootUrl?: string;
  }) {
    this.api = google.sheets({
      version: "v4",
      auth: params.auth,
      ...(params.rootUrl ? { rootUrl: params.rootUrl } : {}),
    });
    this.resolver = params.resolver;
    this.sandboxCtx = params.sandboxCtx;
  }

  async getSpreadsheet(params: {
    spreadsheetId: string;
    ranges?: string[];
    includeGridData?: boolean;
    fields?: string;
  }): Promise<Record<string, unknown>> {
    const res = await this.api.spreadsheets.get({
      spreadsheetId: params.spreadsheetId,
      ranges: params.ranges,
      includeGridData: params.includeGridData,
      fields: params.fields,
    });
    return res.data as unknown as Record<string, unknown>;
  }

  async getValues(params: {
    spreadsheetId: string;
    range: string;
    valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
  }): Promise<unknown[][]> {
    const res = await this.api.spreadsheets.values.get({
      spreadsheetId: params.spreadsheetId,
      range: params.range,
      valueRenderOption: params.valueRenderOption,
    });
    return (res.data.values as unknown[][]) ?? [];
  }

  async updateValues(params: {
    spreadsheetId: string;
    range: string;
    values: unknown[][];
    valueInputOption?: "RAW" | "USER_ENTERED";
  }): Promise<void> {
    await assertSandboxWriteAllowed({
      operation: "sheets.values.update",
      targetIds: [params.spreadsheetId],
      resolver: this.resolver,
      ctx: this.sandboxCtx,
    });

    await this.api.spreadsheets.values.update({
      spreadsheetId: params.spreadsheetId,
      range: params.range,
      valueInputOption: params.valueInputOption ?? "USER_ENTERED",
      requestBody: {
        values: params.values,
      },
    });
  }

  async appendValues(params: {
    spreadsheetId: string;
    range: string;
    values: unknown[][];
    valueInputOption?: "RAW" | "USER_ENTERED";
  }): Promise<void> {
    await assertSandboxWriteAllowed({
      operation: "sheets.values.append",
      targetIds: [params.spreadsheetId],
      resolver: this.resolver,
      ctx: this.sandboxCtx,
    });

    await this.api.spreadsheets.values.append({
      spreadsheetId: params.spreadsheetId,
      range: params.range,
      valueInputOption: params.valueInputOption ?? "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: params.values,
      },
    });
  }

  async batchUpdate(params: {
    spreadsheetId: string;
    requests: Record<string, unknown>[];
  }): Promise<Record<string, unknown>> {
    await assertSandboxWriteAllowed({
      operation: "sheets.batchUpdate",
      targetIds: [params.spreadsheetId],
      resolver: this.resolver,
      ctx: this.sandboxCtx,
    });

    const res = await this.api.spreadsheets.batchUpdate({
      spreadsheetId: params.spreadsheetId,
      requestBody: {
        requests: params.requests as sheets_v4.Schema$Request[],
      },
    });
    return res.data as unknown as Record<string, unknown>;
  }

  async updateCellNote(params: {
    spreadsheetId: string;
    sheetId: number;
    rowIndex: number;
    columnIndex: number;
    note: string;
  }): Promise<void> {
    await this.batchUpdate({
      spreadsheetId: params.spreadsheetId,
      requests: [
        {
          updateCells: {
            range: {
              sheetId: params.sheetId,
              startRowIndex: params.rowIndex,
              endRowIndex: params.rowIndex + 1,
              startColumnIndex: params.columnIndex,
              endColumnIndex: params.columnIndex + 1,
            },
            rows: [
              {
                values: [{ note: params.note }],
              },
            ],
            fields: "note",
          },
        },
      ],
    });
  }

  async addChart(params: {
    spreadsheetId: string;
    spec: Record<string, unknown>;
  }): Promise<{ chartId: number | null }> {
    const data = await this.batchUpdate({
      spreadsheetId: params.spreadsheetId,
      requests: [
        {
          addChart: {
            chart: params.spec,
          },
        },
      ],
    });

    const replies = data.replies as
      | Array<{ addChart?: { chart?: { chartId?: number } } }>
      | undefined;
    const chartId = replies?.[0]?.addChart?.chart?.chartId ?? null;
    return { chartId };
  }
}
