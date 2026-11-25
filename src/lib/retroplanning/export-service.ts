import type { PrismaClient, Project, RetroTask } from "@prisma/client";
import ExcelJS from "exceljs";
import { getSyncPolicy } from "@/lib/drive/sync-policy";
import { provisionProjectTree } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import type { GoogleWorkspacePort } from "@/lib/ports";
import {
  RETRO_SHEET_TAB,
  RETRO_STATUS_LABELS,
} from "@/lib/retroplanning/sheet-codec";
import {
  toIsoDateOnly,
  type RetroStatus,
} from "@/lib/retroplanning/validation";
import {
  PROJECT_CATEGORY_META,
  normalizeProjectCategory,
} from "@/lib/templates/project-templates";

const STATUS_FILL_ARGB: Record<string, { bg: string; fg: string }> = {
  A_FAIRE: { bg: "FFF1F5F9", fg: "FF334155" },
  EN_COURS: { bg: "FFE0F2FE", fg: "FF0369A1" },
  EN_ATTENTE_CLIENT: { bg: "FFFEF3C7", fg: "FFB45309" },
  TERMINE: { bg: "FFD1FAE5", fg: "FF047857" },
};

export async function exportRetroplanningToXlsxBuffer(
  project: Pick<Project, "codeProjet" | "client" | "nomJeu" | "category">,
  tasks: readonly RetroTask[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GO Project Hub";
  workbook.created = new Date();

  const catMeta =
    PROJECT_CATEGORY_META[normalizeProjectCategory(project.category)];

  const sheet = workbook.addWorksheet(RETRO_SHEET_TAB, {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  // Row 1: Project banner (preserved by retroplanning codec!)
  sheet.mergeCells("A1:J1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = `RÉTROPLANNING — ${project.client} · ${project.nomJeu} (CP ${project.codeProjet} · ${catMeta.label})`;
  titleCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" },
  };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(1).height = 28;

  // Row 2: Canonical headers matching sheet-codec.ts
  const headers = [
    "ID",
    "PHASES",
    "ÉTAPES",
    "TACHES",
    "OWNER",
    "DÉBUT",
    "FIN",
    "STATUT",
    "JALON",
    "TYPE_JALON",
  ];
  const headerRow = sheet.getRow(2);
  headerRow.values = headers;
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF0F172A" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2E8F0" },
    };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });

  // Data rows from Row 3
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const startIso = toIsoDateOnly(t.startDate) ?? "";
    const endIso = toIsoDateOnly(t.endDate) ?? "";
    const statusLabel =
      RETRO_STATUS_LABELS[t.status as RetroStatus] ?? t.status;
    const row = sheet.addRow([
      t.id,
      t.phase,
      t.etape ?? "",
      t.tache,
      t.owner ?? "",
      startIso,
      endIso,
      statusLabel,
      t.isMilestone ? "OUI" : "NON",
      t.milestoneType ?? "",
    ]);
    row.height = 21;
    row.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF0F172A" } };
      cell.alignment = {
        vertical: "middle",
        horizontal: colNumber === 6 || colNumber === 7 || colNumber === 9 ? "center" : "left",
        wrapText: colNumber === 4,
      };
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
      };
    });

    const statusCell = row.getCell(8);
    const tone = STATUS_FILL_ARGB[t.status] ?? STATUS_FILL_ARGB.A_FAIRE;
    statusCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: tone.bg },
    };
    statusCell.font = {
      name: "Calibri",
      size: 10,
      bold: true,
      color: { argb: tone.fg },
    };
    statusCell.alignment = { vertical: "middle", horizontal: "center" };

    if (t.isMilestone) {
      const jalonCell = row.getCell(9);
      jalonCell.font = {
        name: "Calibri",
        size: 10,
        bold: true,
        color: { argb: "FFBE123C" },
      };
    }
  }

  sheet.columns = [
    { width: 22 }, // ID
    { width: 26 }, // PHASES
    { width: 18 }, // ÉTAPES
    { width: 44 }, // TACHES
    { width: 18 }, // OWNER
    { width: 14 }, // DÉBUT
    { width: 14 }, // FIN
    { width: 18 }, // STATUT
    { width: 10 }, // JALON
    { width: 16 }, // TYPE_JALON
  ];

  sheet.autoFilter = {
    from: "A2",
    to: `J${Math.max(2, tasks.length + 2)}`,
  };

  // Summary tab by phase
  const summarySheet = workbook.addWorksheet("Synthèse phases");
  summarySheet.addRow(["Phase", "Total tâches", "Terminées", "En cours", "À planifier (sans date)"]);
  summarySheet.getRow(1).font = { bold: true };
  const byPhase = new Map<
    string,
    { total: number; done: number; inProgress: number; undated: number }
  >();
  for (const t of tasks) {
    const key = t.phase || "Sans phase";
    const entry = byPhase.get(key) ?? {
      total: 0,
      done: 0,
      inProgress: 0,
      undated: 0,
    };
    entry.total += 1;
    if (t.status === "TERMINE") entry.done += 1;
    if (t.status === "EN_COURS") entry.inProgress += 1;
    if (!t.startDate && !t.endDate) entry.undated += 1;
    byPhase.set(key, entry);
  }
  for (const [phaseName, stats] of byPhase.entries()) {
    summarySheet.addRow([
      phaseName,
      stats.total,
      stats.done,
      stats.inProgress,
      stats.undated,
    ]);
  }
  summarySheet.columns = [
    { width: 30 },
    { width: 15 },
    { width: 14 },
    { width: 14 },
    { width: 24 },
  ];

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Exports or updates the project's Retroplanning Google Sheet in Drive folder 002.1.
 * - If no retroplanningSheetId exists yet: uploads the formatted XLSX converted to Google Sheets in 002.1.
 * - If retroplanningSheetId already exists: updates rows in-place (preserving Row 1) so Drive stays fresh in 1 click.
 */
