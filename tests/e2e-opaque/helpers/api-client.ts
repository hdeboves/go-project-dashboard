/**
 * Opaque-Box HTTP API Harness Client for GO Project Hub.
 * Uses Playwright APIRequestContext strictly against PROJECT.md § Interface Contracts.
 * Zero imports from src/ or prisma/.
 */

import type { APIRequestContext, APIResponse } from "@playwright/test";
import {
  BASE_URL,
  BOUNDARY_HARNESS_HEADER,
  BOUNDARY_SCENARIO_HEADER,
  IS_BOUNDARY_HARNESS,
} from "./constants";

export interface NormalizedApiError {
  code?: string;
  message?: string;
  setupUrl?: string;
  detectedCps?: string[];
  details?: unknown;
}

export interface ApiResult<T = unknown> {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  raw: unknown;
  data: T;
  error?: NormalizedApiError;
}

export interface BinaryApiResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  buffer: Buffer;
  error?: NormalizedApiError;
}

export interface ApiClientOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  boundaryHarness?: boolean;
  boundaryScenario?: string;
}

export interface SettingsPayload {
  googleClientId?: string;
  googleClientSecret?: string;
  geminiApiKey?: string;
  pennylaneEmail?: string;
  defaultCcEmails?: string[];
  sandboxModeEnabled?: boolean;
}

export interface ProjectCreatePayload {
  codeProjet: string;
  client: string;
  nomJeu: string;
  isSandbox?: boolean;
  talents?: string[];
  driveInternalRootId?: string;
  driveExternalRootId?: string;
  budgetSheetId?: string;
  retroplanningSheetId?: string;
  reportingSheetId?: string;
  gmailMatchRules?: Record<string, unknown>;
  brandKit?: Record<string, unknown>;
}

export interface ProjectDto {
  id: string;
  codeProjet: string;
  client: string;
  nomJeu: string;
  isSandbox?: boolean;
  driveInternalRootId?: string | null;
  driveExternalRootId?: string | null;
  budgetSheetId?: string | null;
  retroplanningSheetId?: string | null;
  reportingSheetId?: string | null;
  weeklyTemplateSlidesId?: string | null;
  reportingTemplateSlidesId?: string | null;
  calendarId?: string | null;
  [key: string]: unknown;
}

export interface DriveNodeDto {
  id: string;
  projectId: string;
  code: string;
  name: string;
  driveFileId?: string | null;
  parentNodeId?: string | null;
  isFolder?: boolean;
  mimeType?: string | null;
  isExtEligible?: boolean;
  extMirrorFileId?: string | null;
  validationStatus?: string;
  driftDetected?: boolean;
  allowPermanentExtSync?: boolean;
  lastSyncedAt?: string | null;
  internalModifiedAt?: string | null;
  contentHash?: string | null;
  [key: string]: unknown;
}

export interface BudgetLinePayload {
  id?: string;
  category: string;
  objet: string;
  realisePar?: string;
  expenseType?: "RH Internes" | "Externe" | "Amortissement" | string;
  saleQty?: number;
  saleDays?: number;
  saleUnitPrice?: number;
  saleTotalHt?: number;
  preOpUnitCost?: number;
  preOpTotalHt?: number;
  postOpQty?: number;
  postOpDays?: number;
  postOpUnitCost?: number;
  postOpTotalHt?: number;
}

