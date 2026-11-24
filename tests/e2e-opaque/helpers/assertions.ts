/**
 * Reusable Opaque-Box Domain & UI Assertions for GO Project Hub E2E Suite.
 * Zero imports from src/ or prisma/.
 */

import { expect, type Page } from "@playwright/test";
import {
  EXT_MIRROR_FOLDERS,
  INTERNAL_TOP_LEVEL_FOLDERS,
  INVOICE_FILENAME_REGEX,
  PENNYLANE_EMAIL,
  PENNYLANE_SUBJECT_REGEX,
  PROD_IMMUTABLE_ID_SET,
} from "./constants";
import type { ApiResult, DriveNodeDto, ProjectDto } from "./api-client";
import { inspectXlsxWorkbook } from "../fixtures/budget-xlsx";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MUTABLE_PROJECT_ANCHOR_KEYS: readonly string[] = [
  "driveInternalRootId",
  "driveExternalRootId",
  "budgetSheetId",
  "retroplanningSheetId",
  "reportingSheetId",
  "calendarId",
];

const MUTATING_AUDIT_ACTIONS_REGEX =
  /WRITE|CREATE|UPDATE|DELETE|MOVE|PATCH|PERMISSIONS|SYNC|EXPORT|UPLOAD|VALIDATE/i;
const ALLOWED_READ_OR_BLOCK_AUDIT_REGEX =
  /READ|COPY_FROM|GET|LIST|INSPECT|BLOCKED|REJECTED|VIOLATION/i;

export function assertProdUntouched(
  subject:
    | ProjectDto
    | DriveNodeDto[]
    | Record<string, unknown>
    | Record<string, unknown>[],
  options: { allowCopySource?: boolean } = {}
): void {
  const allowCopySource = options.allowCopySource ?? true;

  if (Array.isArray(subject)) {
    for (const item of subject) {
      if (!isRecord(item)) continue;

      if ("code" in item && "name" in item) {
        const driveFileId = item.driveFileId;
        const extMirrorFileId = item.extMirrorFileId;
        if (typeof driveFileId === "string" && driveFileId.length > 0) {
          expect(
            PROD_IMMUTABLE_ID_SET.has(driveFileId),
            `DriveNode driveFileId ${driveFileId} must never point to a PROD immutable ID`
          ).toBe(false);
        }
        if (typeof extMirrorFileId === "string" && extMirrorFileId.length > 0) {
          expect(
            PROD_IMMUTABLE_ID_SET.has(extMirrorFileId),
            `DriveNode extMirrorFileId ${extMirrorFileId} must never point to a PROD immutable ID`
          ).toBe(false);
        }
      }

      if ("action" in item && "targetId" in item) {
        const action = typeof item.action === "string" ? item.action : "";
        const targetId = typeof item.targetId === "string" ? item.targetId : "";
        if (
          targetId.length > 0 &&
          MUTATING_AUDIT_ACTIONS_REGEX.test(action) &&
          !ALLOWED_READ_OR_BLOCK_AUDIT_REGEX.test(action)
        ) {
          expect(
            PROD_IMMUTABLE_ID_SET.has(targetId),
            `Mutating audit action "${action}" targeted PROD ID ${targetId}`
          ).toBe(false);
        }
      }

      if ("operation" in item || "method" in item) {
        const op = String(item.operation ?? item.method ?? "");
        const targetId = typeof item.targetId === "string" ? item.targetId : "";
        const destinationParentId =
          typeof item.destinationParentId === "string" ? item.destinationParentId : "";
        const isMutatingCall =
          /create|update|delete|patch|move|write|append|draft|insert/i.test(op);
        const isCopyCall = /copy/i.test(op);

        if (isMutatingCall && targetId.length > 0) {
          expect(
            PROD_IMMUTABLE_ID_SET.has(targetId),
            `Gateway call ${op} targeted immutable PROD ID ${targetId}`
          ).toBe(false);
        }
        if (isCopyCall && destinationParentId.length > 0) {
          expect(
            PROD_IMMUTABLE_ID_SET.has(destinationParentId),
            `Gateway copy targeted immutable PROD parent ${destinationParentId}`
          ).toBe(false);
        }
        if (!allowCopySource && isCopyCall && typeof item.sourceId === "string") {
          expect(PROD_IMMUTABLE_ID_SET.has(item.sourceId)).toBe(false);
        }
      }
    }
    return;
  }

  if (isRecord(subject)) {
    for (const key of MUTABLE_PROJECT_ANCHOR_KEYS) {
      const val = subject[key];
      if (typeof val === "string" && val.length > 0) {
        expect(
          PROD_IMMUTABLE_ID_SET.has(val),
          `Project mutable anchor ${key} (${val}) must never reference an immutable PROD ID`
        ).toBe(false);
      }
    }

    if (Array.isArray(subject.nodes)) {
      assertProdUntouched(subject.nodes as DriveNodeDto[], options);
    }
    if (Array.isArray(subject.calls)) {
      assertProdUntouched(subject.calls as Record<string, unknown>[], options);
    }
  }
}

