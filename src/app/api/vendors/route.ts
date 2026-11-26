import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-error";
import { requireWorkspaceUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await requireWorkspaceUser(prisma);
    const vendors = await prisma.vendor.findMany({
      orderBy: [{ vigilanceExpiresAt: "asc" }, { name: "asc" }],
    });

    const nowMs = Date.now();
    const thirtyDaysMs = 30 * 86_400_000;

    return NextResponse.json({
      vendors: vendors.map((v) => {
        const validUntilMs = v.vigilanceExpiresAt?.getTime() ?? null;
        let vigilanceStatus: "VALID" | "EXPIRING_SOON" | "EXPIRED" | "MISSING" =
          "MISSING";
        if (validUntilMs !== null) {
          if (validUntilMs < nowMs) vigilanceStatus = "EXPIRED";
          else if (validUntilMs - nowMs <= thirtyDaysMs)
            vigilanceStatus = "EXPIRING_SOON";
          else vigilanceStatus = "VALID";
        }
        return {
          id: v.id,
          name: v.name,
          siret: v.siret,
          email: v.email,
          vigilanceDriveFileId: v.vigilanceDriveFileId,
          vigilanceFilename: v.vigilanceFilename,
          vigilanceUploadedAt: v.vigilanceIssuedAt?.toISOString() ?? null,
          vigilanceValidUntil: v.vigilanceExpiresAt?.toISOString() ?? null,
          vigilanceStatus,
        };
      }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
