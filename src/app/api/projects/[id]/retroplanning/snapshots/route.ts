import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { getGoogleGateway } from "@/lib/container";
import { prisma } from "@/lib/prisma";
import {
  createRetroSnapshot,
  listAndCompareSnapshots,
} from "@/lib/retroplanning/snapshot-service";

const CreateSnapshotSchema = z
  .object({
    snapshotDate: z.string().optional(),
    mode: z.enum(["MANUAL", "AUTO_14D"]).optional(),
  })
  .optional()
  .default({});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const fromId = req.nextUrl.searchParams.get("fromId");
    const toId = req.nextUrl.searchParams.get("toId");

    const res = await listAndCompareSnapshots(prisma, id, { fromId, toId });
    return NextResponse.json({
      snapshots: res.snapshots,
      ...(res.comparison ? { comparison: res.comparison } : {}),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let rawBody: unknown = {};
    const text = await req.text();
    if (text.trim().length > 0) {
      rawBody = JSON.parse(text);
    }
    const parsed = CreateSnapshotSchema.parse(rawBody);

    const res = await createRetroSnapshot(
      prisma,
      id,
      () => getGoogleGateway(id),
      {
        snapshotDate: parsed.snapshotDate,
        mode: parsed.mode ?? "MANUAL",
      }
    );

    return NextResponse.json(
      {
        ok: true,
        skipped: res.skipped,
        snapshot: res.snapshot,
        fileName: res.fileName,
      },
      { status: res.skipped ? 200 : 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