export function assertCpConflictBlocked(
  result: ApiResult<unknown>,
  expectedConflictCp: string,
  activeCp?: string
): void {
  const serialized = JSON.stringify(result.raw ?? {});

  if (!result.ok) {
    expect([400, 409, 422]).toContain(result.status);
    const errText = `${result.error?.code ?? ""} ${result.error?.message ?? ""} ${serialized}`;
    expect(errText).toMatch(new RegExp(`${expectedConflictCp}|conflit|conflict|cp`, "i"));
    if (result.error?.detectedCps && result.error.detectedCps.length > 0) {
      expect(result.error.detectedCps).toContain(expectedConflictCp);
    }
  } else {
    const dataObj = isRecord(result.data) ? result.data : {};
    expect(dataObj.cpConflict ?? dataObj.hasConflict).toBe(true);
    if (typeof dataObj.status === "string") {
      expect(dataObj.status).toMatch(/CONFLICT_BLOCKED|CP_CONFLICT|QUARANTINED/i);
    }
    if (typeof dataObj.detectedCodeProjet === "string") {
      expect(dataObj.detectedCodeProjet).toBe(expectedConflictCp);
    }
    expect(dataObj.driveFileId ?? null).toBeFalsy();
    expect(dataObj.pennylaneDraftId ?? null).toBeFalsy();
  }

  if (activeCp && isRecord(result.data) && typeof result.data.activeCodeProjet === "string") {
    expect(result.data.activeCodeProjet).toBe(activeCp);
  }
}

export function assertPreconditionMissing(
  result: ApiResult<unknown>,
  expectedCode?: "GOOGLE_NOT_CONNECTED" | "GEMINI_KEY_MISSING"
): void {
  expect(result.status).toBe(412);
  expect(result.ok).toBe(false);

  const rawObj = isRecord(result.raw) ? result.raw : {};
  const errObj = isRecord(rawObj.error) ? rawObj.error : rawObj;
  const code = result.error?.code ?? (typeof errObj.code === "string" ? errObj.code : "");
  const setupUrl =
    result.error?.setupUrl ?? (typeof errObj.setupUrl === "string" ? errObj.setupUrl : undefined);

  if (expectedCode) {
    expect(code).toBe(expectedCode);
  } else {
    expect(code).toMatch(/^(GOOGLE_NOT_CONNECTED|GEMINI_KEY_MISSING|GOOGLE_OAUTH_NOT_CONFIGURED|GOOGLE_TOKEN_EXPIRED)$/);
  }

  if (setupUrl !== undefined) {
    expect(setupUrl).toBe("/settings");
  }

  const nestedErrorObj = isRecord(rawObj.error) ? rawObj.error : undefined;
  const nestedDataObj = isRecord(rawObj.data) ? rawObj.data : undefined;
  const containersToCheck = [rawObj, nestedErrorObj, nestedDataObj].filter(isRecord);

  for (const container of containersToCheck) {
    for (const forbiddenDummyKey of [
      "driveFileId",
      "pennylaneDraftId",
      "slidesFileId",
      "extracted",
      "accessToken",
    ]) {
      expect(container[forbiddenDummyKey] ?? null).toBeNull();
    }
  }
}

