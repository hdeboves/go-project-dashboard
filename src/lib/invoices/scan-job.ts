import type { Invoice, PrismaClient } from "@prisma/client";
import { AppHttpError } from "@/lib/errors";
import type { GeminiPort, GoogleWorkspacePort } from "@/lib/ports";
import { processInvoicePdfIngestion } from "@/lib/invoices/ingest";

export const PROCESSED_INVOICE_GMAIL_LABEL = "- Factures";

export interface GmailScanResult {
  ok: true;
  projectId: string;
  query: string;
  scannedCount: number;
  ingestedCount: number;
  conflictCount: number;
  skippedDuplicates: number;
  ingested: Invoice[];
  conflicts: Invoice[];
  errors: Array<{ messageId: string; filename?: string; error: string }>;
}

interface GmailMatchRules {
  customQuery?: string;
  domains?: string[];
  vendors?: string[];
  keywords?: string[];
}

function buildGmailInvoiceQuery(params: {
  codeProjet: string;
  client: string;
  nomJeu: string;
  gmailMatchRulesJson: string;
  customQuery?: string;
}): string {
  if (params.customQuery?.trim()) {
    const q = params.customQuery.trim();
    return q.includes("-label:")
      ? q
      : `${q} -label:"${PROCESSED_INVOICE_GMAIL_LABEL}"`;
  }

  let rules: GmailMatchRules = {};
  try {
    rules = JSON.parse(params.gmailMatchRulesJson || "{}") as GmailMatchRules;
  } catch {
    rules = {};
  }

  if (rules.customQuery?.trim()) {
    const q = rules.customQuery.trim();
    return q.includes("-label:")
      ? q
      : `${q} -label:"${PROCESSED_INVOICE_GMAIL_LABEL}"`;
  }

  const terms: string[] = [`"${params.codeProjet}"`, `"${params.client}"`];
  if (params.nomJeu.trim()) {
    terms.push(`"${params.nomJeu.trim()}"`);
  }
  for (const kw of rules.keywords ?? []) {
    if (kw.trim()) terms.push(`"${kw.trim()}"`);
  }
  for (const vendor of rules.vendors ?? []) {
    if (vendor.trim()) terms.push(`"${vendor.trim()}"`);
  }
  for (const domain of rules.domains ?? []) {
    if (domain.trim()) terms.push(`from:${domain.trim()}`);
  }

  return `has:attachment filename:pdf -label:"${PROCESSED_INVOICE_GMAIL_LABEL}" (${terms.join(" OR ")})`;
}