export interface MultipartFileInput {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export interface RetroTaskPayload {
  id?: string;
  phase: string;
  etape: string;
  tache: string;
  owner?: string;
  startDate: string;
  endDate: string;
  status?: "A_FAIRE" | "EN_COURS" | "EN_ATTENTE_CLIENT" | "TERMINE" | string;
  isMilestone?: boolean;
  milestoneType?: "INFLUENCE" | "LANCEMENT_MAP" | "WEEKLY" | "CUSTOM" | string;
}

export interface InfluenceMetricPatchPayload {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  reposts?: number | null;
  saves?: number | null;
  engagementRate?: number | null;
  verifiedByHuman?: boolean;
}

export interface VerbatimPayload {
  authorHandle: string;
  platform: string;
  talentName?: string;
  quote: string;
  likesCount?: number;
  selectedForSlides?: boolean;
}

export interface IsolationCheckPayload {
  filename?: string;
  extractedCp?: string | null;
  rawText: string;
}

export interface SandboxProbePayload {
  operation: "create" | "update" | "delete" | "move" | "copy";
  targetId: string;
  sourceId?: string;
  parentId?: string;
  projectId?: string;
  name?: string;
}

export interface HarnessStatePayload {
  googleConnected?: boolean;
  googleClientConfigured?: boolean;
  geminiConfigured?: boolean;
  expiredToken?: boolean;
  invalidGeminiKey?: boolean;
  userEmail?: string;
  grantedScopes?: string[];
  failDriveOnCallIndex?: number | null;
  simulateExtMissingOnUpdate?: boolean;
  cronSecret?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function unwrapEnvelope<T>(raw: unknown, candidateKeys: readonly string[] = ["data"]): T {
  if (Array.isArray(raw)) {
    return raw as unknown as T;
  }
  if (!isRecord(raw)) {
    return raw as T;
  }

  for (const key of candidateKeys) {
    if (key in raw && raw[key] !== undefined) {
      return raw[key] as T;
    }
  }

  if (isRecord(raw.data)) {
    for (const key of candidateKeys) {
      if (key in raw.data && raw.data[key] !== undefined) {
        return raw.data[key] as T;
      }
    }
    return raw.data as unknown as T;
  }

  return raw as T;
}

export function normalizeError(raw: unknown): NormalizedApiError | undefined {
  if (!isRecord(raw)) {
    if (typeof raw === "string" && raw.trim().length > 0) {
      return { message: raw };
    }
    return undefined;
  }

  const errObj = isRecord(raw.error) ? raw.error : raw;
  const code =
    typeof errObj.code === "string"
      ? errObj.code
      : typeof raw.code === "string"
        ? raw.code
        : undefined;
  const message =
    typeof errObj.message === "string"
      ? errObj.message
      : typeof raw.error === "string"
        ? raw.error
        : typeof raw.message === "string"
          ? raw.message
          : typeof raw.reason === "string"
            ? raw.reason
            : undefined;
  const setupUrl =
    typeof errObj.setupUrl === "string"
      ? errObj.setupUrl
      : typeof raw.setupUrl === "string"
        ? raw.setupUrl
        : undefined;

  const detectedRaw = errObj.detectedCps ?? raw.detectedCps;
  const detectedCps = Array.isArray(detectedRaw)
    ? detectedRaw.filter((item): item is string => typeof item === "string")
    : undefined;

  if (!code && !message && !setupUrl && !detectedCps) {
    return undefined;
  }

  return {
    code,
    message,
    setupUrl,
    detectedCps,
    details: errObj.details ?? raw.details,
  };
}

async function parseResponseBody(response: APIResponse): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export interface RequestJsonOptions {
  data?: unknown;
  rawBody?: string;
  multipart?: Record<string, string | number | boolean | MultipartFileInput>;
  headers?: Record<string, string>;
  maxRedirects?: number;
}

export function createApiClient(request: APIRequestContext, options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? BASE_URL).replace(/\/$/, "");
  const useHarness = options.boundaryHarness ?? IS_BOUNDARY_HARNESS;

  const buildHeaders = (extra?: Record<string, string>): Record<string, string> => {
    const merged: Record<string, string> = {
      ...(options.defaultHeaders ?? {}),
    };
    if (useHarness) {
      merged[BOUNDARY_HARNESS_HEADER] = "1";
    }
    if (options.boundaryScenario) {
      merged[BOUNDARY_SCENARIO_HEADER] = options.boundaryScenario;
    }
    if (extra) {
      Object.assign(merged, extra);
    }
    return merged;
  };

  const resolveUrl = (path: string): string => {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  };

  async function requestJson<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    opts: RequestJsonOptions = {},
    candidateKeys: readonly string[] = ["data"]
  ): Promise<ApiResult<T>> {
    const headers = buildHeaders(opts.headers);
    const reqInit: {
      headers: Record<string, string>;
      data?: unknown;
      multipart?: Record<string, string | number | boolean | MultipartFileInput>;
      maxRedirects?: number;
    } = { headers };

    if (opts.rawBody !== undefined) {
      reqInit.data = opts.rawBody;
    } else if (opts.data !== undefined) {
      reqInit.data = opts.data;
    }
    if (opts.multipart !== undefined) {
      reqInit.multipart = opts.multipart;
    }
    if (opts.maxRedirects !== undefined) {
      reqInit.maxRedirects = opts.maxRedirects;
    }

    let response: APIResponse;
    const url = resolveUrl(path);
    switch (method) {
      case "GET":
        response = await request.get(url, reqInit);
        break;
      case "POST":
        response = await request.post(url, reqInit);
        break;
      case "PATCH":
        response = await request.patch(url, reqInit);
        break;
      case "PUT":
        response = await request.put(url, reqInit);
        break;
      case "DELETE":
        response = await request.delete(url, reqInit);
        break;
    }

    const raw = await parseResponseBody(response);
    const status = response.status();
    const ok = response.ok();
    const resHeaders = response.headers();
    const data = unwrapEnvelope<T>(raw, candidateKeys);
    const error = ok ? undefined : normalizeError(raw);

    return {
      status,
      ok,
      headers: resHeaders,
      raw,
      data,
      error,
    };
  }

