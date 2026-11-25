import type { Invoice, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  computeBudgetMetrics,
  fromCents,
  round2,
  toCents,
} from "@/lib/budget/calculator";
import {
  colIndexToLetter,
  resolvePostOpLayoutFromMatrix,
} from "@/lib/budget/parser";
import { ensureProjectFolderNode } from "@/lib/budget/service";
import { decryptSecret } from "@/lib/crypto";
import { AppHttpError } from "@/lib/errors";
import {
  assertNoCpConflict,
  checkCodeProjetConflict,
  CpConflictError,
} from "@/lib/isolation/cp-guard";
import type { GoogleWorkspacePort } from "@/lib/ports";
import {
  normalizeInvoiceNumber,
  readStagedInvoicePdf,
} from "@/lib/invoices/ingest";
import { PROCESSED_INVOICE_GMAIL_LABEL } from "@/lib/invoices/scan-job";

export const DEFAULT_PENNYLANE_EMAIL =
  "gamersorigin-8j117x7x@suppliers.pennylane.com";
export const DEFAULT_CC_RAW = "Souléimane, Louis, Paul";

export const ValidateInvoiceSchema = z.object({
  budgetLineId: z.string().min(1).optional(),
  vendorName: z.string().trim().min(1).optional(),
  invoiceNumber: z.string().trim().min(1).optional(),
  invoiceDate: z.string().trim().min(1).optional(),
  amountHt: z.number().finite().min(0).optional(),
  tvaAmount: z.number().finite().min(0).optional(),
  amountTtc: z.number().finite().min(0).optional(),
  invoiceType: z.enum(["ACOMPTE", "SOLDE", "UNIQUE"]).optional(),
  prestationLabel: z.string().trim().min(1).optional(),
  prestationSummary: z.string().trim().min(1).optional(),
  overrideCpConflict: z.boolean().optional(),
  allowDuplicate: z.boolean().optional(),
});

export type ValidateInvoiceInput = z.infer<typeof ValidateInvoiceSchema>;

export function buildValidatedInvoiceFilename(params: {
  invoiceDate: string;
  codeProjet: string;
  vendorName: string;
  amountHt: number;
}): string {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(params.invoiceDate.trim())
    ? params.invoiceDate.trim()
    : new Date().toISOString().slice(0, 10);
  const safeCp =
    params.codeProjet.replace(/[^0-9A-Za-z-]/g, "") || "000000";
  const safePresta =
    params.vendorName
      .normalize("NFC")
      .replace(/[^a-zA-Z0-9À-ÿ-]/g, "") || "Prestataire";
  const roundedHt = round2(params.amountHt);
  const formattedHt = Number.isInteger(roundedHt)
    ? String(roundedHt)
    : roundedHt.toFixed(2);

  return `${safeDate}_${safeCp}_${safePresta}_${formattedHt}EUR.pdf`;
}

export function normalizeCcList(rawCc: string): string[] {
  const tokens = rawCc
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  return tokens.map((token) => {
    if (token.includes("@")) {
      return token;
    }
    const localSlug =
      token
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.+|\.+$/g, "") || "team";
    return `${token} <${localSlug}@gamersorigin.com>`;
  });
}

async function readSettingSafe(
  prisma: PrismaClient,
  key: string
): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row?.valueEnc) return null;
  try {
    return decryptSecret(row.valueEnc);
  } catch {
    return null;
  }
}

export async function resolvePennylaneSettings(prisma: PrismaClient): Promise<{
  to: string;
  cc: string[];
}> {
  const [rawTo, rawCc] = await Promise.all([
    readSettingSafe(prisma, "PENNYLANE_EMAIL"),
    readSettingSafe(prisma, "DEFAULT_CC_EMAILS"),
  ]);

  const to = rawTo?.trim() || DEFAULT_PENNYLANE_EMAIL;
  const cc = normalizeCcList(rawCc?.trim() || DEFAULT_CC_RAW);
  return { to, cc };
}

