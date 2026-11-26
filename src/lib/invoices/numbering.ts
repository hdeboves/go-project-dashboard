import type { PrismaClient } from "@prisma/client";
import { normalizeProjectCodesList } from "@/lib/invoices/accounting-email";
import { computeNextSequentialInvoiceNumber } from "@/lib/invoices/local-extractor";
import type { GoogleWorkspacePort } from "@/lib/ports";
import { getParisTodayIso } from "@/lib/shared/dates";
import { buildValidatedInvoiceFilename } from "@/lib/shared/filenames";

export interface DriveFileLike {
  name?: string | null;
  mimeType?: string | null;
  trashed?: boolean | null;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const ATTESTATION_RE = /(?:attestation|vigilance|urssaf)/i;
const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}(?:[_\s.-]|$)/;

/**
 * Returns true if a Google Drive entry inside 001.3 Factures represents an actual invoice file
 * (excluding folders, trashed files, and URSSAF vigilance attestations).
 */
export function isDriveInvoiceFile(file: DriveFileLike): boolean {
  if (file.trashed) return false;
  if (file.mimeType === FOLDER_MIME) return false;
  const name = (file.name ?? "").trim();
  if (!name) return false;
  if (ATTESTATION_RE.test(name)) return false;
  return true;
}

/**
 * Extracts the leading sequential invoice number (1, 2, 3...) from a Drive filename such as:
 * - "1_260123_StudioAlpha_2026-11-26.pdf" -> 1
 * - "03_260123_Studio_2026-11-26.pdf" -> 3
 * - "Facture_4_Studio.pdf" -> 4
 * Ignores ISO date prefixes like "2026-11-26_260123_Studio_1000EUR.pdf" -> null.
 */
export function extractInvoiceSequenceFromFilename(
  filename: string | null | undefined
): number | null {
  const name = (filename ?? "").trim();
  if (!name) return null;
  if (ISO_DATE_PREFIX_RE.test(name)) return null;

  const leadingNum = /^0*(\d{1,4})(?:[_\s.-]|$)/.exec(name);
  if (leadingNum) {
    const n = Number.parseInt(leadingNum[1], 10);
    if (Number.isSafeInteger(n) && n >= 1 && n <= 9999) {
      return n;
    }
  }

  const prefixedNum = /^(?:facture|fac|inv)[_\s#-]*0*(\d{1,4})(?:[_\s.-]|$)/i.exec(
    name
  );
  if (prefixedNum) {
    const n = Number.parseInt(prefixedNum[1], 10);
    if (Number.isSafeInteger(n) && n >= 1 && n <= 9999) {
      return n;
    }
  }

  return null;
}

/**
 * Computes the highest existing invoice sequence number based strictly on the files
 * currently present in the Google Drive 001.3 Factures folder.
 * Returns 0 when the folder is empty (so the next invoice starts at "1").
 */
export function computeDriveBaseSequence(
  files: readonly DriveFileLike[]
): number {
  const invoiceFiles = files.filter(isDriveInvoiceFile);
  if (invoiceFiles.length === 0) return 0;

  let maxExplicit = 0;
  for (const file of invoiceFiles) {
    const seq = extractInvoiceSequenceFromFilename(file.name);
    if (seq !== null && seq > maxExplicit) {
      maxExplicit = seq;
    }
  }

  return Math.max(maxExplicit, invoiceFiles.length);
}