  async function requestBinary(
    method: "GET" | "POST",
    path: string,
    opts: RequestJsonOptions = {}
  ): Promise<BinaryApiResult> {
    const headers = buildHeaders(opts.headers);
    const url = resolveUrl(path);
    const response =
      method === "GET"
        ? await request.get(url, { headers, maxRedirects: opts.maxRedirects })
        : await request.post(url, { headers, data: opts.data, maxRedirects: opts.maxRedirects });

    const buffer = await response.body();
    const ok = response.ok();
    let error: NormalizedApiError | undefined;
    if (!ok) {
      try {
        const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
        error = normalizeError(parsed);
      } catch {
        error = { message: buffer.toString("utf8") };
      }
    }

    return {
      status: response.status(),
      ok,
      headers: response.headers(),
      buffer,
      error,
    };
  }

  return {
    requestJson,
    requestBinary,

    // Health, Audit & Scheduler (F1, F24)
    getHealth(): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>("GET", "/api/health");
    },

    async listAuditLogs(
      projectId?: string,
      query?: { limit?: number }
    ): Promise<ApiResult<Record<string, unknown>[]>> {
      const qs = query?.limit !== undefined ? `?limit=${query.limit}` : "";
      if (projectId) {
        const scoped = await requestJson<Record<string, unknown>[]>(
          "GET",
          `/api/projects/${projectId}/audit${qs}`,
          {},
          ["logs", "auditLogs", "items", "data"]
        );
        if (scoped.status !== 404) {
          return scoped;
        }
      }
      const globalQs = new URLSearchParams();
      if (projectId) globalQs.set("projectId", projectId);
      if (query?.limit !== undefined) globalQs.set("limit", String(query.limit));
      const suffix = globalQs.toString() ? `?${globalQs.toString()}` : "";
      return requestJson<Record<string, unknown>[]>(
        "GET",
        `/api/audit${suffix}`,
        {},
        ["logs", "auditLogs", "items", "data"]
      );
    },

    async triggerSchedulerJob(
      jobType: string,
      projectId?: string,
      extraHeaders?: Record<string, string>
    ): Promise<ApiResult<Record<string, unknown>>> {
      const payload = projectId ? { job: jobType, projectId } : { job: jobType };
      const res = await requestJson<Record<string, unknown>>(
        "POST",
        "/api/cron/run",
        { data: payload, headers: extraHeaders },
        ["result", "data"]
      );
      if (res.status !== 404) {
        return res;
      }
      return requestJson<Record<string, unknown>>(
        "POST",
        "/api/scheduler/run",
        { data: payload, headers: extraHeaders },
        ["result", "data"]
      );
    },