export async function exportOrUpdateRetroplanningGoogleSheet(
  prisma: PrismaClient,
  gateway: GoogleWorkspacePort,
  projectId: string,
  actor = "user"
): Promise<{
  spreadsheetId: string;
  webViewLink: string;
  created: boolean;
  tasksCount: number;
}> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const tasks = await prisma.retroTask.findMany({
    where: { projectId },
    orderBy: [{ sheetRowIndex: "asc" }, { createdAt: "asc" }],
  });

  // Ensure folder 002.1 exists
  let folder0021 = await prisma.driveNode.findFirst({
    where: { projectId, code: "002.1", isFolder: true },
  });
  if (!folder0021?.driveFileId) {
    await provisionProjectTree(prisma, gateway.drive, projectId);
    folder0021 = await prisma.driveNode.findFirst({
      where: { projectId, code: "002.1", isFolder: true },
    });
  }
  if (!folder0021?.driveFileId) {
    throw new AppHttpError(
      400,
      "DRIVE_002_1_MISSING",
      "Dossier Drive 002.1 introuvable pour ce projet."
    );
  }

  const prefix = project.isSandbox
    ? `[PILOTE ${project.codeProjet}]`
    : `[${project.codeProjet}]`;
  const sheetName = `${prefix} RETROPLANNING ${project.client} - ${project.nomJeu}`;

  let spreadsheetId = project.retroplanningSheetId;
  let created = false;
  let webViewLink = spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    : "";

  if (!spreadsheetId) {
    const xlsxBuffer = await exportRetroplanningToXlsxBuffer(project, tasks);
    const createdFile = await gateway.drive.createFile({
      name: sheetName,
      parentId: folder0021.driveFileId,
      mimeType: "application/vnd.google-apps.spreadsheet",
      sourceMimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: xlsxBuffer,
    });
    spreadsheetId = createdFile.id;
    webViewLink =
      createdFile.webViewLink ??
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    created = true;

    await prisma.project.update({
      where: { id: projectId },
      data: { retroplanningSheetId: spreadsheetId },
    });

    const policy = getSyncPolicy("002.1.sheet");
    const existingNode = await prisma.driveNode.findFirst({
      where: { projectId, code: "002.1.sheet" },
    });
    const node = existingNode
      ? await prisma.driveNode.update({
          where: { id: existingNode.id },
          data: {
            name: sheetName,
            driveFileId: spreadsheetId,
            parentNodeId: folder0021.id,
            isFolder: false,
            mimeType: "application/vnd.google-apps.spreadsheet",
            isExtEligible: false,
            extMirrorFileId: null,
          },
        })
      : await prisma.driveNode.create({
          data: {
            projectId,
            code: "002.1.sheet",
            name: sheetName,
            driveFileId: spreadsheetId,
            parentNodeId: folder0021.id,
            isFolder: false,
            mimeType: "application/vnd.google-apps.spreadsheet",
            isExtEligible: policy.isExtEligible,
            extMirrorFileId: null,
          },
        });

    await prisma.syncStatus.upsert({
      where: { driveNodeId: node.id },
      update: { allowPermanentExtSync: false, driftDetected: false },
      create: {
        projectId,
        driveNodeId: node.id,
        validationStatus: "BROUILLON_INTERNE",
        driftDetected: false,
        allowPermanentExtSync: false,
      },
    });
  }

  // Always write canonical rows to Google Sheet so values are 100% up-to-date in Drive
  const rows: string[][] = [
    [
      "ID",
      "PHASES",
      "ÉTAPES",
      "TACHES",
      "OWNER",
      "DÉBUT",
      "FIN",
      "STATUT",
      "JALON",
      "TYPE_JALON",
    ],
    ...tasks.map((t) => [
      t.id,
      t.phase,
      t.etape ?? "",
      t.tache,
      t.owner ?? "",
      toIsoDateOnly(t.startDate) ?? "",
      toIsoDateOnly(t.endDate) ?? "",
      t.status,
      t.isMilestone ? "OUI" : "NON",
      t.milestoneType ?? "",
    ]),
  ];

  // Pad a few blank trailing rows when updating in-place to clear deleted tasks
  const padRows = created ? 0 : 15;
  for (let p = 0; p < padRows; p++) {
    rows.push(["", "", "", "", "", "", "", "", "", ""]);
  }

  const endRow = 1 + rows.length;
  await gateway.sheets.updateValues({
    spreadsheetId,
    range: `'${RETRO_SHEET_TAB}'!A2:J${endRow}`,
    values: rows,
    valueInputOption: "USER_ENTERED",
  });

  // Update stored sheetRowIndex for all tasks
  await prisma.$transaction(
    tasks.map((t, idx) =>
      prisma.retroTask.update({
        where: { id: t.id },
        data: { sheetRowIndex: idx + 3 },
      })
    )
  );

  await prisma.auditLog.create({
    data: {
      projectId,
      actor,
      action: created
        ? "RETRO_GOOGLE_SHEET_CREATED"
        : "RETRO_GOOGLE_SHEET_UPDATED",
      targetType: "GOOGLE_SHEET",
      targetId: spreadsheetId,
      detailsJson: JSON.stringify({ tasksCount: tasks.length, created }),
    },
  });

  return {
    spreadsheetId,
    webViewLink,
    created,
    tasksCount: tasks.length,
  };
}
