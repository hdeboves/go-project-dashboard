import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  importBudgetFromSheetCopy,
  importBudgetFromXlsx,
  syncBudgetFromAttachedSheet,
} from "@/lib/budget/service";
import { getServices } from "@/lib/container";
import { PILOT_SANDBOX_CONFIG } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";

const ImportJsonSchema = z.union([
  z.object({
    action: z.literal("refresh"),
  }),
  z.object({
    mode: z.literal("sync_from_sheet"),
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
      if (
        !/\.xlsx$/i.test(filename) &&
        fileEntry.type &&
        !fileEntry.type.includes("spreadsheetml") &&
        fileEntry.type !== "application/octet-stream"
      ) {
        throw new AppHttpError(
          422,
          "INVALID_BUDGET_XLSX",
          "Le fichier doit être au format Excel .xlsx."
        );
      }

      const arrayBuf = await fileEntry.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
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
