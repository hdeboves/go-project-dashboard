import type { PrismaClient } from "@prisma/client";

export const VIGILANCE_VALIDITY_MONTHS = 6;

export function normalizeVendorKey(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function findValidVendorVigilance(
  prisma: PrismaClient,
  vendorName: string | null | undefined
): Promise<{
  vendorId: string;
  vigilanceDriveFileId: string;
  vigilanceFilename: string;
  vigilanceExpiresAt: Date;
} | null> {
  const key = normalizeVendorKey(vendorName);
  if (!key || key.length < 2) return null;

  const vendor = await prisma.vendor.findUnique({
    where: { normalizedName: key },
  });
  if (
    !vendor ||
    !vendor.vigilanceDriveFileId ||
    !vendor.vigilanceExpiresAt ||
    vendor.vigilanceExpiresAt <= new Date()
  ) {
    return null;
  }
  return {
    vendorId: vendor.id,
    vigilanceDriveFileId: vendor.vigilanceDriveFileId,
    vigilanceFilename:
      vendor.vigilanceFilename ?? `AttestationVigilance_${vendor.name}.pdf`,
    vigilanceExpiresAt: vendor.vigilanceExpiresAt,
  };
}

export async function recordVendorVigilance(
  prisma: PrismaClient,
  params: {
    vendorName: string;
    driveFileId: string;
    filename: string;
    issuedAt?: Date;
  }
): Promise<void> {
  const cleanName = params.vendorName.trim();
  const key = normalizeVendorKey(cleanName);
  if (!key || key.length < 2) return;

  const issuedAt = params.issuedAt ?? new Date();
  const expiresAt = new Date(issuedAt);
  expiresAt.setMonth(expiresAt.getMonth() + VIGILANCE_VALIDITY_MONTHS);

  await prisma.vendor.upsert({
    where: { normalizedName: key },
    update: {
      name: cleanName,
      vigilanceDriveFileId: params.driveFileId,
      vigilanceFilename: params.filename,
      vigilanceIssuedAt: issuedAt,
      vigilanceExpiresAt: expiresAt,
    },
    create: {
      name: cleanName,
      normalizedName: key,
      vigilanceDriveFileId: params.driveFileId,
      vigilanceFilename: params.filename,
      vigilanceIssuedAt: issuedAt,
      vigilanceExpiresAt: expiresAt,
    },
  });
}
