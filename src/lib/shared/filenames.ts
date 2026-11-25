import { normalizeIsoDate } from "@/lib/shared/format";

/**
 * Single source of truth (client + server) for Drive invoice naming convention:
 * Numéro de la facture_code projet_nom du prestataire_date d'émission.pdf
 */
export function buildValidatedInvoiceFilename(params: {
  invoiceNumber?: string | null;
  invoiceDate: string;
  codeProjet: string;
  vendorName: string;
  amountHt?: number;
}): string {
  const safeNum =
    (params.invoiceNumber ?? "")
      .trim()
      .normalize("NFC")
      .replace(/\//g, "-")
      .replace(/[^a-zA-Z0-9À-ÿ-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "SANS-NUM";

  const safeCp =
    params.codeProjet.trim().replace(/[^0-9A-Za-z-]/g, "") || "000000";

  const safePresta =
    params.vendorName
      .trim()
      .normalize("NFC")
      .replace(/[^a-zA-Z0-9À-ÿ-]/g, "") || "Prestataire";

  const normalizedDate = normalizeIsoDate(params.invoiceDate);
  const safeDate = normalizedDate ?? new Date().toISOString().slice(0, 10);

  return `${safeNum}_${safeCp}_${safePresta}_${safeDate}.pdf`;
}

export function sanitizeContentDispositionFilename(name: string): string {
  return (
    name
      .replace(/[\r\n"\\]/g, "_")
      .replace(/[^\x20-\x7EÀ-ÿ]/g, "")
      .trim() || "document.pdf"
  );
}
