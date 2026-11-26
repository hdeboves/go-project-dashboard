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
});
