import { describe, expect, it } from "vitest";
import {
  type BudgetLineLike,
  computeBudgetMetrics,
  fromCents,
  toCents,
} from "@/lib/budget/calculator";

function makeLine(overrides: Partial<BudgetLineLike>): BudgetLineLike {
  return {
    id: overrides.id ?? "line_1",
    category: overrides.category ?? "PRODUCTION",
    objet: overrides.objet ?? "Poste Test",
    realisePar: overrides.realisePar ?? null,
    expenseType: overrides.expenseType ?? "Externe",
    saleQty: overrides.saleQty ?? 1,
    saleDays: overrides.saleDays ?? 1,
    saleUnitPrice: overrides.saleUnitPrice ?? 0,
    saleTotalHt: overrides.saleTotalHt ?? 0,
    preOpUnitCost: overrides.preOpUnitCost ?? 0,
    preOpTotalHt: overrides.preOpTotalHt ?? 0,
    postOpQty: overrides.postOpQty ?? 0,
    postOpDays: overrides.postOpDays ?? 0,
    postOpUnitCost: overrides.postOpUnitCost ?? 0,
    postOpTotalHt: overrides.postOpTotalHt ?? 0,
  };
}

describe("M2 Budget KPIs, Integer-Cent Math, Categories & 85%/100% Alerts", () => {
  it("computes exact KPIs and French aliases using integer-cent arithmetic (no 0.1+0.2 float drift)", () => {
    const lines: BudgetLineLike[] = [
      makeLine({
        id: "l1",
        category: "PRODUCTION",
        objet: "Dev Map",
        expenseType: "Externe",
        saleTotalHt: 100.1,
        preOpTotalHt: 50.1,
        postOpTotalHt: 0.1,
      }),
      makeLine({
        id: "l2",
        category: "PRODUCTION",
        objet: "Equipe Interne",
        expenseType: "RH Internes",
        saleTotalHt: 99.9,
        preOpTotalHt: 20.2,
        postOpTotalHt: 0.2,
      }),
      makeLine({
        id: "l3",
        category: "MATERIEL",
        objet: "Serveurs",
        expenseType: "Amortissement",
        saleTotalHt: 50,
        preOpTotalHt: 10,
        postOpTotalHt: 5,
      }),
    ];

    const res = computeBudgetMetrics(lines);

    expect(res.summary.soldTotalHt).toBe(250);
    expect(res.summary.soldHt).toBe(250);
    expect(res.summary.prixVenduHt).toBe(250);

    expect(res.summary.preOpExternalHt).toBe(50.1);
    expect(res.summary.preOpRhHt).toBe(20.2);
    expect(res.summary.preOpAmortHt).toBe(10);
    expect(res.summary.preOpTotalHt).toBe(80.3);
    expect(res.summary.coutsPreOpTotal).toBe(80.3);

    expect(res.summary.postOpTotalHt).toBe(5.3);
    expect(res.summary.coutsPostOpTotal).toBe(5.3);
    expect(res.summary.remainingToCommitHt).toBe(75);
    expect(res.summary.resteAEngager).toBe(75);

    expect(res.summary.grossMarginHt).toBe(199.9);
    expect(res.summary.grossMarginPct).toBe(79.96);
    expect(res.summary.plannedMarginHt).toBe(169.7);
    expect(res.summary.margePrevueHt).toBe(169.7);
    expect(res.summary.plannedMarginPct).toBe(67.88);
    expect(res.summary.realMarginHt).toBe(244.7);
    expect(res.summary.margeReelleHt).toBe(244.7);
    expect(res.summary.realMarginPct).toBe(97.88);

    // Category breakdown sums match summary to the cent
    const sumCatSoldCents = res.categories.reduce(
      (s, c) => s + toCents(c.soldTotalHt),
      0
    );
    const sumCatPreCents = res.categories.reduce(
      (s, c) => s + toCents(c.preOpTotalHt),
      0
    );
    const sumCatPostCents = res.categories.reduce(
      (s, c) => s + toCents(c.postOpTotalHt),
      0
    );
    expect(fromCents(sumCatSoldCents)).toBe(res.summary.soldTotalHt);
    expect(fromCents(sumCatPreCents)).toBe(res.summary.preOpTotalHt);
    expect(fromCents(sumCatPostCents)).toBe(res.summary.postOpTotalHt);
  });

  it("evaluates 85% and 100% alerts BEFORE display rounding (84.99% none, 85.00% WARNING, 99.999% WARNING, 100.00% CRITICAL)", () => {
    const lines: BudgetLineLike[] = [
      makeLine({
        id: "bva_8499",
        objet: "Ligne 84.99%",
        preOpTotalHt: 10000,
        postOpTotalHt: 8499,
      }),
      makeLine({
        id: "bva_8500",
        objet: "Ligne 85.00%",
        preOpTotalHt: 10000,
        postOpTotalHt: 8500,
      }),
      makeLine({
        id: "bva_99999",
        objet: "Ligne 99.999%",
        preOpTotalHt: 1000,
        postOpTotalHt: 999.99,
      }),
      makeLine({
        id: "bva_10000",
        objet: "Ligne 100.00%",
        preOpTotalHt: 1000,
        postOpTotalHt: 1000,
      }),
      makeLine({
        id: "bva_overrun",
        objet: "Ligne 120.00%",
        preOpTotalHt: 1000,
        postOpTotalHt: 1200,
      }),
    ];

    const res = computeBudgetMetrics(lines);

    expect(res.alerts.find((a) => a.budgetLineId === "bva_8499")).toBeUndefined();

    const warn85 = res.alerts.find((a) => a.budgetLineId === "bva_8500");
    expect(warn85).toMatchObject({
      level: "WARNING",
      thresholdPct: 85,
      ratioPct: 85,
    });

    const warn99 = res.alerts.find((a) => a.budgetLineId === "bva_99999");
    expect(warn99).toMatchObject({
      level: "WARNING",
      thresholdPct: 85,
    });

    const crit100 = res.alerts.find((a) => a.budgetLineId === "bva_10000");
    expect(crit100).toMatchObject({
      level: "CRITICAL",
      thresholdPct: 100,
      ratioPct: 100,
    });

    const critOver = res.alerts.find((a) => a.budgetLineId === "bva_overrun");
    expect(critOver).toMatchObject({
      level: "CRITICAL",
      thresholdPct: 100,
      ratioPct: 120,
    });

    // Remaining to commit clamps overrun to 0 per line: 1501 + 1500 + 0.01 + 0 + 0 = 3001.01
    expect(res.summary.remainingToCommitHt).toBe(3001.01);
  });

  it("handles preOpTotalHt === 0 && postOpTotalHt > 0 (Visuels Print) and soldTotalHt === 0 without NaN or Infinity", () => {
    const lines: BudgetLineLike[] = [
      makeLine({
        id: "visuels_print",
        objet: "Visuels Print",
        saleTotalHt: 0,
        preOpTotalHt: 0,
        postOpTotalHt: 2671.5,
      }),
      makeLine({
        id: "zero_both",
        objet: "Ligne vide",
        saleTotalHt: 0,
        preOpTotalHt: 0,
        postOpTotalHt: 0,
      }),
    ];

    const res = computeBudgetMetrics(lines);

    expect(res.summary.plannedMarginPct).toBe(0);
    expect(res.summary.realMarginPct).toBe(0);
    expect(res.summary.grossMarginPct).toBe(0);
    expect(Number.isFinite(res.summary.realMarginPct)).toBe(true);

    expect(res.alerts).toHaveLength(1);
    expect(res.alerts[0]).toMatchObject({
      budgetLineId: "visuels_print",
      level: "CRITICAL",
      thresholdPct: 100,
      unbudgeted: true,
      ratioPct: 100,
    });

    const json = JSON.stringify(res);
    expect(json).not.toContain("NaN");
    expect(json).not.toContain("Infinity");
    expect(json).not.toContain("null"); // ratioPct is finite 100
  });
});
