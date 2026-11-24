/**
 * Pure-JS Minimal PDF 1.4 Generator & Invoice Fixtures for GO Project Hub E2E Suite.
 * Produces byte-accurate PDF 1.4 buffers with valid xref offsets and WinAnsiEncoding text streams.
 * Zero external dependencies (no pdf-lib, no src/, no prisma/).
 */

import { Buffer } from "node:buffer";

export interface PdfFixtureSpec {
  filename: string;
  mimeType: "application/pdf";
  buffer: Buffer;
  expected: {
    vendorName: string;
    invoiceNumber: string;
    invoiceDate: string;
    amountHt: number;
    tvaAmount: number;
    amountTtc: number;
    invoiceType: "ACOMPTE" | "SOLDE" | "UNIQUE";
    codeProjet: string;
    prestationSummary: string;
    expectedRenamedFilename: string;
  };
}

export function escapePdfAscii(input: string): string {
  const normalized = input
    .replace(/€/g, "EUR")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  let out = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    if (code < 32 || code > 126) {
      out += " ";
      continue;
    }
    const ch = normalized[i];
    if (ch === "\\" || ch === "(" || ch === ")") {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return out;
}

export function buildMinimalPdfBuffer(lines: readonly string[], title = "Facture"): Buffer {
  const textCommands = lines
    .map((line, index) => {
      const escaped = escapePdfAscii(line);
      return index === 0 ? `(${escaped}) Tj` : `T* (${escaped}) Tj`;
    })
    .join("\n");

  const streamContent =
    lines.length > 0
      ? `BT\n/F1 11 Tf\n50 780 Td\n16 TL\n${textCommands}\nET\n`
      : "BT\n/F1 11 Tf\n50 780 Td\nET\n";
  const streamByteLen = Buffer.byteLength(streamContent, "latin1");

  const objects: string[] = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`,
    `5 0 obj\n<< /Length ${streamByteLen} >>\nstream\n${streamContent}endstream\nendobj\n`,
    `6 0 obj\n<< /Title (${escapePdfAscii(title)}) >>\nendobj\n`,
  ];

  const chunks: Buffer[] = [];
  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1");
  chunks.push(header);

  let currentOffset = header.length;
  const offsets: number[] = [];

  for (const objStr of objects) {
    offsets.push(currentOffset);
    const buf = Buffer.from(objStr, "latin1");
    chunks.push(buf);
    currentOffset += buf.length;
  }

  const xrefOffset = currentOffset;
  const xrefLines: string[] = [
    `xref\n`,
    `0 ${objects.length + 1}\n`,
    `0000000000 65535 f\r\n`,
  ];
  for (const off of offsets) {
    xrefLines.push(`${String(off).padStart(10, "0")} 00000 n\r\n`);
  }
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  chunks.push(Buffer.from(xrefLines.join("") + trailer, "latin1"));
  return Buffer.concat(chunks);
}

export function createInvoicePdfFixture(params: {
  codeProjet: string;
  vendorName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  amountHt?: number;
  invoiceType?: "ACOMPTE" | "SOLDE" | "UNIQUE";
  prestationSummary?: string;
  filename?: string;
}): PdfFixtureSpec {
  const vendorName = params.vendorName ?? "Vertigo Studio";
  const invoiceNumber = params.invoiceNumber ?? "FAC-2026-0142";
  const invoiceDate = params.invoiceDate ?? "2026-09-05";
  const amountHt = params.amountHt ?? 3000;
  const tvaAmount = Number((amountHt * 0.2).toFixed(2));
  const amountTtc = Number((amountHt + tvaAmount).toFixed(2));
  const invoiceType = params.invoiceType ?? "ACOMPTE";
  const prestationSummary = params.prestationSummary ?? "Mapping Fortnite";
  const sanitizedVendor = vendorName.replace(/[^a-zA-Z0-9À-ÿ-]/g, "");
  const formattedHt = Number.isInteger(amountHt) ? String(amountHt) : amountHt.toFixed(2);
  const expectedRenamedFilename = `${invoiceDate}_${params.codeProjet}_${sanitizedVendor}_${formattedHt}EUR.pdf`;
  const filename = params.filename ?? `facture_${sanitizedVendor}_${params.codeProjet}.pdf`;

  const lines = [
    `FACTURE ${invoiceNumber}`,
    `Prestataire: ${vendorName}`,
    `Client: GamersOrigin`,
    `Date: ${invoiceDate}`,
    `Code Projet: CP ${params.codeProjet}`,
    `Type: ${invoiceType}`,
    `Prestation: ${prestationSummary}`,
    `Montant HT: ${amountHt.toFixed(2)} EUR`,
    `TVA 20%: ${tvaAmount.toFixed(2)} EUR`,
    `Montant TTC: ${amountTtc.toFixed(2)} EUR`,
  ];

  return {
    filename,
    mimeType: "application/pdf",
    buffer: buildMinimalPdfBuffer(lines, `Facture ${invoiceNumber}`),
    expected: {
      vendorName,
      invoiceNumber,
      invoiceDate,
      amountHt,
      tvaAmount,
      amountTtc,
      invoiceType,
      codeProjet: params.codeProjet,
      prestationSummary,
      expectedRenamedFilename,
    },
  };
}

export const VALID_INVOICE_ACOMPTE_326027: PdfFixtureSpec = createInvoicePdfFixture({
  codeProjet: "326027",
  vendorName: "Vertigo Studio",
  invoiceNumber: "FAC-2026-0142",
  invoiceDate: "2026-09-05",
  amountHt: 3000,
  invoiceType: "ACOMPTE",
  prestationSummary: "Mapping Fortnite Acompte",
  filename: "vertigo_acompte_326027.pdf",
});

export const VALID_INVOICE_SOLDE_326027: PdfFixtureSpec = createInvoicePdfFixture({
  codeProjet: "326027",
  vendorName: "Vertigo Studio",
  invoiceNumber: "FAC-2026-0198",
  invoiceDate: "2026-09-25",
  amountHt: 3000,
  invoiceType: "SOLDE",
  prestationSummary: "Mapping Fortnite Solde",
  filename: "vertigo_solde_326027.pdf",
});

export const VALID_INVOICE_85_PCT_326027: PdfFixtureSpec = createInvoicePdfFixture({
  codeProjet: "326027",
  vendorName: "Agency Alpha",
  invoiceNumber: "FAC-2026-0210",
  invoiceDate: "2026-09-12",
  amountHt: 880,
  invoiceType: "UNIQUE",
  prestationSummary: "DA Charte Graphique",
  filename: "agency_alpha_880_326027.pdf",
});

export const VALID_INVOICE_100_PCT_326027: PdfFixtureSpec = createInvoicePdfFixture({
  codeProjet: "326027",
  vendorName: "Agency Alpha",
  invoiceNumber: "FAC-2026-0211",
  invoiceDate: "2026-09-18",
  amountHt: 1200,
  invoiceType: "SOLDE",
  prestationSummary: "DA Charte Graphique Depassement",
  filename: "agency_alpha_1200_326027.pdf",
});

export const CONFLICT_INVOICE_CRISTALINE_326018: PdfFixtureSpec = createInvoicePdfFixture({
  codeProjet: "326018",
  vendorName: "Studio Cristaline",
  invoiceNumber: "QF08-2026",
  invoiceDate: "2026-09-10",
  amountHt: 1500,
  invoiceType: "UNIQUE",
  prestationSummary: "Production Cristaline",
  filename: "Facture QF08_326018.pdf",
});

export const CONFLICT_INVOICE_TEXT_ONLY_326018: PdfFixtureSpec = createInvoicePdfFixture({
  codeProjet: "326018",
  vendorName: "Studio Cristaline",
  invoiceNumber: "QF09-2026",
  invoiceDate: "2026-09-11",
  amountHt: 950,
  invoiceType: "UNIQUE",
  prestationSummary: "Animation Cristaline",
  filename: "scan_recu_01.pdf",
});

export const CORRUPT_PDF_BUFFER: Buffer = Buffer.from("NOT_A_VALID_PDF_BYTES_CORRUPT_HEADER", "utf8");
export const EMPTY_TEXT_PDF_BUFFER: Buffer = buildMinimalPdfBuffer([], "Empty Invoice");
