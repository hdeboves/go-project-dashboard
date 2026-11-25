import { describe, expect, it } from "vitest";
import { buildValidatedInvoiceFilename } from "@/lib/shared/filenames";

describe("M7 Drive Invoice Nomenclature (Numéro_CodeProjet_Prestataire_DateEmission.pdf)", () => {
  it("formats standard invoice filenames in exact required order", () => {
    const filename = buildValidatedInvoiceFilename({
      invoiceNumber: "FAC-2026-042",
      codeProjet: "326027",
      vendorName: "Vertigo Studio",
      invoiceDate: "2026-11-25",
    });

    expect(filename).toBe("FAC-2026-042_326027_VertigoStudio_2026-11-25.pdf");
  });

  it("normalizes slashes to dashes, strips unsafe chars and preserves French accents", () => {
    const filename = buildValidatedInvoiceFilename({
      invoiceNumber: " F/2026_09 ",
      codeProjet: "CP 326099",
      vendorName: "L'Atelier ../Éphémère & Co",
      invoiceDate: "2026-09-22",
    });

    expect(filename).toBe("F-202609_CP326099_LAtelierÉphémèreCo_2026-09-22.pdf");
    expect(filename.split("_")).toHaveLength(4);
  });

  it("normalizes French DD/MM/YYYY dates and rejects impossible calendar dates", () => {
    const frDate = buildValidatedInvoiceFilename({
      invoiceNumber: "INV-01",
      codeProjet: "326027",
      vendorName: "Studio",
      invoiceDate: "15/03/2026",
    });
    expect(frDate).toBe("INV-01_326027_Studio_2026-03-15.pdf");

    const invalidDate = buildValidatedInvoiceFilename({
      invoiceNumber: "INV-02",
      codeProjet: "326027",
      vendorName: "Studio",
      invoiceDate: "2026-02-31",
    });
    expect(invalidDate).not.toContain("2026-02-31");
    expect(invalidDate).toMatch(/^INV-02_326027_Studio_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("falls back safely when invoiceNumber is missing or blank", () => {
    const filename = buildValidatedInvoiceFilename({
      invoiceNumber: "   ",
      codeProjet: "326027",
      vendorName: "Audio Lab",
      invoiceDate: "2026-10-01",
    });

    expect(filename).toBe("SANS-NUM_326027_AudioLab_2026-10-01.pdf");
  });
});
