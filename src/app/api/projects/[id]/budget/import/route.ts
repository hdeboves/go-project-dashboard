import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import {
  getProjectBudget,
  importBudgetFromSheetCopy,
  importBudgetFromXlsx,
  syncBudgetFromAttachedSheet,
} from "@/lib/budget/service";
import { getServices } from "@/lib/container";
import { PILOT_SANDBOX_CONFIG } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import {
  normalizeProjectCategory,
  seedBlankBudgetForProject,
} from "@/lib/templates/project-templates";

const ImportJsonSchema = z.union([
  z.object({
    action: z.literal("refresh"),
  }),
  z.object({
    mode: z.literal("sync_from_sheet"),
  }),
  z.object({
    mode: z.literal("apply_blank_template"),
    category: z.enum(["JEU", "YOUTUBE", "EVENEMENT", "SPONSOR"]).optional(),
    replaceExisting: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal("copy_template").optional(),
    sourceSheetId: z.string().trim().min(1).optional(),
  }),
]);

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { prisma, getGoogleGateway } = getServices();
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, id, currentUser, "EDIT");
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const fileEntry = formData.get("file");

      if (!fileEntry || !(fileEntry instanceof File)) {
        throw new AppHttpError(
          400,
          "MISSING_FILE",
          "Aucun fichier .xlsx fourni dans le champ 'file'."
        );
      }

      const filename = fileEntry.name || "budget.xlsx";
      if (fileEntry.size > 8 * 1024 * 1024) {
        throw new AppHttpError(
          413,
          "FILE_TOO_LARGE",
          "Le fichier Excel dépasse la limite autorisée (8 Mo)."
        );
      }
      if (!/\.xlsx$/i.test(filename)) {
        throw new AppHttpError(
          422,
          "INVALID_BUDGET_XLSX",
          "Le fichier doit porter l'extension .xlsx."
        );
      }

      const arrayBuf = await fileEntry.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      // Verify ZIP / OOXML magic bytes (PK\x03\x04)
      if (
        buffer.length < 4 ||
        buffer[0] !== 0x50 ||
        buffer[1] !== 0x4b ||
        buffer[2] !== 0x03 ||
        buffer[3] !== 0x04
      ) {
        throw new AppHttpError(
          422,
          "INVALID_BUDGET_XLSX",
          "Le fichier fourni n'est pas un classeur Excel .xlsx valide."
        );
      }
      const result = await importBudgetFromXlsx({
        prisma,
        getGoogleGateway,
        projectId: id,
        buffer,
        filename,
      });

      return NextResponse.json(result, { status: 200 });
    }

    const rawText = await req.text();
    const parsedJson = rawText.trim() ? JSON.parse(rawText) : {};
    const body = ImportJsonSchema.parse(parsedJson);

    if (
      ("action" in body && body.action === "refresh") ||
      ("mode" in body && body.mode === "sync_from_sheet")
    ) {
      const result = await syncBudgetFromAttachedSheet({
        prisma,
        getGoogleGateway,
        projectId: id,
      });
      return NextResponse.json(result, { status: 200 });
    }

    if ("mode" in body && body.mode === "apply_blank_template") {
      const project = await prisma.project.findUnique({ where: { id } });
      if (!project) {
        throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
      }
      const targetCategory = normalizeProjectCategory(
        body.category ?? project.category
      );
      if (body.category && body.category !== project.category) {
        await prisma.project.update({
          where: { id },
          data: { category: targetCategory },
        });
      }
      await seedBlankBudgetForProject(prisma, id, targetCategory, {
        replaceExisting: body.replaceExisting ?? true,
      });
      const overview = await getProjectBudget(prisma, id);
      return NextResponse.json(
        { ok: true, category: targetCategory, ...overview },
        { status: 200 }
      );
    }

    const sourceSheetId =
      ("sourceSheetId" in body ? body.sourceSheetId : undefined) ||
      PILOT_SANDBOX_CONFIG.prodTemplates.budgetSheetId;

    const result = await importBudgetFromSheetCopy({
      prisma,
      getGoogleGateway,
      projectId: id,
      sourceSheetId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
