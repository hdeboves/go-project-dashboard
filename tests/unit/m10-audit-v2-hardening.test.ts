import { describe, expect, it } from "vitest";
import { isAllowedWorkspaceEmail } from "@/lib/auth/session";
import { computeBudgetMetrics } from "@/lib/budget/calculator";
import { stripInvoiceBinaries } from "@/lib/invoices/ingest";
import {
  getParisTodayIso,
  getParisWorkWeekWindow,
  isCalendarDateLate,
  startOfParisTodayUtc,
} from "@/lib/shared/dates";
import {
  DEFAULT_BUDGET_TEMPLATES,
  PROJECT_CATEGORIES,
  normalizeProjectCategory,
} from "@/lib/templates/project-templates";
import {
  VIGILANCE_VALIDITY_MONTHS,
  normalizeVendorKey,
} from "@/lib/vendors/vendor-service";

describe("M10 Audit V2 Hardening — Auth, Paris Dates, Engagé Margin, PROD_CREA & Vendor Vault", () => {
  it("enforces GamersOrigin and L'Intrus workspace email domains", () => {
    expect(isAllowedWorkspaceEmail("paul@gamersorigin.com")).toBe(true);
    expect(isAllowedWorkspaceEmail("alice@lintrus.fr")).toBe(true);
    expect(isAllowedWorkspaceEmail("bob@lintrus.com")).toBe(true);
    expect(isAllowedWorkspaceEmail("Paul.Test@GamersOrigin.com")).toBe(true);
    expect(isAllowedWorkspaceEmail("external@gmail.com")).toBe(false);
    expect(isAllowedWorkspaceEmail("attacker@evil-gamersorigin.com")).toBe(
      false
    );
    expect(isAllowedWorkspaceEmail("not-an-email")).toBe(false);
  });

  it("computes Paris calendar dates and late-task thresholds deterministically", () => {
    const todayIso = getParisTodayIso();
    expect(todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const startUtc = startOfParisTodayUtc();
    expect(startUtc.toISOString().startsWith(todayIso)).toBe(true);

    // A date clearly in the past is late; far future is not late
    expect(isCalendarDateLate(new Date("2020-01-01T12:00:00Z"))).toBe(true);
    expect(isCalendarDateLate(new Date("2099-01-01T12:00:00Z"))).toBe(false);
    expect(isCalendarDateLate(null)).toBe(false);

    const week = getParisWorkWeekWindow();
    expect(week.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(week.weekEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(week.weekEnd >= week.weekStart).toBe(true);
  });

  it("strips binary PDF blobs and legacy base64/local paths from invoice responses", () => {
    const cleaned = stripInvoiceBinaries({
      id: "inv_1",
      vendorName: "Studio Vertigo",
      pdfData: Buffer.from("%PDF-1.7"),
      vigilancePdfData: Buffer.from("%PDF-1.7"),
      extractedJson: JSON.stringify({
        prestataire: "Studio Vertigo",
        pdfBase64: "JVBERi0xLj...",
        localPdfPath: "/tmp/secret.pdf",
      }),
    });

    expect("pdfData" in cleaned).toBe(false);
    expect("vigilancePdfData" in cleaned).toBe(false);
    const parsed = JSON.parse(cleaned.extractedJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(parsed.prestataire).toBe("Studio Vertigo");
    expect(parsed.pdfBase64).toBeUndefined();
    expect(parsed.localPdfPath).toBeUndefined();
  });

  it("factors committed accepted quotes (Engagé) into forecastCostHt & forecastMarginPct", () => {
    const res = computeBudgetMetrics([
      {
        id: "l1",
        category: "PRODUCTION",
        objet: "Développement Map",
        expenseType: "Externe",
        saleQty: 1,
        saleDays: 1,
        saleUnitPrice: 20000,
        saleTotalHt: 20000,
        preOpUnitCost: 10000,
        preOpTotalHt: 10000,
        committedHt: 14000, // Accepted quote exceeds pre-op by 4000 €!
        postOpQty: 1,
        postOpDays: 1,
        postOpUnitCost: 5000,
        postOpTotalHt: 5000,
      },
    ]);

    expect(res.summary.committedTotalHt).toBe(14000);
    // forecastCostHt = max(10000, 14000, 5000) = 14000 (not 10000!)
    expect(res.summary.forecastCostHt).toBe(14000);
    expect(res.summary.forecastMarginHt).toBe(6000);
    expect(res.summary.forecastMarginPct).toBe(30);
  });

  it("includes PROD_CREA category and neutral 'Interne agence' template labels", () => {
    expect(PROJECT_CATEGORIES).toContain("PROD_CREA");
    expect(normalizeProjectCategory("prod_crea")).toBe("PROD_CREA");
    expect(normalizeProjectCategory("video")).toBe("PROD_CREA");
    expect(DEFAULT_BUDGET_TEMPLATES.PROD_CREA.length).toBeGreaterThanOrEqual(8);

    for (const cat of PROJECT_CATEGORIES) {
      for (const line of DEFAULT_BUDGET_TEMPLATES[cat]) {
        expect(line.realisePar ?? "").not.toMatch(/Interne GO/i);
      }
    }
  });

  it("normalizes vendor keys consistently and enforces 6-month URSSAF validity", () => {
    expect(normalizeVendorKey("  Studio Éclair SAS  ")).toBe("studio eclair sas");
    expect(normalizeVendorKey("STUDIO ECLAIR-SAS")).toBe("studio eclair sas");
    expect(VIGILANCE_VALIDITY_MONTHS).toBe(6);
  });
});
