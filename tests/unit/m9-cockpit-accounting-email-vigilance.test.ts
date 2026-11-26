import { describe, expect, it } from "vitest";
import {
  MANDATORY_ACCOUNTING_CC,
  MANDATORY_ACCOUNTING_TO,
  USER_ROLES,
  normalizeUserRole,
} from "@/lib/auth/roles";
import {
  buildAccountingCcEntries,
  buildAccountingEmailBody,
  buildAccountingEmailSubject,
  evaluateInvoiceVerificationWarnings,
  getAccountingToAddress,
  requiresVigilanceAttestation,
} from "@/lib/invoices/accounting-email";
import {
  extractInvoiceFieldsFromText,
  isOwnCompanyName,
} from "@/lib/invoices/local-extractor";
import { buildValidatedInvoiceFilename } from "@/lib/shared/filenames";

describe("M9 Cockpit Invoice Dropzone, Vigilance >3k€, Multi-CP, Roles & Accounting Drafts", () => {
  it("enforces mandatory Pennylane To address and mandatory Accounting CC addresses", () => {
    expect(getAccountingToAddress()).toBe(
      "gamersorigin-8j117x7x@suppliers.pennylane.com"
    );
    expect(MANDATORY_ACCOUNTING_TO).toBe(
      "gamersorigin-8j117x7x@suppliers.pennylane.com"
    );
    expect(MANDATORY_ACCOUNTING_CC).toEqual([
      "s.aslam@gamersorigin.com",
      "louis.berody@gamersorigin.com",
    ]);

    const cc = buildAccountingCcEntries({
      projectCollaborators: [
        { email: "paul@gamersorigin.com", name: "Paul", role: "CHEF_DE_PROJET" },
        { email: "claire@gamersorigin.com", name: "Claire", role: "CHEF_DE_PROJET" },
      ],
      accountingUsers: [
        { email: "compta@gamersorigin.com", name: "Service Compta" },
        { email: "s.aslam@gamersorigin.com", name: "Souleimane" }, // duplicate test
      ],
      currentUserEmail: "paul@gamersorigin.com", // duplicate test
    });

    const emails = cc.map((e) => e.email);
    expect(emails).toEqual([
      "s.aslam@gamersorigin.com",
      "louis.berody@gamersorigin.com",
      "compta@gamersorigin.com",
      "paul@gamersorigin.com",
      "claire@gamersorigin.com",
    ]);
    expect(cc[0].mandatory).toBe(true);
    expect(cc[1].mandatory).toBe(true);
  });

  it("formats exact accounting email subject & body for single and multi-project invoices", () => {
    expect(
      buildAccountingEmailSubject({
        projectCodes: ["326027"],
        vendorName: "Vertigo Studio",
      })
    ).toBe("Facture - 326027 - Vertigo Studio");

    expect(
      buildAccountingEmailSubject({
        projectCodes: ["326027", "326018"],
        vendorName: "Vertigo Studio",
      })
    ).toBe("Facture - 326027 / 326018 - Vertigo Studio");

    expect(
      buildAccountingEmailBody({
        projectCodes: ["326027"],
        vendorName: "Vertigo Studio",
      })
    ).toBe(
      "Hello,\n\nVous trouverez en pièce jointe la facture de Vertigo Studio pour le 326027\n\nMerci"
    );

    expect(
      buildAccountingEmailBody({
        projectCodes: ["326027", "326018"],
        vendorName: "Vertigo Studio",
      })
    ).toBe(
      "Hello,\n\nVous trouverez en pièce jointe la facture de Vertigo Studio pour le 326027 / 326018\n\nMerci"
    );
  });

  it("triggers attestation de vigilance reminder strictly above 3 000 €", () => {
    expect(requiresVigilanceAttestation(2500, 3000)).toBe(false);
    expect(requiresVigilanceAttestation(3000, 3000)).toBe(false);
    expect(requiresVigilanceAttestation(3000.01, 3600.01)).toBe(true);
    expect(requiresVigilanceAttestation(2800, 3360)).toBe(true);
  });

  it("reports explicit warnings for every unmet condition and clears them once satisfied", () => {
    const warnings = evaluateInvoiceVerificationWarnings({
      vendorName: "",
      invoiceNumber: "",
      invoiceDate: "bad-date",
      amountHt: 4500,
      amountTtc: 5400,
      budgetLineId: "",
      activeProjectCode: "326027",
      projectCodes: ["326027", "326018"],
      multiProjectConfirmed: false,
      hasVigilanceAttestation: false,
    });

    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("MISSING_VENDOR");
    expect(codes).toContain("MISSING_INVOICE_NUMBER");
    expect(codes).toContain("INVALID_DATE");
    expect(codes).toContain("MISSING_BUDGET_LINE");
    expect(codes).toContain("MULTI_CP_UNCONFIRMED");
    expect(codes).toContain("VIGILANCE_REQUIRED");

    const cleanWarnings = evaluateInvoiceVerificationWarnings({
      vendorName: "Vertigo Studio",
      invoiceNumber: "FAC-2026-099",
      invoiceDate: "2026-11-26",
      amountHt: 4500,
      amountTtc: 5400,
      budgetLineId: "line-1",
      activeProjectCode: "326027",
      projectCodes: ["326027", "326018"],
      multiProjectConfirmed: true,
      hasVigilanceAttestation: true,
    });
    expect(cleanWarnings).toHaveLength(0);
  });

  it("supports all 4 team roles (ADMIN, CHEF_DE_PROJET, COMPTA, MEMBER)", () => {
    expect(USER_ROLES).toEqual(["ADMIN", "CHEF_DE_PROJET", "COMPTA", "MEMBER"]);
    expect(normalizeUserRole("CHEF_DE_PROJET")).toBe("CHEF_DE_PROJET");
    expect(normalizeUserRole("COMPTA")).toBe("COMPTA");
    expect(normalizeUserRole("ADMIN")).toBe("ADMIN");
    expect(normalizeUserRole("unknown")).toBe("MEMBER");
  });

  it("excludes GamersOrigin and L'Intrus as buyer and auto-fills all invoice fields + nomenclature", () => {
    expect(isOwnCompanyName("GamersOrigin")).toBe(true);
    expect(isOwnCompanyName("SAS Gamers Origin")).toBe(true);
    expect(isOwnCompanyName("L'Intrus")).toBe(true);
    expect(isOwnCompanyName("SAS L'INTRUS")).toBe(true);
    expect(isOwnCompanyName("Studio Vertigo SAS")).toBe(false);

    // Case 1: Two-column French invoice billed to GamersOrigin with multi-CP & quote
    const invoiceTextGo = [
      "Studio Vertigo SAS  |  Facturé à : GamersOrigin SAS",
      "12 rue de la Paix  |  45 rue du Faubourg Saint-Denis",
      "75002 Paris  |  75010 Paris",
      "FACTURE N° FA-2026-042",
      "Date d'émission : 14/11/2026",
      "Date d'échéance : 14/12/2026",
      "Référence devis : DEV-2026-11",
      "Objet : Production Map Fortnite CP 326027 / CP 326018",
      "Désignation | Qté | Prix HT | Total HT",
      "Développement niveau principal | 1 | 3 500,00 € | 3 500,00 €",
      "Total HT : 3 500,00 €",
      "TVA (20%) : 700,00 €",
      "Net à payer TTC : 4 200,00 €",
    ].join("\n");

    const resGo = extractInvoiceFieldsFromText({
      pdfText: invoiceTextGo,
      filename: "scan_upload_001.pdf",
      activeCodeProjet: "326027",
      knownProjectCodes: ["326027", "326018", "326099"],
      quotes: [
        {
          id: "quote-11",
          quoteNumber: "DEV-2026-11",
          vendorName: "Studio Vertigo SAS",
          amountHt: 3500,
          budgetLineId: "line-prod-1",
        },
      ],
    });

    expect(resGo.prestataire).toBe("Studio Vertigo SAS");
    expect(resGo.numeroFacture).toBe("FA-2026-042");
    expect(resGo.dateFacture).toBe("2026-11-14");
    expect(resGo.montantHT).toBe(3500);
    expect(resGo.tvaRate).toBe(20);
    expect(resGo.montantTTC).toBe(4200);
    expect(resGo.detectedProjectCodes).toEqual(["326027", "326018"]);
    expect(resGo.suggestedQuoteId).toBe("quote-11");
    expect(resGo.suggestedBudgetLineId).toBe("line-prod-1");
    expect(resGo.prestationSummary).toContain("Production Map Fortnite");

    const autoName = buildValidatedInvoiceFilename({
      invoiceNumber: resGo.numeroFacture,
      invoiceDate: resGo.dateFacture,
      codeProjet: resGo.detectedProjectCodes.join("-"),
      vendorName: resGo.prestataire,
    });
    expect(autoName).toBe(
      "FA-2026-042_326027-326018_StudioVertigoSAS_2026-11-14.pdf"
    );

    // Case 2: Freelance invoice billed to L'Intrus with TVA non applicable (art. 293 B) and French month date
    const invoiceTextIntrus = [
      "Facturé à :",
      "L'Intrus",
      "10 rue de Lyon",
      "75012 Paris",
      "",
      "Émetteur : Maxime Laurent Creative",
      "Facture n° F2026-088",
      "Émise le 15 octobre 2026",
      "Échéance : 15 novembre 2026",
      "Prestation : Montage Reels campagne lancement",
      "Total : 1 250,00 €",
      "TVA non applicable, art. 293 B du CGI",
    ].join("\n");

    const resIntrus = extractInvoiceFieldsFromText({
      pdfText: invoiceTextIntrus,
      filename: "facture_octobre.pdf",
      activeCodeProjet: "326050",
      knownProjectCodes: ["326050"],
    });

    expect(resIntrus.prestataire).toBe("Maxime Laurent Creative");
    expect(resIntrus.numeroFacture).toBe("F2026-088");
    expect(resIntrus.dateFacture).toBe("2026-10-15");
    expect(resIntrus.montantHT).toBe(1250);
    expect(resIntrus.tvaRate).toBe(0);
    expect(resIntrus.montantTTC).toBe(1250);
    expect(resIntrus.prestationSummary).toBe(
      "Montage Reels campagne lancement"
    );
  });
});