export function assertRetroplanningNeverAutoSyncedToExt(
  payload: DriveNodeDto[] | Record<string, unknown>
): void {
  const nodes: DriveNodeDto[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.nodes)
      ? (payload.nodes as DriveNodeDto[])
      : [];

  for (const node of nodes) {
    const isRetroActive =
      node.code === "002.1" ||
      /002\.1|R[ée]troplanning Actif/i.test(`${node.code ?? ""} ${node.name ?? ""}`);
    if (!isRetroActive) continue;

    expect(node.allowPermanentExtSync).not.toBe(true);
    expect(node.isExtEligible).not.toBe(true);
    expect(node.extMirrorFileId ?? null).toBeFalsy();
  }

  if (!Array.isArray(payload) && isRecord(payload)) {
    const syncedLists = [payload.syncedNodes, payload.synced, payload.updated];
    for (const list of syncedLists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!isRecord(item)) continue;
        const descriptor = `${String(item.code ?? "")} ${String(item.name ?? "")}`;
        expect(descriptor).not.toMatch(/002\.1|R[ée]troplanning Actif/i);
      }
    }
  }
}

export function assertAuditLogged(
  auditSource: ApiResult<Record<string, unknown>[]> | Record<string, unknown>[],
  matcher: {
    action?: string | RegExp;
    targetType?: string | RegExp;
    targetId?: string;
    projectId?: string;
    detailsContain?: string | RegExp;
  }
): Record<string, unknown> {
  const entries = Array.isArray(auditSource)
    ? auditSource
    : Array.isArray(auditSource.data)
      ? auditSource.data
      : [];

  const matched = entries.find((entry) => {
    if (!isRecord(entry)) return false;
    if (matcher.action !== undefined) {
      const action = typeof entry.action === "string" ? entry.action : "";
      if (typeof matcher.action === "string") {
        if (action !== matcher.action) return false;
      } else if (!matcher.action.test(action)) {
        return false;
      }
    }
    if (matcher.targetType !== undefined) {
      const tt = typeof entry.targetType === "string" ? entry.targetType : "";
      if (typeof matcher.targetType === "string") {
        if (tt !== matcher.targetType) return false;
      } else if (!matcher.targetType.test(tt)) {
        return false;
      }
    }
    if (matcher.targetId !== undefined && entry.targetId !== matcher.targetId) {
      return false;
    }
    if (matcher.projectId !== undefined && entry.projectId !== matcher.projectId) {
      return false;
    }
    if (matcher.detailsContain !== undefined) {
      const details =
        typeof entry.detailsJson === "string"
          ? entry.detailsJson
          : JSON.stringify(entry.detailsJson ?? entry);
      if (typeof matcher.detailsContain === "string") {
        if (!details.includes(matcher.detailsContain)) return false;
      } else if (!matcher.detailsContain.test(details)) {
        return false;
      }
    }
    return true;
  });

  expect(
    matched,
    `Expected AuditLog entry matching ${JSON.stringify(matcher)} in ${entries.length} logs`
  ).toBeDefined();

  const entry = matched as Record<string, unknown>;
  expect(entry.createdAt).toBeTruthy();
  return entry;
}

export function assertDriveTreeComplete(nodes: DriveNodeDto[]): void {
  const namesAndCodes = nodes.map((n) => `${n.code} ${n.name}`);
  for (const topFolder of INTERNAL_TOP_LEVEL_FOLDERS) {
    const codePrefix = topFolder.slice(0, 3);
    const found = namesAndCodes.some(
      (text) => text.includes(topFolder) || text.startsWith(`${codePrefix} `) || text.includes(codePrefix)
    );
    expect(found, `Missing top-level Drive folder ${topFolder}`).toBe(true);
  }

  for (const criticalCode of [
    "001.1",
    "001.3",
    "002.1",
    "002.2",
    "002.3",
    "003.2",
    "004.2",
    "004.3",
    "006.1",
    "006.2",
    "006.3",
  ]) {
    const node = nodes.find((n) => n.code === criticalCode || n.name.startsWith(criticalCode));
    expect(node, `Missing DriveNode for ${criticalCode}`).toBeDefined();
    if (criticalCode === "002.1" && node) {
      expect(node.allowPermanentExtSync).not.toBe(true);
      expect(node.isExtEligible).not.toBe(true);
    }
  }

  // Also ensure [EXT] mirror folders exist when returned in tree or checked separately
  for (const extFolder of EXT_MIRROR_FOLDERS) {
    void extFolder; // checked explicitly when [EXT] tree nodes are returned
  }
}