    // Settings & OAuth2 (F2, F5, F6)
    getSettings(): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>("GET", "/api/settings", {}, ["settings", "data"]);
    },

    updateSettings(payload: SettingsPayload): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        "/api/settings",
        { data: payload },
        ["settings", "data"]
      );
    },

    testGemini(): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>("POST", "/api/settings/test-gemini", { data: {} });
    },

    startGoogleAuth(): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>("GET", "/api/auth/google/start", {
        maxRedirects: 0,
      });
    },

    callbackGoogleAuth(params: Record<string, string>): Promise<ApiResult<Record<string, unknown>>> {
      const qs = new URLSearchParams(params).toString();
      const suffix = qs ? `?${qs}` : "";
      return requestJson<Record<string, unknown>>("GET", `/api/auth/google/callback${suffix}`, {
        maxRedirects: 0,
      });
    },

    // Projects, Sandbox Bootstrap, Isolation & Talents (F3, F4, F5, F8)
    listProjects(): Promise<ApiResult<ProjectDto[]>> {
      return requestJson<ProjectDto[]>("GET", "/api/projects", {}, ["projects", "data"]);
    },

    createProject(payload: ProjectCreatePayload): Promise<ApiResult<ProjectDto>> {
      return requestJson<ProjectDto>(
        "POST",
        "/api/projects",
        { data: payload },
        ["project", "data"]
      );
    },

    bootstrapSandbox(payload?: Partial<ProjectCreatePayload>): Promise<ApiResult<ProjectDto>> {
      return requestJson<ProjectDto>(
        "POST",
        "/api/projects/bootstrap-sandbox",
        { data: payload ?? {} },
        ["project", "data"]
      );
    },

    addTalent(
      projectId: string,
      payload: { talentName: string; platforms?: string[] }
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/talents`,
        { data: payload },
        ["talent", "nodes", "data"]
      );
    },

    checkCpConflict(
      projectId: string,
      payload: IsolationCheckPayload
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/isolation/check`,
        { data: payload }
      );
    },

    // Drive Tree, [EXT] Sync & 002.1 Lock (F7, F9, F10)
    getDriveTree(projectId: string): Promise<ApiResult<DriveNodeDto[]>> {
      return requestJson<DriveNodeDto[]>(
        "GET",
        `/api/projects/${projectId}/drive`,
        {},
        ["nodes", "tree", "data"]
      );
    },

    provisionDriveTree(projectId: string): Promise<ApiResult<DriveNodeDto[]>> {
      return requestJson<DriveNodeDto[]>(
        "POST",
        `/api/projects/${projectId}/drive`,
        { data: {} },
        ["nodes", "tree", "data"]
      );
    },

    syncDriveToExt(
      projectId: string,
      payload?: { nodeIds?: string[]; force?: boolean }
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/drive/sync-ext`,
        { data: payload ?? {} }
      );
    },

    updateDriveNode(
      projectId: string,
      nodeId: string,
      payload: {
        validationStatus?: string;
        contentHash?: string;
        allowPermanentExtSync?: boolean;
        isExtEligible?: boolean;
        simulateInternalEdit?: boolean;
        [key: string]: unknown;
      }
    ): Promise<ApiResult<DriveNodeDto>> {
      return requestJson<DriveNodeDto>(
        "PATCH",
        `/api/projects/${projectId}/drive/nodes/${nodeId}`,
        { data: payload },
        ["node", "data"]
      );
    },

    exportRetroplanningOnce(
      projectId: string,
      payload: { explicitManualExportConfirm: boolean; targetFormat?: "PDF" | "COPY" }
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/retroplanning/export-once`,
        { data: payload }
      );
    },

    // Budget & Invoices (M2: F11-F14)
    getBudget(projectId: string): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>("GET", `/api/projects/${projectId}/budget`);
    },

    upsertBudgetLine(
      projectId: string,
      payload: BudgetLinePayload
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/budget`,
        { data: payload },
        ["line", "budgetLine", "data"]
      );
    },

    importBudgetXlsx(
      projectId: string,
      input: { file: MultipartFileInput } | { sourceSheetId: string }
    ): Promise<ApiResult<Record<string, unknown>>> {
      if ("file" in input) {
        return requestJson<Record<string, unknown>>(
          "POST",
          `/api/projects/${projectId}/budget/import`,
          { multipart: { file: input.file } }
        );
      }
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/budget/import`,
        { data: input }
      );
    },

    listInvoices(projectId: string): Promise<ApiResult<Record<string, unknown>[]>> {
      return requestJson<Record<string, unknown>[]>(
        "GET",
        `/api/projects/${projectId}/invoices`,
        {},
        ["invoices", "data"]
      );
    },

    uploadInvoicePdf(
      projectId: string,
      file: MultipartFileInput,
      opts?: { budgetLineId?: string; metadata?: Record<string, unknown> }
    ): Promise<ApiResult<Record<string, unknown>>> {
      const multipart: Record<string, string | number | boolean | MultipartFileInput> = { file };
      if (opts?.budgetLineId) {
        multipart.budgetLineId = opts.budgetLineId;
      }
      if (opts?.metadata) {
        multipart.metadata = JSON.stringify(opts.metadata);
      }
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/invoices`,
        { multipart },
        ["invoice", "data"]
      );
    },

    scanGmailInvoices(
      projectId: string,
      payload?: Record<string, unknown>
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/invoices/scan-gmail`,
        { data: payload ?? {} }
      );
    },

    validateInvoice(
      projectId: string,
      invoiceId: string,
      payload?: {
        budgetLineId?: string;
        vendorName?: string;
        invoiceNumber?: string;
        invoiceDate?: string;
        amountHt?: number;
        prestationSummary?: string;
        overrideCpConflict?: boolean;
      }
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/invoices/${invoiceId}/validate`,
        { data: payload ?? {} },
        ["invoice", "data"]
      );
    },

    // Retroplanning, Calendar & Weeklys (M3: F15-F19)
    getRetroplanning(projectId: string): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "GET",
        `/api/projects/${projectId}/retroplanning`
      );
    },

    createRetroTask(
      projectId: string,
      payload: RetroTaskPayload
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/retroplanning`,
        { data: payload },
        ["task", "data"]
      );
    },

    updateRetroTask(
      projectId: string,
      payload: Partial<RetroTaskPayload> & { id: string }
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "PATCH",
        `/api/projects/${projectId}/retroplanning`,
        { data: payload },
        ["task", "data"]
      );
    },

    runRetroVeille(
      projectId: string,
      payload?: Record<string, unknown>
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/retroplanning/veille`,
        { data: payload ?? {} }
      );
    },

    applyRetroProposal(
      projectId: string,
      proposalId: string,
      payload?: { action?: "APPLY" | "DISMISS" }
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/retroplanning/proposals/${proposalId}/apply`,
        { data: payload ?? { action: "APPLY" } }
      );
    },

    listRetroSnapshots(
      projectId: string,
      compare?: { fromId?: string; toId?: string }
    ): Promise<ApiResult<Record<string, unknown>>> {
      const qs = new URLSearchParams();
      if (compare?.fromId) qs.set("fromId", compare.fromId);
      if (compare?.toId) qs.set("toId", compare.toId);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return requestJson<Record<string, unknown>>(
        "GET",
        `/api/projects/${projectId}/retroplanning/snapshots${suffix}`
      );
    },

    createRetroSnapshot(
      projectId: string,
      payload?: { snapshotDate?: string }
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/retroplanning/snapshots`,
        { data: payload ?? {} },
        ["snapshot", "data"]
      );
    },

    getCalendar(projectId: string): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>("GET", `/api/projects/${projectId}/calendar`);
    },

    createCalendarResource(
      projectId: string,
      payload?: Record<string, unknown>
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/calendar`,
        { data: payload ?? {} }
      );
    },

    syncCalendarCascades(
      projectId: string,
      payload?: { retroTaskId?: string; anchorDate?: string; milestoneType?: string }
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/calendar/sync-cascades`,
        { data: payload ?? {} }
      );
    },

    listWeeklys(projectId: string): Promise<ApiResult<Record<string, unknown>[]>> {
      return requestJson<Record<string, unknown>[]>(
        "GET",
        `/api/projects/${projectId}/weeklys`,
        {},
        ["weeklys", "data"]
      );
    },

    generateWeekly(
      projectId: string,
      payload?: {
        weekStart?: string;
        weekEnd?: string;
        nextStepsClient?: string[];
        nextStepsGo?: string[];
        visualDriveIds?: string[];
      }
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/weeklys`,
        { data: payload ?? {} },
        ["weekly", "data"]
      );
    },

    // Reporting (M4: F20-F23)
    getFortniteReporting(projectId: string): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "GET",
        `/api/projects/${projectId}/reporting/fortnite`
      );
    },

    uploadFortniteReport(
      projectId: string,
      file: MultipartFileInput
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/reporting/fortnite`,
        { multipart: { file } }
      );
    },

    getInfluenceReporting(projectId: string): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "GET",
        `/api/projects/${projectId}/reporting/influence`
      );
    },

    uploadInfluenceScreenshot(
      projectId: string,
      file: MultipartFileInput,
      meta: { talentName: string; platform: string; contentUrl?: string; sparkCode?: string }
    ): Promise<ApiResult<Record<string, unknown>>> {
      const multipart: Record<string, string | number | boolean | MultipartFileInput> = {
        file,
        talentName: meta.talentName,
        platform: meta.platform,
      };
      if (meta.contentUrl) multipart.contentUrl = meta.contentUrl;
      if (meta.sparkCode) multipart.sparkCode = meta.sparkCode;
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/reporting/influence`,
        { multipart },
        ["metric", "data"]
      );
    },

    updateInfluenceMetric(
      projectId: string,
      metricId: string,
      payload: InfluenceMetricPatchPayload
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "PATCH",
        `/api/projects/${projectId}/reporting/influence/${metricId}`,
        { data: payload },
        ["metric", "data"]
      );
    },

    listVerbatims(projectId: string): Promise<ApiResult<Record<string, unknown>[]>> {
      return requestJson<Record<string, unknown>[]>(
        "GET",
        `/api/projects/${projectId}/reporting/verbatims`,
        {},
        ["verbatims", "data"]
      );
    },

    createVerbatim(
      projectId: string,
      payload: VerbatimPayload
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/reporting/verbatims`,
        { data: payload },
        ["verbatim", "data"]
      );
    },

    consolidateReporting(
      projectId: string,
      payload?: Record<string, unknown>
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/reporting/consolidate`,
        { data: payload ?? {} }
      );
    },

    exportReportingXlsx(projectId: string): Promise<BinaryApiResult> {
      return requestBinary("GET", `/api/projects/${projectId}/reporting/export-xlsx`);
    },

    generateReportingSlides(
      projectId: string,
      payload?: Record<string, unknown>
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/reporting/generate-slides`,
        { data: payload ?? {} }
      );
    },

    publishReportingExt(
      projectId: string,
      payload?: { confirmValidation?: boolean }
    ): Promise<ApiResult<Record<string, unknown>>> {
      return requestJson<Record<string, unknown>>(
        "POST",
        `/api/projects/${projectId}/reporting/publish-ext`,
        { data: payload ?? { confirmValidation: true } }
      );
    },

    // Boundary Harness Controls (active ONLY when TEST_BOUNDARY_HARNESS=1 && NODE_ENV !== "production")
    harness: {
      getCalls(): Promise<ApiResult<Record<string, unknown>[]>> {
        return requestJson<Record<string, unknown>[]>(
          "GET",
          "/api/test-harness/calls",
          {},
          ["calls", "data"]
        );
      },

      resetCalls(): Promise<ApiResult<Record<string, unknown>>> {
        return requestJson<Record<string, unknown>>("POST", "/api/test-harness/reset", {
          data: {},
        });
      },

      setState(state: HarnessStatePayload): Promise<ApiResult<Record<string, unknown>>> {
        return requestJson<Record<string, unknown>>("POST", "/api/test-harness/state", {
          data: state,
        });
      },

      restoreConfigured(): Promise<ApiResult<Record<string, unknown>>> {
        return requestJson<Record<string, unknown>>("POST", "/api/test-harness/state", {
          data: {
            googleConnected: true,
            googleClientConfigured: true,
            geminiConfigured: true,
            expiredToken: false,
            invalidGeminiKey: false,
            userEmail: "hugo.deboves@gamersorigin.com",
            failDriveOnCallIndex: null,
            simulateExtMissingOnUpdate: false,
            cronSecret: null,
          } satisfies HarnessStatePayload,
        });
      },

      setUnconfigured(opts: {
        google?: boolean;
        gemini?: boolean;
        expiredToken?: boolean;
        invalidGeminiKey?: boolean;
      }): Promise<ApiResult<Record<string, unknown>>> {
        return requestJson<Record<string, unknown>>("POST", "/api/test-harness/state", {
          data: {
            googleConnected: opts.google === true ? false : undefined,
            googleClientConfigured: opts.google === true ? false : undefined,
            geminiConfigured: opts.gemini === true ? false : undefined,
            expiredToken: opts.expiredToken,
            invalidGeminiKey: opts.invalidGeminiKey,
          },
        });
      },

      probeSandboxWrite(payload: SandboxProbePayload): Promise<ApiResult<Record<string, unknown>>> {
        return requestJson<Record<string, unknown>>("POST", "/api/test-harness/sandbox-probe", {
          data: payload,
        });
      },

      probeSandboxRead(targetId: string): Promise<ApiResult<Record<string, unknown>>> {
        return requestJson<Record<string, unknown>>("POST", "/api/test-harness/sandbox-read", {
          data: { targetId },
        });
      },

      seedDriveNode(payload: {
        projectId: string;
        parentCode: string;
        code?: string;
        name: string;
        mimeType?: string;
        validationStatus?: string;
        isFolder?: boolean;
        driveFileId?: string;
      }): Promise<ApiResult<DriveNodeDto>> {
        return requestJson<DriveNodeDto>(
          "POST",
          "/api/test-harness/seed-drive",
          { data: payload },
          ["node", "data"]
        );
      },

      simulateInternalDrift(
        projectId: string,
        nodeId: string,
        payload?: { contentHash?: string; internalModifiedAt?: string }
      ): Promise<ApiResult<DriveNodeDto>> {
        return requestJson<DriveNodeDto>(
          "POST",
          "/api/test-harness/simulate-drift",
          { data: { projectId, nodeId, ...(payload ?? {}) } },
          ["node", "data"]
        );
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