export function buildCumulativeInvoiceNote(
  existingNote: string | null | undefined,
  newInvoiceNumber: string | null | undefined
): string {
  const prefix = "Factures cumulées : ";
  const existingBody = (existingNote ?? "")
    .replace(/^Factures cumulées\s*:\s*/i, "")
    .trim();

  const items = existingBody
    ? existingBody
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const seen = new Set(items.map((x) => normalizeInvoiceNumber(x)));
  const cleanNew = (newInvoiceNumber ?? "").trim();
  if (cleanNew && !seen.has(normalizeInvoiceNumber(cleanNew))) {
    items.push(cleanNew);
  }

  return items.length > 0 ? `${prefix}${items.join(", ")}` : `${prefix}N/A`;
}

interface SpreadsheetMeta {
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
    };
  }>;
}

async function resolveSheetPostOpTarget(params: {
  gateway: GoogleWorkspacePort;
  spreadsheetId: string;
  lineObjet: string;
  storedRowIndex: number | null;
}): Promise<{
  sheetTitle: string;
  sheetId: number;
  row: number;
  startCol: number;
  totalCol: number;
}> {
  const { gateway, spreadsheetId, lineObjet, storedRowIndex } = params;
  let sheetTitle = "Postes de dépenses";
  let sheetId = 0;

  try {
    const meta = (await gateway.sheets.getSpreadsheet({
      spreadsheetId,
      fields: "sheets(properties(sheetId,title))",
    })) as SpreadsheetMeta;

    const sheetsList = meta?.sheets ?? [];
    if (sheetsList.length > 0) {
      const strip = (s: string) =>
        s
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
      const found =
        sheetsList.find((s) =>
          strip(s.properties?.title ?? "").includes("postes")
        ) ?? sheetsList[0];
      if (found?.properties?.title) {
        sheetTitle = found.properties.title;
      }
      if (typeof found?.properties?.sheetId === "number") {
        sheetId = found.properties.sheetId;
      }
    }
  } catch {
    // Fallback to defaults
  }

  let startCol = 15; // P (0-based)
  let totalCol = 18; // S (0-based)
  let row = storedRowIndex && storedRowIndex > 0 ? storedRowIndex : 0;

  try {
    const matrix = await gateway.sheets.getValues({
      spreadsheetId,
      range: `'${sheetTitle.replace(/'/g, "''")}'!A1:T250`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    if (matrix.length > 0) {
      const layout = resolvePostOpLayoutFromMatrix(matrix, sheetTitle, sheetId);
      if (layout) {
        startCol =
          layout.postOpQtyCol ?? Math.max(0, layout.postOpTotalCol - 3);
        totalCol = layout.postOpTotalCol;

        if (row <= 0) {
          const targetNorm = lineObjet
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();
          for (let r = layout.headerRowIndex + 1; r < matrix.length; r++) {
            const cellStr = String(matrix[r]?.[layout.objetCol] ?? "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .trim();
            if (cellStr && cellStr === targetNorm) {
              row = r + 1;
              break;
            }
          }
        }
      }
    }
  } catch {
    // Use stored/default coordinates
  }

  if (row <= 0) {
    row = 12;
  }

  return { sheetTitle, sheetId, row, startCol, totalCol };
}

export async function validateInvoicePipeline(params: {
  prisma: PrismaClient;
  getGoogleGateway: (projectId?: string) => Promise<GoogleWorkspacePort>;
  projectId: string;
  invoiceId: string;
  rawInput?: unknown;
}) {
  const { prisma, getGoogleGateway, projectId, invoiceId, rawInput } = params;
  const input = ValidateInvoiceSchema.parse(rawInput ?? {});

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const existingInvoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });
  if (!existingInvoice || existingInvoice.projectId !== projectId) {
    throw new AppHttpError(
      404,
      "INVOICE_NOT_FOUND",
      "Facture introuvable pour ce projet."
    );
  }

  // 1. Idempotency check BEFORE any external calls
  if (
    existingInvoice.status === "VALIDATED" &&
    existingInvoice.stepDriveDone &&
    existingInvoice.stepSheetDone &&
    existingInvoice.stepGmailDone
  ) {
    const lines = await prisma.budgetLine.findMany({
      where: { projectId },
      orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
    });
    const computed = computeBudgetMetrics(lines);
    return {
      ok: true,
      alreadyValidated: true,
      invoice: existingInvoice,
      pennylaneDraft: {
        draftId: existingInvoice.pennylaneDraftId,
        sent: false,
      },
      ...computed,
    };
  }

  // 2. Merge user overrides
  const vendorName = input.vendorName ?? existingInvoice.vendorName ?? "Prestataire";
  const invoiceNumber =
    input.invoiceNumber ?? existingInvoice.invoiceNumber ?? "SANS-NUM";
  const invoiceDate =
    input.invoiceDate ??
    existingInvoice.invoiceDate ??
    new Date().toISOString().slice(0, 10);
  const amountHt = round2(input.amountHt ?? existingInvoice.amountHt);
  const tvaAmount = round2(input.tvaAmount ?? existingInvoice.tvaAmount);
  const amountTtc = round2(
    input.amountTtc ??
      (existingInvoice.amountTtc > 0
        ? existingInvoice.amountTtc
        : amountHt + tvaAmount)
  );
  const invoiceType = input.invoiceType ?? existingInvoice.invoiceType;
  const prestationLabel =
    input.prestationLabel ??
    input.prestationSummary ??
    existingInvoice.prestationLabel ??
    "Prestation";
  const targetBudgetLineId =
    input.budgetLineId ?? existingInvoice.budgetLineId ?? null;

  // 3. CP Conflict Guardrail
  if (
    (existingInvoice.cpConflict ||
      existingInvoice.status === "CONFLICT_BLOCKED") &&
    !input.overrideCpConflict
  ) {
    const cpResult = checkCodeProjetConflict(
      project.codeProjet,
      existingInvoice.detectedCodeProjet,
      [
        existingInvoice.originalFilename,
        vendorName,
        invoiceNumber,
        prestationLabel,
      ].join(" ")
    );
    throw new CpConflictError(
      cpResult.hasConflict
        ? cpResult
        : {
            hasConflict: true,
            activeCp: project.codeProjet,
            detectedCps: existingInvoice.detectedCodeProjet
              ? [existingInvoice.detectedCodeProjet]
              : [],
            conflictingCps: existingInvoice.detectedCodeProjet
              ? [existingInvoice.detectedCodeProjet]
              : ["INCONNU"],
            reason: `Facture bloquée pour conflit de Code Projet (${existingInvoice.detectedCodeProjet ?? "autre projet"} ≠ ${project.codeProjet}).`,
          }
    );
  }

  if (!input.overrideCpConflict) {
    assertNoCpConflict(
      project.codeProjet,
      existingInvoice.detectedCodeProjet,
      [
        existingInvoice.originalFilename,
        vendorName,
        invoiceNumber,
        prestationLabel,
      ].join(" ")
    );
  }

  // 4. Duplicate VALIDATED invoice guard
  const normInvNum = normalizeInvoiceNumber(invoiceNumber);
  if (normInvNum && !input.allowDuplicate) {
    const validatedSiblings = await prisma.invoice.findMany({
      where: {
        projectId,
        status: "VALIDATED",
        id: { not: existingInvoice.id },
        invoiceNumber: { not: null },
      },
    });
    const dup = validatedSiblings.find(
      (s) => normalizeInvoiceNumber(s.invoiceNumber) === normInvNum
    );
    if (dup) {
      throw new AppHttpError(
        409,
        "DUPLICATE_INVOICE_VALIDATED",
        `Une facture validée avec le N° ${invoiceNumber} existe déjà sur ce projet (${dup.renamedFilename ?? dup.id}).`
      );
    }
  }

  // 5. BudgetLine check
  if (!targetBudgetLineId) {
    throw new AppHttpError(
      400,
      "BUDGET_LINE_REQUIRED",
      "Veuillez sélectionner une ligne budgétaire avant de valider."
    );
  }

  const budgetLine = await prisma.budgetLine.findUnique({
    where: { id: targetBudgetLineId },
  });
  if (!budgetLine || budgetLine.projectId !== projectId) {
    throw new AppHttpError(
      400,
      "INVALID_BUDGET_LINE",
      "Ligne budgétaire introuvable pour ce projet."
    );
  }

  // 6. Acquire Google Gateway BEFORE any DB writes (412 leaves DB untouched)
  const gateway = await getGoogleGateway(projectId);

  // 7. Load PDF bytes (staged locally or fallback to Gmail attachment)
  let pdfBuffer = await readStagedInvoicePdf(
    projectId,
    existingInvoice.id,
    existingInvoice.extractedJson
  );

  if (!pdfBuffer && existingInvoice.gmailMessageId) {
    try {
      const meta = JSON.parse(existingInvoice.extractedJson || "{}") as {
        attachmentId?: string;
      };
      if (meta.attachmentId) {
        pdfBuffer = await gateway.gmail.getAttachment({
          messageId: existingInvoice.gmailMessageId,
          attachmentId: meta.attachmentId,
        });
      }
    } catch {
      pdfBuffer = null;
    }
  }

  if (!pdfBuffer) {
    throw new AppHttpError(
      400,
      "INVOICE_PDF_MISSING",
      "Contenu PDF introuvable pour cette facture."
    );
  }

  const renamedFilename = buildValidatedInvoiceFilename({
    invoiceDate,
    codeProjet: project.codeProjet,
    vendorName,
    amountHt,
  });

  // Persist confirmed edits so partial failure retries reuse exact confirmed values
  let invoice: Invoice = await prisma.invoice.update({
    where: { id: existingInvoice.id },
    data: {
      budgetLineId: targetBudgetLineId,
      vendorName,
      invoiceNumber,
      invoiceDate,
      amountHt,
      tvaAmount,
      amountTtc,
      invoiceType,
      prestationLabel,
      renamedFilename,
    },
  });

  // STEP 1: Upload renamed PDF to 001.3 Factures
  if (!invoice.stepDriveDone || !invoice.driveFileId) {
    const folder0013 = await ensureProjectFolderNode(
      prisma,
      gateway,
      projectId,
      "001.3"
    );

    const uploaded = await gateway.drive.createFile({
      name: renamedFilename,
      parentId: folder0013.driveFileId,
      mimeType: "application/pdf",
      body: pdfBuffer,
    });

    invoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        driveFileId: uploaded.id,
        renamedFilename,
        stepDriveDone: true,
      },
    });
  }

  // STEP 2: Cumulate HT & Invoice Numbers Note in Sheet FIRST, then DB
  if (!invoice.stepSheetDone) {
    const nextPostOpTotalHt = fromCents(
      toCents(budgetLine.postOpTotalHt) + toCents(amountHt)
    );
    const nextPostOpQty = budgetLine.postOpQty > 0 ? budgetLine.postOpQty : 1;
    const nextPostOpDays =
      budgetLine.postOpDays > 0 ? budgetLine.postOpDays : 1;
    const nextPostOpUnitCost = round2(
      nextPostOpTotalHt / (nextPostOpQty * nextPostOpDays)
    );
    const nextNote = buildCumulativeInvoiceNote(
      budgetLine.invoiceNumbersNote,
      invoiceNumber
    );

    if (project.budgetSheetId) {
      const target = await resolveSheetPostOpTarget({
        gateway,
        spreadsheetId: project.budgetSheetId,
        lineObjet: budgetLine.objet,
        storedRowIndex: budgetLine.sheetRowIndex,
      });

      const escapedTitle = target.sheetTitle.replace(/'/g, "''");
      const range = `'${escapedTitle}'!${colIndexToLetter(target.startCol)}${target.row}:${colIndexToLetter(target.totalCol)}${target.row}`;

      await gateway.sheets.updateValues({
        spreadsheetId: project.budgetSheetId,
        range,
        values: [
          [nextPostOpQty, nextPostOpDays, nextPostOpUnitCost, nextPostOpTotalHt],
        ],
        valueInputOption: "USER_ENTERED",
      });

      await gateway.sheets.updateCellNote({
        spreadsheetId: project.budgetSheetId,
        sheetId: target.sheetId,
        rowIndex: target.row - 1,
        columnIndex: target.totalCol,
        note: nextNote,
      });
    }

    invoice = await prisma.$transaction(async (tx) => {
      await tx.budgetLine.update({
        where: { id: budgetLine.id },
        data: {
          postOpQty: nextPostOpQty,
          postOpDays: nextPostOpDays,
          postOpUnitCost: nextPostOpUnitCost,
          postOpTotalHt: nextPostOpTotalHt,
          invoiceNumbersNote: nextNote,
        },
      });

      return tx.invoice.update({
        where: { id: invoice.id },
        data: { stepSheetDone: true },
      });
    });
  }

  // STEP 3: Create Pennylane Gmail Draft ONLY (never send!)
  const pennylane = await resolvePennylaneSettings(prisma);
  const subject = `Facture | ${vendorName} - ${prestationLabel} | CP ${project.codeProjet}`;

  if (!invoice.stepGmailDone || !invoice.pennylaneDraftId) {
    const textBody = [
      `Bonjour,`,
      ``,
      `Veuillez trouver ci-joint la facture validée pour transmission Pennylane :`,
      `- Projet : [${project.codeProjet}] ${project.client} - ${project.nomJeu}`,
      `- Prestataire : ${vendorName}`,
      `- N° Facture : ${invoiceNumber}`,
      `- Date : ${invoiceDate}`,
      `- Prestation : ${prestationLabel}`,
      `- Montant HT : ${amountHt.toFixed(2)} €`,
      `- Montant TTC : ${amountTtc.toFixed(2)} €`,
      `- Ligne budgétaire : ${budgetLine.category} / ${budgetLine.objet}`,
      `- Fichier Drive (001.3 Factures) : ${renamedFilename}`,
      ``,
      `Cordialement,`,
      `GamersOrigin`,
    ].join("\n");

    const draft = await gateway.gmail.createDraft({
      to: pennylane.to,
      cc: pennylane.cc,
      subject,
      textBody,
      attachments: [
        {
          filename: renamedFilename,
          mimeType: "application/pdf",
          content: pdfBuffer,
        },
      ],
    });

    if (invoice.gmailMessageId) {
      try {
        const lbl = await gateway.gmail.ensureLabel(
          PROCESSED_INVOICE_GMAIL_LABEL
        );
        await gateway.gmail.modifyMessageLabels({
          messageId: invoice.gmailMessageId,
          addLabelIds: [lbl.id],
        });
      } catch {
        // Non-fatal
      }
    }

    invoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        pennylaneDraftId: draft.draftId,
        stepGmailDone: true,
        status: "VALIDATED",
      },
    });
  } else if (invoice.status !== "VALIDATED") {
    invoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "VALIDATED" },
    });
  }

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "INVOICE_VALIDATED",
      targetType: "INVOICE",
      targetId: invoice.id,
      detailsJson: JSON.stringify({
        renamedFilename: invoice.renamedFilename,
        driveFileId: invoice.driveFileId,
        pennylaneDraftId: invoice.pennylaneDraftId,
        budgetLineId: budgetLine.id,
        amountHt,
        subject,
      }),
    },
  });

  const allLines = await prisma.budgetLine.findMany({
    where: { projectId },
    orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
  });
  const computed = computeBudgetMetrics(allLines);

  return {
    ok: true,
    alreadyValidated: false,
    invoice,
    pennylaneDraft: {
      draftId: invoice.pennylaneDraftId,
      to: pennylane.to,
      cc: pennylane.cc,
      subject,
      attachmentFilename: renamedFilename,
      sent: false,
    },
    ...computed,
  };
}