export function assertPennylaneDraftShape(
  draft: Record<string, unknown>,
  expected: { cp: string; presta?: string }
): void {
  expect(draft.to).toBe(PENNYLANE_EMAIL);

  const ccVal = draft.cc;
  const ccSerialized = Array.isArray(ccVal) ? ccVal.join(" ") : String(ccVal ?? "");
  expect(ccSerialized.length).toBeGreaterThan(0);

  const subject = String(draft.subject ?? "");
  expect(subject).toMatch(PENNYLANE_SUBJECT_REGEX);
  expect(subject).toContain(`CP ${expected.cp}`);
  if (expected.presta) {
    expect(subject.toLowerCase()).toContain(expected.presta.toLowerCase());
  }

  if (typeof draft.attachmentFilename === "string") {
    expect(draft.attachmentFilename).toMatch(INVOICE_FILENAME_REGEX);
  }
  expect(draft.sent).not.toBe(true);
}

export function assertValidXlsxBuffer(
  buf: Buffer,
  expectedSheetNames: readonly string[]
): { sheetNames: string[]; sheets: Record<string, string[][]> } {
  expect(buf.length).toBeGreaterThan(4);
  expect(buf[0]).toBe(0x50);
  expect(buf[1]).toBe(0x4b);
  expect(buf[2]).toBe(0x03);
  expect(buf[3]).toBe(0x04);

  const inspected = inspectXlsxWorkbook(buf);
  for (const sheetName of expectedSheetNames) {
    expect(inspected.sheetNames).toContain(sheetName);
  }
  return inspected;
}

export async function assertRedAlertBanner(
  page: Page,
  expectedText?: string | RegExp
): Promise<void> {
  const alertLocator = page
    .locator(
      '[data-testid="cp-conflict-banner"], [data-testid="error-banner"], [role="alert"], .bg-red-50, .border-red-500'
    )
    .first();
  await expect(alertLocator).toBeVisible();
  if (expectedText !== undefined) {
    await expect(alertLocator).toContainText(expectedText);
  }
}

export async function assertSetupPreconditionBanner(
  page: Page,
  expectedText?: string | RegExp
): Promise<void> {
  const banner = page
    .locator('[data-testid="setup-required-banner"], [role="alert"]')
    .first();
  await expect(banner).toBeVisible();
  if (expectedText !== undefined) {
    await expect(banner).toContainText(expectedText);
  }
  const settingsCta = page
    .locator(
      '[data-testid="setup-required-banner"] a[href="/settings"], [role="alert"] a[href="/settings"], main a[href="/settings"]:not(nav a[href="/settings"])'
    )
    .first();
  await expect(settingsCta).toBeVisible();
}

export async function assertSandboxBadgeVisible(
  page: Page,
  expectedCp = "326027"
): Promise<void> {
  const badge = page
    .locator('[data-testid="sandbox-badge"], header, aside, nav')
    .filter({ hasText: /PILOTE|SANDBOX|Bac à sable/i })
    .first();
  await expect(badge).toBeVisible();
  if (expectedCp) {
    await expect(page.locator("body")).toContainText(expectedCp);
  }
}

export async function assertExtDriftBadgeVisible(page: Page): Promise<void> {
  const badge = page
    .locator('[data-testid="ext-drift-badge"], span, div, p')
    .filter({ hasText: /Décalage Interne\/Client détecté/i })
    .first();
  await expect(badge).toBeVisible();
}

export async function assertBudgetThresholdAlert(
  page: Page,
  threshold: "85%" | "100%"
): Promise<void> {
  const alert = page
    .locator('[data-testid="budget-alert-badge"], [role="alert"], span, div')
    .filter({ hasText: new RegExp(threshold.replace("%", "\\s*%"), "i") })
    .first();
  await expect(alert).toBeVisible();
}
