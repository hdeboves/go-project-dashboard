import type { BudgetLine, PrismaClient, Project } from "@prisma/client";
import { z } from "zod";
import {
  type BudgetComputationResult,
  computeBudgetMetrics,
  normalizeExpenseType,
  round2,
  toResourceTypeOption,
} from "@/lib/budget/calculator";
import {
  type ParsedBudgetLine,
  buildCanonicalPostesMatrix,
  colIndexToLetter,
  parseBudgetSheetMatrices,
  parseBudgetXlsxBuffer,
  resolvePostOpLayoutFromMatrix,
} from "@/lib/budget/parser";
import {
  type BudgetSyncDirection,
  decideBudgetSyncDirection,
} from "@/lib/budget/sync-direction";
import { provisionProjectTree } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import type { GoogleWorkspacePort } from "@/lib/ports";

export const UpsertBudgetLineSchema = z.object({
  id: z.string().min(1).optional(),
  category: z.string().trim().min(1, "La catégorie est requise."),
  objet: z.string().trim().min(1, "L'objet de la ligne est requis."),
  realisePar: z.string().trim().nullable().optional(),
  expenseType: z.string().trim().optional(),
  saleQty: z.number().finite().min(0).optional(),
  saleDays: z.number().finite().min(0).optional(),
  saleUnitPrice: z.number().finite().min(0).optional(),
  saleTotalHt: z.number().finite().min(0).optional(),
  preOpUnitCost: z.number().finite().min(0).optional(),
  preOpTotalHt: z.number().finite().min(0).optional(),
  postOpQty: z.number().finite().min(0).optional(),
  postOpDays: z.number().finite().min(0).optional(),
  postOpUnitCost: z.number().finite().min(0).optional(),
  postOpTotalHt: z.number().finite().min(0).optional(),
  marginPct: z.number().finite().min(0).max(95).nullable().optional(),
  sheetRowIndex: z.number().int().positive().nullable().optional(),
  invoiceNumbersNote: z.string().nullable().optional(),
});

export type UpsertBudgetLineInput = z.infer<typeof UpsertBudgetLineSchema>;

export interface FnpAlertItem {
  quoteId: string;
  quoteNumber: string;
  vendorName: string;
  amountHt: number;
  invoicedHt: number;
  remainingHt: number;
  issueDate: string | null;
  validUntil: string | null;
  budgetLineObjet: string | null;
}

export interface BudgetSyncMeta {
  lastSyncedAt: string | null;
  lastSheetModifiedAt: string | null;
  localModifiedAt: string | null;
  hasPendingLocalChanges: boolean;
}

export interface BudgetSyncResultInfo {
  direction: BudgetSyncDirection;
  reason: string;
  sheetModifiedAt: string | null;
  siteModifiedAt: string | null;
}

export interface BudgetOverviewResponse extends BudgetComputationResult {
  budgetSheetId: string | null;
  lines: Array<BudgetLine & { committedHt?: number }>;
  fnpAlerts?: FnpAlertItem[];
  syncMeta?: BudgetSyncMeta;
  syncResult?: BudgetSyncResultInfo;
  warnings: string[];
}

function normalizeLineKey(category: string, objet: string): string {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  return `${norm(category)}::${norm(objet)}`;
}

async function requireProject(
  prisma: PrismaClient,
  projectId: string
): Promise<Project> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }
  return project;
}

export async function ensureProjectFolderNode(
  prisma: PrismaClient,
  gateway: GoogleWorkspacePort,
  projectId: string,
  code: "001.1" | "001.3"
): Promise<{ id: string; driveFileId: string }> {
  let node = await prisma.driveNode.findFirst({
    where: { projectId, code },
  });

  if (!node?.driveFileId) {
    await provisionProjectTree(prisma, gateway.drive, projectId);
    node = await prisma.driveNode.findFirst({
      where: { projectId, code },
    });
  }

  if (!node?.driveFileId) {
    throw new AppHttpError(
      400,
      "DRIVE_TREE_NOT_PROVISIONED",
      `Dossier Drive ${code} introuvable pour ce projet.`
    );
  }

  return { id: node.id, driveFileId: node.driveFileId };
}

async function upsertBudgetDriveNode(
  prisma: PrismaClient,
  params: {
    projectId: string;
    name: string;
    driveFileId: string;
    parentNodeId: string;
  }
): Promise<void> {
  const existing = await prisma.driveNode.findFirst({
    where: { projectId: params.projectId, code: "001.1.budget" },
  });

  const node = existing
    ? await prisma.driveNode.update({
        where: { id: existing.id },
        data: {
          name: params.name,
          driveFileId: params.driveFileId,
          parentNodeId: params.parentNodeId,
          isFolder: false,
          mimeType: "application/vnd.google-apps.spreadsheet",
          isExtEligible: false,
        },
      })
    : await prisma.driveNode.create({
        data: {
          projectId: params.projectId,
          code: "001.1.budget",
          name: params.name,
          driveFileId: params.driveFileId,
          parentNodeId: params.parentNodeId,
          isFolder: false,
          mimeType: "application/vnd.google-apps.spreadsheet",
          isExtEligible: false,
        },
      });

  await prisma.syncStatus.upsert({
    where: { driveNodeId: node.id },
    update: { allowPermanentExtSync: false },
    create: {
      projectId: params.projectId,
      driveNodeId: node.id,
      validationStatus: "BROUILLON_INTERNE",
      driftDetected: false,
      allowPermanentExtSync: false,
    },
  });
}