export async function resolveDriveQuoteBaseSequence(params: {
  prisma: PrismaClient;
  projectId: string;
  getGoogleGateway?: (projectId?: string) => Promise<GoogleWorkspacePort>;
}): Promise<{ baseSeq: number; source: "drive" | "db_fallback" }> {
  const { prisma, projectId, getGoogleGateway } = params;

  const node0012 = await prisma.driveNode.findFirst({
    where: { projectId, code: "001.2" },
    select: { driveFileId: true },
  });

  if (node0012?.driveFileId && getGoogleGateway) {
    try {
      const gateway = await getGoogleGateway(projectId);
      const children = await gateway.drive.listChildren(node0012.driveFileId);
      return {
        baseSeq: computeDriveBaseSequence(children),
        source: "drive",
      };
    } catch {
      // Fallback to existing DB quotes with driveFileId
    }
  }

  const existingQuotes = await prisma.quote.findMany({
    where: { projectId },
    select: { quoteNumber: true, originalFilename: true, driveFileId: true },
  });

  const driveSyncedQuotes = existingQuotes.filter((q) => Boolean(q.driveFileId));
  const pool = driveSyncedQuotes.length > 0 ? driveSyncedQuotes : existingQuotes;
  if (pool.length === 0) {
    return { baseSeq: 0, source: "db_fallback" };
  }

  const fromNumbers =
    Number.parseInt(
      computeNextSequentialInvoiceNumber(pool.map((q) => q.quoteNumber)),
      10
    ) - 1;
  let fromFilenames = 0;
  for (const q of pool) {
    const seq = extractInvoiceSequenceFromFilename(q.originalFilename);
    if (seq !== null && seq > fromFilenames) fromFilenames = seq;
  }

  return {
    baseSeq: Math.max(0, fromNumbers, fromFilenames, pool.length),
    source: "db_fallback",
  };
}

/**
 * Resolves the highest already-filed invoice number for a project:
 * 1. Primary source of truth: actual files in Google Drive folder "001.3 Factures".
 *    If the Drive folder is empty, returns 0 (even if pending invoices were previously dropped & deleted).
 * 2. Fallback when Drive is unreachable / not connected: ONLY validated invoices already pushed to Drive
 *    (never deleted pending invoices and never stale counters).
 */
export async function resolveDriveInvoiceBaseSequence(params: {
  prisma: PrismaClient;
  projectId: string;
  getGoogleGateway?: (projectId?: string) => Promise<GoogleWorkspacePort>;
}): Promise<{ baseSeq: number; source: "drive" | "db_fallback" }> {
  const { prisma, projectId, getGoogleGateway } = params;

  const node0013 = await prisma.driveNode.findFirst({
    where: { projectId, code: "001.3" },
    select: { driveFileId: true },
  });

  if (node0013?.driveFileId && getGoogleGateway) {
    try {
      const gateway = await getGoogleGateway(projectId);
      const children = await gateway.drive.listChildren(node0013.driveFileId);
      return {
        baseSeq: computeDriveBaseSequence(children),
        source: "drive",
      };
    } catch {
      // Fall through cleanly to DB validated-invoices fallback if Google OAuth is disconnected
    }
  }

  const validatedInvoices = await prisma.invoice.findMany({
    where: {
      projectId,
      status: "VALIDATED",
      stepDriveDone: true,
    },
    select: {
      invoiceNumber: true,
      renamedFilename: true,
    },
  });

  if (validatedInvoices.length === 0) {
    return { baseSeq: 0, source: "db_fallback" };
  }

  const fromNumbers =
    Number.parseInt(
      computeNextSequentialInvoiceNumber(
        validatedInvoices.map((inv) => inv.invoiceNumber)
      ),
      10
    ) - 1;

  let fromFilenames = 0;
  for (const inv of validatedInvoices) {
    const seq = extractInvoiceSequenceFromFilename(inv.renamedFilename);
    if (seq !== null && seq > fromFilenames) {
      fromFilenames = seq;
    }
  }

  return {
    baseSeq: Math.max(0, fromNumbers, fromFilenames, validatedInvoices.length),
    source: "db_fallback",
  };
}

/**
 * Computes the next sequential invoice number for a newly uploaded pending invoice:
 * max(Drive 001.3 baseSeq, highest currently-active pending invoice of this user) + 1.
 */