export async function scanProjectGmailInvoices(params: {
  prisma: PrismaClient;
  getGoogleGateway: (projectId?: string) => Promise<GoogleWorkspacePort>;
  getGeminiClient: () => Promise<GeminiPort>;
  projectId: string;
  maxResults?: number;
  customQuery?: string;
}): Promise<GmailScanResult> {
  const {
    prisma,
    getGoogleGateway,
    getGeminiClient,
    projectId,
    maxResults = 25,
    customQuery,
  } = params;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  // Acquire both preconditions BEFORE DB mutations
  const [gateway, gemini] = await Promise.all([
    getGoogleGateway(projectId),
    getGeminiClient(),
  ]);

  const processedLabel = await gateway.gmail.ensureLabel(
    PROCESSED_INVOICE_GMAIL_LABEL
  );

  const query = buildGmailInvoiceQuery({
    codeProjet: project.codeProjet,
    client: project.client,
    nomJeu: project.nomJeu,
    gmailMatchRulesJson: project.gmailMatchRulesJson,
    customQuery,
  });

  const listed = await gateway.gmail.listMessages({
    q: query,
    maxResults,
  });

  const existingRows = await prisma.invoice.findMany({
    where: { projectId, gmailMessageId: { not: null } },
    select: { gmailMessageId: true },
  });
  const seenMessageIds = new Set(
    existingRows
      .map((r) => r.gmailMessageId)
      .filter((id): id is string => Boolean(id))
  );

  const ingested: Invoice[] = [];
  const conflicts: Invoice[] = [];
  const errors: Array<{ messageId: string; filename?: string; error: string }> =
    [];
  let skippedDuplicates = 0;
  let scannedCount = 0;

  for (const item of listed.messages) {
    const messageId = item.id;
    if (!messageId) continue;

    if (seenMessageIds.has(messageId)) {
      skippedDuplicates++;
      continue;
    }

    const msg = await gateway.gmail.getMessage(messageId);
    if (
      msg.labelIds?.includes(processedLabel.id) ||
      msg.labelIds?.includes(PROCESSED_INVOICE_GMAIL_LABEL)
    ) {
      skippedDuplicates++;
      continue;
    }

    scannedCount++;
    const pdfAttachments = (msg.attachments ?? []).filter(
      (att) =>
        att.mimeType?.toLowerCase() === "application/pdf" ||
        /\.pdf$/i.test(att.filename ?? "")
    );

    if (pdfAttachments.length === 0) {
      continue;
    }

    let messageHandled = false;

    for (const att of pdfAttachments) {
      try {
        const pdfBuffer = await gateway.gmail.getAttachment({
          messageId,
          attachmentId: att.attachmentId,
        });

        const res = await processInvoicePdfIngestion({
          prisma,
          getGeminiClient: async () => gemini,
          project,
          pdfBuffer,
          filename: att.filename || `facture_${messageId}.pdf`,
          mimeType: att.mimeType || "application/pdf",
          emailSubject: msg.subject,
          emailBody: [msg.textBody, msg.snippet].filter(Boolean).join("\n"),
          gmailMessageId: messageId,
          attachmentId: att.attachmentId,
          quarantineOnConflictWithoutThrowing: true,
        });

        messageHandled = true;
        if (res.invoice.cpConflict || res.invoice.status === "CONFLICT_BLOCKED") {
          conflicts.push(res.invoice);
        } else {
          ingested.push(res.invoice);
        }
      } catch (err) {
        errors.push({
          messageId,
          filename: att.filename,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (messageHandled) {
      try {
        await gateway.gmail.modifyMessageLabels({
          messageId,
          addLabelIds: [processedLabel.id],
        });
      } catch {
        // Non-fatal if message labeling fails on synthetic test message
      }
      seenMessageIds.add(messageId);
    }
  }

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user:gmail-scan",
      action: "INVOICE_GMAIL_SCAN",
      targetType: "PROJECT",
      targetId: projectId,
      detailsJson: JSON.stringify({
        query,
        scannedCount,
        ingestedCount: ingested.length,
        conflictCount: conflicts.length,
        skippedDuplicates,
        errorCount: errors.length,
      }),
    },
  });

  return {
    ok: true,
    projectId,
    query,
    scannedCount,
    ingestedCount: ingested.length,
    conflictCount: conflicts.length,
    skippedDuplicates,
    ingested,
    conflicts,
    errors,
  };
}

export async function runGmailInvoiceScanJob(params: {
  prisma: PrismaClient;
  getGoogleGateway: (projectId?: string) => Promise<GoogleWorkspacePort>;
  getGeminiClient: () => Promise<GeminiPort>;
  projectId?: string;
}): Promise<{
  ok: true;
  results: Array<{
    projectId: string;
    status: "ok" | "error";
    scan?: GmailScanResult;
    error?: string;
  }>;
}> {
  const { prisma, getGoogleGateway, getGeminiClient, projectId } = params;
  const projects = projectId
    ? await prisma.project.findMany({ where: { id: projectId } })
    : await prisma.project.findMany({ orderBy: { createdAt: "asc" } });

  const results: Array<{
    projectId: string;
    status: "ok" | "error";
    scan?: GmailScanResult;
    error?: string;
  }> = [];

  for (const project of projects) {
    try {
      const scan = await scanProjectGmailInvoices({
        prisma,
        getGoogleGateway,
        getGeminiClient,
        projectId: project.id,
      });
      results.push({ projectId: project.id, status: "ok", scan });
    } catch (err) {
      results.push({
        projectId: project.id,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      projectId: projectId ?? null,
      actor: "cron:f24",
      action: "CRON_GMAIL_INVOICE_SCAN",
      targetType: "SYSTEM",
      targetId: projectId ?? "all",
      detailsJson: JSON.stringify({
        projectsCount: projects.length,
        okCount: results.filter((r) => r.status === "ok").length,
        errorCount: results.filter((r) => r.status === "error").length,
      }),
    },
  });

  return { ok: true, results };
}