async function computeLocalBudgetModifiedAt(
  prisma: PrismaClient,
  projectId: string,
  lines?: ReadonlyArray<{ updatedAt: Date }>
): Promise<Date | null> {
  const [maxLineUpdated, latestAudit] = await Promise.all([
    lines
      ? Promise.resolve(
          lines.reduce<Date | null>(
            (max, l) => (!max || l.updatedAt > max ? l.updatedAt : max),
            null
          )
        )
      : prisma.budgetLine
          .aggregate({
            where: { projectId },
            _max: { updatedAt: true },
          })
          .then((r) => r._max.updatedAt),
    prisma.auditLog.findFirst({
      where: {
        projectId,
        action: {
          in: [
            "BUDGET_LINE_UPSERTED",
            "BUDGET_LINE_DELETED",
            "INVOICE_VALIDATED",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const a = maxLineUpdated?.getTime() ?? 0;
  const b = latestAudit?.createdAt.getTime() ?? 0;
  const maxMs = Math.max(a, b);
  return maxMs > 0 ? new Date(maxMs) : null;
}

async function recordBudgetSyncBaseline(params: {
  prisma: PrismaClient;
  projectId: string;
  sheetId: string;
  sheetModifiedAt: Date | null;
}): Promise<void> {
  const { prisma, projectId, sheetId, sheetModifiedAt } = params;
  // Slightly advance lastSyncedAt (+500ms) so DB rows just reconciled during PULL
  // are never mistaken for subsequent local edits on the site.
  const syncedNow = new Date(Date.now() + 500);
  const existingNode = await prisma.driveNode.findFirst({
    where: { projectId, code: "001.1.budget" },
    select: { id: true },
  });

  if (existingNode) {
    await prisma.driveNode.update({
      where: { id: existingNode.id },
      data: {
        driveFileId: sheetId,
        lastSyncedAt: syncedNow,
        internalModifiedAt: sheetModifiedAt ?? syncedNow,
      },
    });
  } else {
    await prisma.driveNode.create({
      data: {
        projectId,
        code: "001.1.budget",
        name: "Budget",
        driveFileId: sheetId,
        isFolder: false,
        mimeType: "application/vnd.google-apps.spreadsheet",
        isExtEligible: false,
        lastSyncedAt: syncedNow,
        internalModifiedAt: sheetModifiedAt ?? syncedNow,
      },
    });
  }
}

async function fetchSheetModifiedTime(
  gateway: GoogleWorkspacePort,
  spreadsheetId: string
): Promise<Date | null> {
  try {
    const meta = await gateway.drive.getFileMetadata(
      spreadsheetId,
      "id,name,modifiedTime"
    );
    if (meta.modifiedTime) {
      const parsed = new Date(meta.modifiedTime);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  } catch {
    // Non-fatal fallback
  }
  return null;
}

async function reconcileBudgetLines(
  prisma: PrismaClient,
  projectId: string,
  parsedLines: ParsedBudgetLine[]
): Promise<BudgetLine[]> {
  return prisma.$transaction(async (tx) => {
    const existingLines = await tx.budgetLine.findMany({
      where: { projectId },
      orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
    });

    const buckets = new Map<string, BudgetLine[]>();
    for (const row of existingLines) {
      const key = normalizeLineKey(row.category, row.objet);
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }

    const matchedIds = new Set<string>();

    for (const parsed of parsedLines) {
      const key = normalizeLineKey(parsed.category, parsed.objet);
      const queue = buckets.get(key);
      const match = queue?.shift();

      if (match) {
        matchedIds.add(match.id);
        await tx.budgetLine.update({
          where: { id: match.id },
          data: {
            category: parsed.category,
            objet: parsed.objet,
            realisePar: parsed.realisePar,
            expenseType: parsed.expenseType,
            saleQty: parsed.saleQty,
            saleDays: parsed.saleDays,
            saleUnitPrice: parsed.saleUnitPrice,
            saleTotalHt: parsed.saleTotalHt,
            preOpUnitCost: parsed.preOpUnitCost,
            preOpTotalHt: parsed.preOpTotalHt,
            postOpQty: parsed.postOpQty,
            postOpDays: parsed.postOpDays,
            postOpUnitCost: parsed.postOpUnitCost,
            postOpTotalHt: parsed.postOpTotalHt,
            sheetRowIndex: parsed.sheetRowIndex,
            invoiceNumbersNote:
              parsed.invoiceNumbersNote ?? match.invoiceNumbersNote,
          },
        });
      } else {
        await tx.budgetLine.create({
          data: {
            projectId,
            category: parsed.category,
            objet: parsed.objet,
            realisePar: parsed.realisePar,
            expenseType: parsed.expenseType,
            saleQty: parsed.saleQty,
            saleDays: parsed.saleDays,
            saleUnitPrice: parsed.saleUnitPrice,
            saleTotalHt: parsed.saleTotalHt,
            preOpUnitCost: parsed.preOpUnitCost,
            preOpTotalHt: parsed.preOpTotalHt,
            postOpQty: parsed.postOpQty,
            postOpDays: parsed.postOpDays,
            postOpUnitCost: parsed.postOpUnitCost,
            postOpTotalHt: parsed.postOpTotalHt,
            sheetRowIndex: parsed.sheetRowIndex,
            invoiceNumbersNote: parsed.invoiceNumbersNote,
          },
        });
      }
    }

    const toDeleteIds = existingLines
      .filter((r) => !matchedIds.has(r.id))
      .map((r) => r.id);

    if (toDeleteIds.length > 0) {
      await tx.budgetLine.deleteMany({
        where: { id: { in: toDeleteIds }, projectId },
      });
    }

    return tx.budgetLine.findMany({
      where: { projectId },
      orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
    });
  });
}

export async function getProjectBudget(
  prisma: PrismaClient,
  projectId: string
): Promise<BudgetOverviewResponse> {
  const project = await requireProject(prisma, projectId);
  const [lines, quotes, budgetNode] = await Promise.all([
    prisma.budgetLine.findMany({
      where: { projectId },
      orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
    }),
    prisma.quote.findMany({
      where: {
        projectId,
        status: { in: ["ACCEPTE", "FACTURE"] },
      },
      select: {
        id: true,
        quoteNumber: true,
        vendorName: true,
        amountHt: true,
        issueDate: true,
        validUntil: true,
        budgetLineId: true,
        createdAt: true,
        budgetLine: { select: { objet: true } },
        invoices: {
          where: { status: { notIn: ["REJECTED", "CONFLICT_BLOCKED"] } },
          select: { amountHt: true },
        },
      },
    }),
    prisma.driveNode.findFirst({
      where: { projectId, code: "001.1.budget" },
      select: { lastSyncedAt: true, internalModifiedAt: true },
    }),
  ]);

  const committedByLine = new Map<string, number>();
  const fnpAlerts: FnpAlertItem[] = [];
  const nowMs = Date.now();
  const fourteenDaysMs = 14 * 86_400_000;

  for (const q of quotes) {
    if (q.budgetLineId) {
      committedByLine.set(
        q.budgetLineId,
        round2((committedByLine.get(q.budgetLineId) ?? 0) + (q.amountHt || 0))
      );
    }
    const invoicedHt = round2(
      q.invoices.reduce((sum, inv) => sum + (inv.amountHt || 0), 0)
    );
    const remainingHt = round2((q.amountHt || 0) - invoicedHt);
    if (remainingHt > 0.01) {
      const validMs = q.validUntil ? Date.parse(q.validUntil) : Number.NaN;
      const issueMs = q.issueDate ? Date.parse(q.issueDate) : q.createdAt.getTime();
      const isOverdueOrStale =
        (!Number.isNaN(validMs) && validMs < nowMs) ||
        (!Number.isNaN(issueMs) && nowMs - issueMs > fourteenDaysMs);
      if (isOverdueOrStale) {
        fnpAlerts.push({
          quoteId: q.id,
          quoteNumber: q.quoteNumber,
          vendorName: q.vendorName,
          amountHt: q.amountHt,
          invoicedHt,
          remainingHt,
          issueDate: q.issueDate,
          validUntil: q.validUntil,
          budgetLineObjet: q.budgetLine?.objet ?? null,
        });
      }
    }
  }

  const enrichedLines = lines.map((line) => ({
    ...line,
    committedHt: committedByLine.get(line.id) ?? 0,
  }));

  const localModifiedAt = await computeLocalBudgetModifiedAt(
    prisma,
    projectId,
    lines
  );
  const lastSyncedAt = budgetNode?.lastSyncedAt ?? null;
  const lastSheetModifiedAt = budgetNode?.internalModifiedAt ?? null;
  const hasPendingLocalChanges = Boolean(
    localModifiedAt &&
      (!lastSyncedAt || localModifiedAt.getTime() > lastSyncedAt.getTime() + 2000)
  );

  const computed = computeBudgetMetrics(enrichedLines);
  return {
    budgetSheetId: project.budgetSheetId ?? null,
    lines: enrichedLines,
    fnpAlerts,
    syncMeta: {
      lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
      lastSheetModifiedAt: lastSheetModifiedAt
        ? lastSheetModifiedAt.toISOString()
        : null,
      localModifiedAt: localModifiedAt ? localModifiedAt.toISOString() : null,
      hasPendingLocalChanges,
    },
    ...computed,
    warnings: [],
  };
}

export async function upsertManualBudgetLine(
  prisma: PrismaClient,
  projectId: string,
  rawInput: unknown
): Promise<{ ok: true; line: BudgetLine } & BudgetOverviewResponse> {
  const project = await requireProject(prisma, projectId);
  const input = UpsertBudgetLineSchema.parse(rawInput);

  let line: BudgetLine;
  if (input.id) {
    const existing = await prisma.budgetLine.findUnique({
      where: { id: input.id },
    });
    if (!existing || existing.projectId !== projectId) {
      throw new AppHttpError(
        404,
        "BUDGET_LINE_NOT_FOUND",
        "Ligne budgétaire introuvable pour ce projet."
      );
    }

    const expenseType =
      input.expenseType !== undefined
        ? normalizeExpenseType(input.expenseType)
        : existing.expenseType;

    const saleQty = round2(input.saleQty ?? existing.saleQty);
    const saleDays = round2(input.saleDays ?? existing.saleDays);
    const saleUnitPrice = round2(input.saleUnitPrice ?? existing.saleUnitPrice);
    const hasSaleFactors =
      input.saleQty !== undefined ||
      input.saleDays !== undefined ||
      input.saleUnitPrice !== undefined;
    const saleTotalHt =
      input.saleTotalHt !== undefined
        ? round2(input.saleTotalHt)
        : hasSaleFactors
          ? round2(saleQty * saleDays * saleUnitPrice)
          : existing.saleTotalHt;

    const preOpUnitCost = round2(input.preOpUnitCost ?? existing.preOpUnitCost);
    const hasPreOpFactors =
      input.preOpUnitCost !== undefined ||
      input.saleQty !== undefined ||
      input.saleDays !== undefined;
    const preOpTotalHt =
      input.preOpTotalHt !== undefined
        ? round2(input.preOpTotalHt)
        : hasPreOpFactors
          ? round2(preOpUnitCost * saleQty * saleDays)
          : existing.preOpTotalHt;

    const postOpQty = round2(input.postOpQty ?? existing.postOpQty);
    const postOpDays = round2(input.postOpDays ?? existing.postOpDays);
    const postOpUnitCost = round2(
      input.postOpUnitCost ?? existing.postOpUnitCost
    );
    const hasPostOpFactors =
      input.postOpQty !== undefined ||
      input.postOpDays !== undefined ||
      input.postOpUnitCost !== undefined;
    const postOpTotalHt =
      input.postOpTotalHt !== undefined
        ? round2(input.postOpTotalHt)
        : hasPostOpFactors
          ? round2(postOpQty * postOpDays * postOpUnitCost)
          : existing.postOpTotalHt;

    line = await prisma.budgetLine.update({
      where: { id: existing.id },
      data: {
        category: input.category,
        objet: input.objet,
        realisePar:
          input.realisePar !== undefined
            ? input.realisePar || null
            : existing.realisePar,
        expenseType,
        saleQty,
        saleDays,
        saleUnitPrice,
        saleTotalHt,
        preOpUnitCost,
        preOpTotalHt,
        postOpQty,
        postOpDays,
        postOpUnitCost,
        postOpTotalHt,
        ...(input.marginPct !== undefined
          ? { marginPct: input.marginPct }
          : {}),
        sheetRowIndex:
          input.sheetRowIndex !== undefined
            ? input.sheetRowIndex
            : existing.sheetRowIndex,
        invoiceNumbersNote:
          input.invoiceNumbersNote !== undefined
            ? input.invoiceNumbersNote
            : existing.invoiceNumbersNote,
      },
    });
  } else {
    const expenseType = normalizeExpenseType(input.expenseType);
    const saleQty = round2(input.saleQty ?? 1);
    const saleDays = round2(input.saleDays ?? 1);
    const saleUnitPrice = round2(input.saleUnitPrice ?? 0);
    const saleTotalHt = round2(
      input.saleTotalHt ?? saleQty * saleDays * saleUnitPrice
    );

    const preOpUnitCost = round2(input.preOpUnitCost ?? 0);
    const preOpTotalHt = round2(
      input.preOpTotalHt ?? preOpUnitCost * saleQty * saleDays
    );

    const postOpQty = round2(input.postOpQty ?? 0);
    const postOpDays = round2(input.postOpDays ?? 0);
    const postOpUnitCost = round2(input.postOpUnitCost ?? 0);
    const postOpTotalHt = round2(
      input.postOpTotalHt ?? postOpQty * postOpDays * postOpUnitCost
    );

    line = await prisma.budgetLine.create({
      data: {
        projectId,
        category: input.category,
        objet: input.objet,
        realisePar: input.realisePar || null,
        expenseType,
        saleQty,
        saleDays,
        saleUnitPrice,
        saleTotalHt,
        preOpUnitCost,
        preOpTotalHt,
        postOpQty,
        postOpDays,
        postOpUnitCost,
        postOpTotalHt,
        marginPct: input.marginPct !== undefined ? input.marginPct : 43,
        sheetRowIndex: input.sheetRowIndex ?? null,
        invoiceNumbersNote: input.invoiceNumbersNote ?? null,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "BUDGET_LINE_UPSERTED",
      targetType: "BUDGET_LINE",
      targetId: line.id,
      detailsJson: JSON.stringify({
        category: line.category,
        objet: line.objet,
        saleTotalHt: line.saleTotalHt,
        preOpTotalHt: line.preOpTotalHt,
        postOpTotalHt: line.postOpTotalHt,
      }),
    },
  });

  const overview = await getProjectBudget(prisma, project.id);
  return {
    ok: true,
    line,
    ...overview,
  };
}

export async function importBudgetFromXlsx(params: {
  prisma: PrismaClient;
  getGoogleGateway: (projectId?: string) => Promise<GoogleWorkspacePort>;
  projectId: string;
  buffer: Buffer;
  filename: string;
}): Promise<{ ok: true } & BudgetOverviewResponse> {
  const { prisma, getGoogleGateway, projectId, buffer, filename } = params;
  const project = await requireProject(prisma, projectId);

  // 1. Parse & validate .xlsx BEFORE any Google/DB call
  const parsed = await parseBudgetXlsxBuffer(buffer, {
    codeProjet: project.codeProjet,
    client: project.client,
    nomJeu: project.nomJeu,
  });

  // 2. Acquire Google gateway (throws 412 before DB writes)
  const gateway = await getGoogleGateway(projectId);

  // 3. Ensure 001.1 folder exists in sandbox Drive tree
  const folder0011 = await ensureProjectFolderNode(
    prisma,
    gateway,
    projectId,
    "001.1"
  );

  const cleanBaseName =
    filename.replace(/\.xlsx$/i, "").trim() || "Budget";
  const prefix = project.isSandbox
    ? `[PILOTE ${project.codeProjet}]`
    : `[${project.codeProjet}]`;
  const sheetName = `${prefix} ${cleanBaseName}`;

  const created = await gateway.drive.createFile({
    name: sheetName,
    parentId: folder0011.driveFileId,
    mimeType: "application/vnd.google-apps.spreadsheet",
    sourceMimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: buffer,
  });

  // If the underlying Sheets port returns empty values (e.g. test double), populate canonical matrix
  let existingValues: unknown[][] = [];
  const escapedPostesTitle = parsed.layout.postesSheetTitle.replace(/'/g, "''");
  try {
    existingValues = await gateway.sheets.getValues({
      spreadsheetId: created.id,
      range: `'${escapedPostesTitle}'!A1:S5`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
  } catch {
    existingValues = [];
  }

  let linesToReconcile = parsed.lines;
  if (!existingValues || existingValues.length === 0) {
    const canonical = buildCanonicalPostesMatrix(
      parsed.lines,
      `${project.client} x ${project.nomJeu}`
    );
    try {
      await gateway.sheets.updateValues({
        spreadsheetId: created.id,
        range: `'${escapedPostesTitle}'!A1:S${canonical.matrix.length}`,
        values: canonical.matrix,
        valueInputOption: "USER_ENTERED",
      });
      linesToReconcile = parsed.lines.map((line, idx) => ({
        ...line,
        sheetRowIndex: canonical.rowIndices[idx] ?? line.sheetRowIndex,
      }));
    } catch {
      // Non-fatal if tab name differs in target sheet
    }
  }

  const lines = await reconcileBudgetLines(prisma, projectId, linesToReconcile);
  await upsertBudgetDriveNode(prisma, {
    projectId,
    name: sheetName,
    driveFileId: created.id,
    parentNodeId: folder0011.id,
  });

  await prisma.project.update({
    where: { id: projectId },
    data: { budgetSheetId: created.id },
  });

  const importedSheetMod = await fetchSheetModifiedTime(gateway, created.id);
  await recordBudgetSyncBaseline({
    prisma,
    projectId,
    sheetId: created.id,
    sheetModifiedAt: importedSheetMod,
  });

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "BUDGET_IMPORTED",
      targetType: "BUDGET_SHEET",
      targetId: created.id,
      detailsJson: JSON.stringify({
        source: "xlsx",
        filename,
        linesCount: lines.length,
        warnings: parsed.warnings,
      }),
    },
  });

  const computed = computeBudgetMetrics(lines);
  return {
    ok: true,
    budgetSheetId: created.id,
    lines,
    ...computed,
    warnings: parsed.warnings,
  };
}

interface SheetMetadataEntry {
  properties?: {
    sheetId?: number;
    title?: string;
  };
  data?: Array<{
    rowData?: Array<{
      values?: Array<{
        note?: string;
      }>;
    }>;
  }>;
}

async function readSheetMatrices(
  gateway: GoogleWorkspacePort,
  spreadsheetId: string
): Promise<{
  postesTitle: string;
  postesSheetId: number;
  postesMatrix: unknown[][];
  postesNotes: Array<Array<string | null>>;
  vueMatrix: unknown[][] | null;
}> {
  let postesTitle = "Postes de dépenses";
  let postesSheetId = 0;
  let vueTitle: string | null = "Vue d'ensemble";
  const postesNotes: Array<Array<string | null>> = [];

  try {
    const meta = (await gateway.sheets.getSpreadsheet({
      spreadsheetId,
      includeGridData: false,
      fields: "sheets(properties(sheetId,title))",
    })) as { sheets?: SheetMetadataEntry[] };

    const sheetsList = meta?.sheets ?? [];
    if (sheetsList.length > 0) {
      const strip = (s: string) =>
        s
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();

      const foundPostes =
        sheetsList.find((s) =>
          strip(s.properties?.title ?? "").includes("postes")
        ) ?? sheetsList[0];

      if (foundPostes?.properties?.title) {
        postesTitle = foundPostes.properties.title;
      }
      if (typeof foundPostes?.properties?.sheetId === "number") {
        postesSheetId = foundPostes.properties.sheetId;
      }

      const foundVue = sheetsList.find((s) =>
        strip(s.properties?.title ?? "").includes("vue")
      );
      vueTitle = foundVue?.properties?.title ?? null;
    }
  } catch {
    // Fallback to default titles
  }

  let postesMatrix: unknown[][] = [];
  try {
    postesMatrix = await gateway.sheets.getValues({
      spreadsheetId,
      range: `'${postesTitle.replace(/'/g, "''")}'!A1:Z250`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
  } catch {
    postesMatrix = [];
  }

  let vueMatrix: unknown[][] | null = null;
  if (vueTitle) {
    try {
      const vals = await gateway.sheets.getValues({
        spreadsheetId,
        range: `'${vueTitle.replace(/'/g, "''")}'!A1:H45`,
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      if (vals.length > 0) {
        vueMatrix = vals;
      }
    } catch {
      vueMatrix = null;
    }
  }

  return {
    postesTitle,
    postesSheetId,
    postesMatrix,
    postesNotes,
    vueMatrix,
  };
}

export async function importBudgetFromSheetCopy(params: {
  prisma: PrismaClient;
  getGoogleGateway: (projectId?: string) => Promise<GoogleWorkspacePort>;
  projectId: string;
  sourceSheetId: string;
}): Promise<{ ok: true } & BudgetOverviewResponse> {
  const { prisma, getGoogleGateway, projectId, sourceSheetId } = params;
  const project = await requireProject(prisma, projectId);
  const gateway = await getGoogleGateway(projectId);

  const folder0011 = await ensureProjectFolderNode(
    prisma,
    gateway,
    projectId,
    "001.1"
  );

  const prefix = project.isSandbox
    ? `[PILOTE ${project.codeProjet}]`
    : `[${project.codeProjet}]`;
  const copyName = `${prefix} Budget : ${project.client} - ${project.nomJeu}`;

  const copied = await gateway.drive.copyFile({
    sourceFileId: sourceSheetId,
    destinationParentId: folder0011.driveFileId,
    name: copyName,
  });

  const {
    postesTitle,
    postesSheetId,
    postesMatrix,
    postesNotes,
    vueMatrix,
  } = await readSheetMatrices(gateway, copied.id);

  const warnings: string[] = [];
  let lines: BudgetLine[];

  if (postesMatrix.length > 0) {
    const parsed = parseBudgetSheetMatrices({
      postesMatrix,
      postesSheetTitle: postesTitle,
      postesSheetId,
      postesNotes,
      vueEnsembleMatrix: vueMatrix,
      projectContext: {
        codeProjet: project.codeProjet,
        client: project.client,
        nomJeu: project.nomJeu,
      },
    });
    warnings.push(...parsed.warnings);
    lines = await reconcileBudgetLines(prisma, projectId, parsed.lines);
  } else {
    warnings.push(
      "Feuille copiée dans 001.1 Budget. Utilisez 'Synchroniser depuis Sheet' ou importez un fichier .xlsx si la lecture de valeurs est vide."
    );
    lines = await prisma.budgetLine.findMany({
      where: { projectId },
      orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
    });
  }

  await upsertBudgetDriveNode(prisma, {
    projectId,
    name: copyName,
    driveFileId: copied.id,
    parentNodeId: folder0011.id,
  });

  await prisma.project.update({
    where: { id: projectId },
    data: { budgetSheetId: copied.id },
  });

  const copiedSheetMod = await fetchSheetModifiedTime(gateway, copied.id);
  await recordBudgetSyncBaseline({
    prisma,
    projectId,
    sheetId: copied.id,
    sheetModifiedAt: copiedSheetMod,
  });

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "BUDGET_IMPORTED",
      targetType: "BUDGET_SHEET",
      targetId: copied.id,
      detailsJson: JSON.stringify({
        source: "sheet_copy",
        sourceSheetId,
        linesCount: lines.length,
        warnings,
      }),
    },
  });

  const computed = computeBudgetMetrics(lines);
  return {
    ok: true,
    budgetSheetId: copied.id,
    lines,
    ...computed,
    warnings,
  };
}

export async function syncBudgetFromAttachedSheet(params: {
  prisma: PrismaClient;
  getGoogleGateway: (projectId?: string) => Promise<GoogleWorkspacePort>;
  projectId: string;
}): Promise<{ ok: true } & BudgetOverviewResponse> {
  const { prisma, getGoogleGateway, projectId } = params;
  const project = await requireProject(prisma, projectId);
  if (!project.budgetSheetId) {
    throw new AppHttpError(
      400,
      "BUDGET_SHEET_NOT_LINKED",
      "Aucun Google Sheet Budget n'est rattaché à ce projet."
    );
  }

  const gateway = await getGoogleGateway(projectId);
  const {
    postesTitle,
    postesSheetId,
    postesMatrix,
    postesNotes,
    vueMatrix,
  } = await readSheetMatrices(gateway, project.budgetSheetId);

  if (postesMatrix.length === 0) {
    const existingLines = await prisma.budgetLine.findMany({
      where: { projectId },
      orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
    });
    const computed = computeBudgetMetrics(existingLines);
    return {
      ok: true,
      budgetSheetId: project.budgetSheetId,
      lines: existingLines,
      ...computed,
      warnings: [
        "Aucune donnée retournée par Google Sheets lors de la synchronisation.",
      ],
    };
  }

  const parsed = parseBudgetSheetMatrices({
    postesMatrix,
    postesSheetTitle: postesTitle,
    postesSheetId,
    postesNotes,
    vueEnsembleMatrix: vueMatrix,
    projectContext: {
      codeProjet: project.codeProjet,
      client: project.client,
      nomJeu: project.nomJeu,
    },
  });

  const lines = await reconcileBudgetLines(prisma, projectId, parsed.lines);
  const sheetModifiedAt = await fetchSheetModifiedTime(
    gateway,
    project.budgetSheetId
  );
  await recordBudgetSyncBaseline({
    prisma,
    projectId,
    sheetId: project.budgetSheetId,
    sheetModifiedAt,
  });

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "BUDGET_SYNCED",
      targetType: "BUDGET_SHEET",
      targetId: project.budgetSheetId,
      detailsJson: JSON.stringify({
        direction: "PULL_FROM_SHEET",
        linesCount: lines.length,
        warnings: parsed.warnings,
      }),
    },
  });

  const overview = await getProjectBudget(prisma, projectId);
  return {
    ok: true,
    ...overview,
    warnings: parsed.warnings,
  };
}

/**
 * Pushes all current site BudgetLines to the attached Google Sheet (or creates a canonical
 * Google Sheet in 001.1 Budget if none is attached yet), preserving existing Sheet formatting
 * when updating matched rows in place.
 */
export async function pushBudgetToAttachedSheet(params: {
  prisma: PrismaClient;
  getGoogleGateway: (projectId?: string) => Promise<GoogleWorkspacePort>;
  projectId: string;
}): Promise<{ ok: true } & BudgetOverviewResponse> {
  const { prisma, getGoogleGateway, projectId } = params;
  const project = await requireProject(prisma, projectId);
  const gateway = await getGoogleGateway(projectId);

  const lines = await prisma.budgetLine.findMany({
    where: { projectId },
    orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
  });

  let spreadsheetId = project.budgetSheetId;
  let postesTitle = "Postes de dépenses";
  const warnings: string[] = [];

  if (!spreadsheetId) {
    const folder0011 = await ensureProjectFolderNode(
      prisma,
      gateway,
      projectId,
      "001.1"
    );
    const prefix = project.isSandbox
      ? `[PILOTE ${project.codeProjet}]`
      : `[${project.codeProjet}]`;
    const sheetName = `${prefix} Budget : ${project.client} - ${project.nomJeu}`;

    const created = await gateway.drive.createFile({
      name: sheetName,
      parentId: folder0011.driveFileId,
      mimeType: "application/vnd.google-apps.spreadsheet",
      body: "",
    });
    spreadsheetId = created.id;

    await upsertBudgetDriveNode(prisma, {
      projectId,
      name: sheetName,
      driveFileId: spreadsheetId,
      parentNodeId: folder0011.id,
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { budgetSheetId: spreadsheetId },
    });
  }

  const sheetData = await readSheetMatrices(gateway, spreadsheetId);
  postesTitle = sheetData.postesTitle || "Postes de dépenses";
  const escapedTitle = postesTitle.replace(/'/g, "''");

  const layout =
    sheetData.postesMatrix.length > 0
      ? resolvePostOpLayoutFromMatrix(
          sheetData.postesMatrix,
          postesTitle,
          sheetData.postesSheetId
        )
      : null;

  if (layout) {
    // Smart in-place update of existing matched rows, clear removed rows, and append new ones
    const parsedExisting = parseBudgetSheetMatrices({
      postesMatrix: sheetData.postesMatrix,
      postesSheetTitle: postesTitle,
      postesSheetId: sheetData.postesSheetId,
      postesNotes: sheetData.postesNotes,
      vueEnsembleMatrix: sheetData.vueMatrix,
      projectContext: {
        codeProjet: project.codeProjet,
        client: project.client,
        nomJeu: project.nomJeu,
      },
    });

    const maxCol = Math.max(
      layout.objetCol,
      layout.realiseParCol ?? 0,
      layout.saleQtyCol ?? 0,
      layout.saleDaysCol ?? 0,
      layout.saleUnitCol ?? 0,
      layout.saleTotalCol,
      layout.expenseTypeCol ?? 0,
      layout.preOpUnitCol ?? 0,
      layout.preOpTotalCol,
      layout.postOpQtyCol ?? 0,
      layout.postOpDaysCol ?? 0,
      layout.postOpUnitCol ?? 0,
      layout.postOpTotalCol
    );
    const lastColLetter = colIndexToLetter(maxCol);

    const existingRowNumbers = new Set(
      parsedExisting.lines.map((l) => l.sheetRowIndex)
    );
    const activeRowNumbers = new Set<number>();

    const buildRowCells = (
      line: BudgetLine,
      existingRow?: unknown[]
    ): unknown[] => {
      const row = new Array<unknown>(maxCol + 1).fill("");
      if (existingRow) {
        for (let c = 0; c <= maxCol && c < existingRow.length; c++) {
          row[c] = existingRow[c] ?? "";
        }
      }
      row[layout.objetCol] = line.objet;
      if (layout.realiseParCol !== null) {
        row[layout.realiseParCol] = line.realisePar ?? "";
      }
      if (layout.saleQtyCol !== null) row[layout.saleQtyCol] = line.saleQty;
      if (layout.saleDaysCol !== null) row[layout.saleDaysCol] = line.saleDays;
      if (layout.saleUnitCol !== null) {
        row[layout.saleUnitCol] = line.saleUnitPrice;
      }
      row[layout.saleTotalCol] = line.saleTotalHt;
      if (layout.expenseTypeCol !== null) {
        row[layout.expenseTypeCol] = toResourceTypeOption(line.expenseType);
      }
      if (layout.preOpUnitCol !== null) {
        row[layout.preOpUnitCol] = line.preOpUnitCost;
      }
      row[layout.preOpTotalCol] = line.preOpTotalHt;
      if (layout.postOpQtyCol !== null) {
        row[layout.postOpQtyCol] = line.postOpQty;
      }
      if (layout.postOpDaysCol !== null) {
        row[layout.postOpDaysCol] = line.postOpDays;
      }
      if (layout.postOpUnitCol !== null) {
        row[layout.postOpUnitCol] = line.postOpUnitCost;
      }
      row[layout.postOpTotalCol] = line.postOpTotalHt;
      return row;
    };

    const unmappedLines: BudgetLine[] = [];

    for (const line of lines) {
      if (
        line.sheetRowIndex &&
        line.sheetRowIndex > layout.headerRowIndex + 1 &&
        existingRowNumbers.has(line.sheetRowIndex) &&
        !activeRowNumbers.has(line.sheetRowIndex)
      ) {
        activeRowNumbers.add(line.sheetRowIndex);
        const existingRow = sheetData.postesMatrix[line.sheetRowIndex - 1];
        const rowValues = buildRowCells(line, existingRow);
        await gateway.sheets.updateValues({
          spreadsheetId,
          range: `'${escapedTitle}'!A${line.sheetRowIndex}:${lastColLetter}${line.sheetRowIndex}`,
          values: [rowValues],
          valueInputOption: "USER_ENTERED",
        });
      } else {
        unmappedLines.push(line);
      }
    }

    // Clear Sheet rows that were deleted on the site
    for (const oldRowNum of existingRowNumbers) {
      if (!activeRowNumbers.has(oldRowNum)) {
        const emptyRow = new Array<unknown>(maxCol + 1).fill("");
        await gateway.sheets.updateValues({
          spreadsheetId,
          range: `'${escapedTitle}'!A${oldRowNum}:${lastColLetter}${oldRowNum}`,
          values: [emptyRow],
          valueInputOption: "USER_ENTERED",
        });
      }
    }

    // Append newly added lines cleanly below the last used row
    if (unmappedLines.length > 0) {
      let nextRow = Math.max(
        sheetData.postesMatrix.length + 1,
        layout.headerRowIndex + 2
      );
      let lastAppendedCat = "";
      const rowsToAppend: unknown[][] = [];
      const rowUpdates: Array<{ id: string; rowIndex: number }> = [];

      for (const line of unmappedLines) {
        const cat = line.category.trim() || "Général";
        if (cat !== lastAppendedCat) {
          const catRow = new Array<unknown>(maxCol + 1).fill("");
          catRow[layout.objetCol] = cat;
          if (layout.expenseTypeCol !== null) {
            catRow[layout.expenseTypeCol] = "TOTAL";
          }
          rowsToAppend.push(catRow);
          nextRow += 1;
          lastAppendedCat = cat;
        }
        rowsToAppend.push(buildRowCells(line));
        rowUpdates.push({ id: line.id, rowIndex: nextRow });
        nextRow += 1;
      }

      const startRow = nextRow - rowsToAppend.length;
      const endRow = nextRow - 1;
      await gateway.sheets.updateValues({
        spreadsheetId,
        range: `'${escapedTitle}'!A${startRow}:${lastColLetter}${endRow}`,
        values: rowsToAppend,
        valueInputOption: "USER_ENTERED",
      });

      for (const upd of rowUpdates) {
        await prisma.budgetLine.update({
          where: { id: upd.id },
          data: { sheetRowIndex: upd.rowIndex },
        });
      }
    }
  } else {
    // Sheet is empty or non-standard: write canonical matrix cleanly
    const canonical = buildCanonicalPostesMatrix(
      lines.map((l) => ({
        ...l,
        expenseType: toResourceTypeOption(l.expenseType),
      })),
      `${project.client} x ${project.nomJeu}`
    );

    const clearExtraRows = Math.max(
      0,
      sheetData.postesMatrix.length - canonical.matrix.length
    );
    const fullMatrix = [...canonical.matrix];
    for (let i = 0; i < clearExtraRows; i++) {
      fullMatrix.push(new Array(19).fill(""));
    }

    await gateway.sheets.updateValues({
      spreadsheetId,
      range: `'${escapedTitle}'!A1:S${fullMatrix.length}`,
      values: fullMatrix,
      valueInputOption: "USER_ENTERED",
    });

    for (let i = 0; i < lines.length; i++) {
      const targetRow = canonical.rowIndices[i];
      if (targetRow && lines[i].sheetRowIndex !== targetRow) {
        await prisma.budgetLine.update({
          where: { id: lines[i].id },
          data: { sheetRowIndex: targetRow },
        });
      }
    }
  }

  // Record fresh Drive modifiedTime so our own push is not treated as an external Sheet edit
  const freshSheetMod = await fetchSheetModifiedTime(gateway, spreadsheetId);
  await recordBudgetSyncBaseline({
    prisma,
    projectId,
    sheetId: spreadsheetId,
    sheetModifiedAt: freshSheetMod,
  });

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "BUDGET_SYNCED",
      targetType: "BUDGET_SHEET",
      targetId: spreadsheetId,
      detailsJson: JSON.stringify({
        direction: "PUSH_TO_SHEET",
        linesCount: lines.length,
        warnings,
      }),
    },
  });

  const overview = await getProjectBudget(prisma, projectId);
  return {
    ok: true,
    ...overview,
    warnings,
  };
}

/**
 * Smart bidirectional sync: inspects both Google Drive's Sheet modifiedTime and the
 * site's latest Budget modification timestamp, then automatically executes the side
 * with the most recent edits (Last-Write-Wins).
 */
export async function smartSyncBudgetWithSheet(params: {
  prisma: PrismaClient;
  getGoogleGateway: (projectId?: string) => Promise<GoogleWorkspacePort>;
  projectId: string;
  forceDirection?: "auto" | "pull" | "push";
}): Promise<{ ok: true } & BudgetOverviewResponse> {
  const { prisma, getGoogleGateway, projectId, forceDirection = "auto" } =
    params;
  const project = await requireProject(prisma, projectId);
  const linesCount = await prisma.budgetLine.count({ where: { projectId } });

  if (!project.budgetSheetId) {
    if (linesCount > 0 && forceDirection !== "pull") {
      const pushed = await pushBudgetToAttachedSheet({
        prisma,
        getGoogleGateway,
        projectId,
      });
      return {
        ...pushed,
        syncResult: {
          direction: "PUSH_TO_SHEET",
          reason:
            "Nouveau Google Sheet Budget créé dans 001.1 Budget à partir du site.",
          sheetModifiedAt: pushed.syncMeta?.lastSheetModifiedAt ?? null,
          siteModifiedAt: pushed.syncMeta?.localModifiedAt ?? null,
        },
      };
    }
    throw new AppHttpError(
      400,
      "BUDGET_SHEET_NOT_LINKED",
      "Aucun Google Sheet Budget n'est rattaché à ce projet."
    );
  }

  const gateway = await getGoogleGateway(projectId);
  const [sheetModifiedAt, budgetNode, siteModifiedAt] = await Promise.all([
    fetchSheetModifiedTime(gateway, project.budgetSheetId),
    prisma.driveNode.findFirst({
      where: { projectId, code: "001.1.budget" },
      select: { lastSyncedAt: true, internalModifiedAt: true },
    }),
    computeLocalBudgetModifiedAt(prisma, projectId),
  ]);

  const decision = decideBudgetSyncDirection({
    sheetModifiedAt,
    lastKnownSheetModifiedAt: budgetNode?.internalModifiedAt ?? null,
    siteModifiedAt,
    lastSyncedAt: budgetNode?.lastSyncedAt ?? null,
    siteLineCount: linesCount,
    forceDirection,
  });

  if (decision.direction === "PULL_FROM_SHEET") {
    const pulled = await syncBudgetFromAttachedSheet({
      prisma,
      getGoogleGateway,
      projectId,
    });
    return {
      ...pulled,
      syncResult: {
        direction: "PULL_FROM_SHEET",
        reason: decision.reason,
        sheetModifiedAt: sheetModifiedAt ? sheetModifiedAt.toISOString() : null,
        siteModifiedAt: siteModifiedAt ? siteModifiedAt.toISOString() : null,
      },
    };
  }

  if (decision.direction === "PUSH_TO_SHEET") {
    const pushed = await pushBudgetToAttachedSheet({
      prisma,
      getGoogleGateway,
      projectId,
    });
    return {
      ...pushed,
      syncResult: {
        direction: "PUSH_TO_SHEET",
        reason: decision.reason,
        sheetModifiedAt: pushed.syncMeta?.lastSheetModifiedAt ?? null,
        siteModifiedAt: siteModifiedAt ? siteModifiedAt.toISOString() : null,
      },
    };
  }

  const overview = await getProjectBudget(prisma, projectId);
  return {
    ok: true,
    ...overview,
    syncResult: {
      direction: "UP_TO_DATE",
      reason: decision.reason,
      sheetModifiedAt: sheetModifiedAt ? sheetModifiedAt.toISOString() : null,
      siteModifiedAt: siteModifiedAt ? siteModifiedAt.toISOString() : null,
    },
  };
}