export async function computeNextInvoiceNumberFromDrive(params: {
  prisma: PrismaClient;
  projectId: string;
  uploadedById?: string | null;
  getGoogleGateway?: (projectId?: string) => Promise<GoogleWorkspacePort>;
}): Promise<{ nextNumber: string; baseSeq: number; source: "drive" | "db_fallback" }> {
  const { prisma, projectId, uploadedById, getGoogleGateway } = params;
  const { baseSeq, source } = await resolveDriveInvoiceBaseSequence({
    prisma,
    projectId,
    getGoogleGateway,
  });

  const activePending = await prisma.invoice.findMany({
    where: {
      projectId,
      status: { in: ["PENDING_VALIDATION", "CONFLICT_BLOCKED"] },
      ...(uploadedById
        ? { OR: [{ uploadedById }, { uploadedById: null }] }
        : {}),
    },
    select: { invoiceNumber: true },
  });

  const maxPending =
    Number.parseInt(
      computeNextSequentialInvoiceNumber(
        activePending.map((inv) => inv.invoiceNumber)
      ),
      10
    ) - 1;

  const nextSeq = Math.max(baseSeq, maxPending) + 1;

  // Keep project.nextInvoiceSeq aligned with Drive base (never inflated by deleted drafts)
  await prisma.project
    .update({
      where: { id: projectId },
      data: { nextInvoiceSeq: baseSeq },
    })
    .catch(() => undefined);

  return {
    nextNumber: String(nextSeq),
    baseSeq,
    source,
  };
}

/**
 * Re-sequences all currently-active pending invoices for the current user on a project
 * strictly from (Drive 001.3 baseSeq + 1) upward, updating both `invoiceNumber` and
 * `renamedFilename` in DB. Called after deleting a pending invoice or when syncing the viewer.
 */
export async function resyncPendingInvoicesNumbering(params: {
  prisma: PrismaClient;
  projectId: string;
  codeProjet: string;
  uploadedById?: string | null;
  getGoogleGateway?: (projectId?: string) => Promise<GoogleWorkspacePort>;
}): Promise<{
  baseSeq: number;
  source: "drive" | "db_fallback";
  updatedInvoices: Array<{
    id: string;
    invoiceNumber: string;
    renamedFilename: string;
  }>;
}> {
  const { prisma, projectId, codeProjet, uploadedById, getGoogleGateway } =
    params;

  const { baseSeq, source } = await resolveDriveInvoiceBaseSequence({
    prisma,
    projectId,
    getGoogleGateway,
  });

  await prisma.project
    .update({
      where: { id: projectId },
      data: { nextInvoiceSeq: baseSeq },
    })
    .catch(() => undefined);

  const pendingInvoices = await prisma.invoice.findMany({
    where: {
      projectId,
      status: { in: ["PENDING_VALIDATION", "CONFLICT_BLOCKED"] },
      ...(uploadedById
        ? { OR: [{ uploadedById }, { uploadedById: null }] }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      vendorName: true,
      amountHt: true,
      projectCodesJson: true,
      renamedFilename: true,
    },
  });

  const updatedInvoices: Array<{
    id: string;
    invoiceNumber: string;
    renamedFilename: string;
  }> = [];

  for (let i = 0; i < pendingInvoices.length; i++) {
    const inv = pendingInvoices[i];
    const expectedNum = String(baseSeq + i + 1);

    let codes: string[] = [];
    if (inv.projectCodesJson) {
      try {
        const parsed = JSON.parse(inv.projectCodesJson);
        if (Array.isArray(parsed)) {
          codes = parsed.filter((c): c is string => typeof c === "string");
        }
      } catch {
        codes = [];
      }
    }
    const normalizedCodes = normalizeProjectCodesList(
      codes.length > 0 ? codes : [codeProjet],
      codeProjet
    );

    const expectedRenamed = buildValidatedInvoiceFilename({
      invoiceNumber: expectedNum,
      invoiceDate: inv.invoiceDate ?? getParisTodayIso(),
      codeProjet: normalizedCodes.join("-"),
      vendorName: inv.vendorName ?? "Prestataire",
      amountHt: inv.amountHt,
    });

    if (
      inv.invoiceNumber !== expectedNum ||
      inv.renamedFilename !== expectedRenamed
    ) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          invoiceNumber: expectedNum,
          renamedFilename: expectedRenamed,
        },
      });
    }

    updatedInvoices.push({
      id: inv.id,
      invoiceNumber: expectedNum,
      renamedFilename: expectedRenamed,
    });
  }

  return {
    baseSeq,
    source,
    updatedInvoices,
  };
}
