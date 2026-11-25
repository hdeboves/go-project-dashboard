export type NormalizedExpenseType = "Externe" | "RH Internes" | "Amortissement";

export interface BudgetLineLike {
  id: string;
  category: string;
  objet: string;
  realisePar?: string | null;
  expenseType: string;
  saleQty: number;
  saleDays: number;
  saleUnitPrice: number;
  saleTotalHt: number;
  preOpUnitCost: number;
  preOpTotalHt: number;
  postOpQty: number;
  postOpDays: number;
  postOpUnitCost: number;
  postOpTotalHt: number;
  sheetRowIndex?: number | null;
  invoiceNumbersNote?: string | null;
}

export interface BudgetSummary {
  soldTotalHt: number;
  soldHt: number;
  preOpTotalHt: number;
  preOpHt: number;
  preOpExternalHt: number;
  preOpRhHt: number;
  preOpAmortHt: number;
  postOpTotalHt: number;
  postOpHt: number;
  postOpExternalHt: number;
  postOpRhHt: number;
  postOpAmortHt: number;
  remainingToCommitHt: number;
  grossMarginHt: number;
  grossMarginPct: number;
  plannedMarginHt: number;
  plannedMarginPct: number;
  realMarginHt: number;
  realMarginPct: number;
  forecastCostHt: number;
  forecastMarginHt: number;
  forecastMarginPct: number;
  // French field aliases
  prixVenduHt: number;
  coutsPreOpTotal: number;
  coutsPreOpExterne: number;
  coutsPreOpRh: number;
  coutsPreOpAmortissement: number;
  coutsPostOpTotal: number;
  resteAEngager: number;
  margeBruteHt: number;
  margeBrutePct: number;
  margePrevueHt: number;
  margePrevuePct: number;
  margeReelleHt: number;
  margeReellePct: number;
}

export interface CategoryBreakdown {
  category: string;
  soldTotalHt: number;
  preOpTotalHt: number;
  preOpExternalHt: number;
  preOpRhHt: number;
  preOpAmortHt: number;
  postOpTotalHt: number;
  postOpExternalHt: number;
  postOpRhHt: number;
  postOpAmortHt: number;
  remainingToCommitHt: number;
  consumptionPct: number;
  lineCount: number;
}

export interface BudgetAlert {
  budgetLineId: string;
  objet: string;
  category: string;
  level: "WARNING" | "CRITICAL";
  thresholdPct: 90 | 100;
  ratioPct: number;
  preOpTotalHt: number;
  postOpTotalHt: number;
  unbudgeted: boolean;
  message: string;
}

export interface BudgetComputationResult {
  summary: BudgetSummary;
  categories: CategoryBreakdown[];
  alerts: BudgetAlert[];
}

export function toCents(amount: number | null | undefined): number {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return 0;
  }
  return Math.round((amount + Number.EPSILON) * 100);
}

export function fromCents(cents: number): number {
  if (!Number.isFinite(cents)) {
    return 0;
  }
  return Math.round(cents) / 100;
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeExpenseType(
  raw: string | null | undefined
): NormalizedExpenseType {
  const normalized = (raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (/\brh\b|interne/.test(normalized)) {
    return "RH Internes";
  }
  if (/amort|materiel/.test(normalized)) {
    return "Amortissement";
  }
  return "Externe";
}

export function computeBudgetMetrics(
  lines: readonly BudgetLineLike[]
): BudgetComputationResult {
  let soldCents = 0;
  let preOpExternalCents = 0;
  let preOpRhCents = 0;
  let preOpAmortCents = 0;
  let postOpExternalCents = 0;
  let postOpRhCents = 0;
  let postOpAmortCents = 0;
  let remainingToCommitCents = 0;

  interface CategoryAcc {
    category: string;
    soldCents: number;
    preOpExternalCents: number;
    preOpRhCents: number;
    preOpAmortCents: number;
    postOpExternalCents: number;
    postOpRhCents: number;
    postOpAmortCents: number;
    remainingCents: number;
    lineCount: number;
  }

  const categoryMap = new Map<string, CategoryAcc>();
  const alerts: BudgetAlert[] = [];

  for (const line of lines) {
    const categoryName = line.category?.trim() || "AUTRES";
    const expType = normalizeExpenseType(line.expenseType);

    const lineSoldCents = toCents(line.saleTotalHt);
    const linePreCents = toCents(line.preOpTotalHt);
    const linePostCents = toCents(line.postOpTotalHt);
    const lineRemainingCents = Math.max(0, linePreCents - linePostCents);

    soldCents += lineSoldCents;
    remainingToCommitCents += lineRemainingCents;

    let acc = categoryMap.get(categoryName);
    if (!acc) {
      acc = {
        category: categoryName,
        soldCents: 0,
        preOpExternalCents: 0,
        preOpRhCents: 0,
        preOpAmortCents: 0,
        postOpExternalCents: 0,
        postOpRhCents: 0,
        postOpAmortCents: 0,
        remainingCents: 0,
        lineCount: 0,
      };
      categoryMap.set(categoryName, acc);
    }

    acc.soldCents += lineSoldCents;
    acc.remainingCents += lineRemainingCents;
    acc.lineCount += 1;

    if (expType === "RH Internes") {
      preOpRhCents += linePreCents;
      postOpRhCents += linePostCents;
      acc.preOpRhCents += linePreCents;
      acc.postOpRhCents += linePostCents;
    } else if (expType === "Amortissement") {
      preOpAmortCents += linePreCents;
      postOpAmortCents += linePostCents;
      acc.preOpAmortCents += linePreCents;
      acc.postOpAmortCents += linePostCents;
    } else {
      preOpExternalCents += linePreCents;
      postOpExternalCents += linePostCents;
      acc.preOpExternalCents += linePreCents;
      acc.postOpExternalCents += linePostCents;
    }

    // 85% / 100% alert evaluation BEFORE display rounding
    if (linePreCents === 0) {
      if (linePostCents > 0) {
        const postHt = fromCents(linePostCents);
        alerts.push({
          budgetLineId: line.id,
          objet: line.objet,
          category: categoryName,
          level: "CRITICAL",
          thresholdPct: 100,
          ratioPct: 100,
          preOpTotalHt: 0,
          postOpTotalHt: postHt,
          unbudgeted: true,
          message: `Dépense hors budget pré-op sur "${line.objet}" (0 € budgété, ${postHt.toFixed(2)} € facturé).`,
        });
      }
    } else if (linePostCents > linePreCents) {
      const ratioPct = round2((linePostCents / linePreCents) * 100);
      alerts.push({
        budgetLineId: line.id,
        objet: line.objet,
        category: categoryName,
        level: "CRITICAL",
        thresholdPct: 100,
        ratioPct,
        preOpTotalHt: fromCents(linePreCents),
        postOpTotalHt: fromCents(linePostCents),
        unbudgeted: false,
        message: `Dépassement sur "${line.objet}" (${ratioPct.toFixed(2)}% du budget pré-op consommé).`,
      });
    } else if (
      linePostCents < linePreCents &&
      linePostCents * 100 >= linePreCents * 90
    ) {
      const ratioPct = round2((linePostCents / linePreCents) * 100);
      alerts.push({
        budgetLineId: line.id,
        objet: line.objet,
        category: categoryName,
        level: "WARNING",
        thresholdPct: 90,
        ratioPct,
        preOpTotalHt: fromCents(linePreCents),
        postOpTotalHt: fromCents(linePostCents),
        unbudgeted: false,
        message: `Seuil de vigilance 90% atteint sur "${line.objet}" (${ratioPct.toFixed(2)}% du budget pré-op consommé).`,
      });
    }
  }

  const preOpTotalCents = preOpExternalCents + preOpRhCents + preOpAmortCents;
  const postOpTotalCents =
    postOpExternalCents + postOpRhCents + postOpAmortCents;

  const soldTotalHt = fromCents(soldCents);
  const preOpExternalHt = fromCents(preOpExternalCents);
  const preOpRhHt = fromCents(preOpRhCents);
  const preOpAmortHt = fromCents(preOpAmortCents);
  const preOpTotalHt = fromCents(preOpTotalCents);

  const postOpExternalHt = fromCents(postOpExternalCents);
  const postOpRhHt = fromCents(postOpRhCents);
  const postOpAmortHt = fromCents(postOpAmortCents);
  const postOpTotalHt = fromCents(postOpTotalCents);

  const remainingToCommitHt = fromCents(remainingToCommitCents);

  const grossMarginCents = soldCents - preOpExternalCents;
  const grossMarginHt = fromCents(grossMarginCents);
  const grossMarginPct =
    soldCents > 0 ? round2((grossMarginCents / soldCents) * 100) : 0;

  const plannedMarginCents = soldCents - preOpTotalCents;
  const plannedMarginHt = fromCents(plannedMarginCents);
  const plannedMarginPct =
    soldCents > 0 ? round2((plannedMarginCents / soldCents) * 100) : 0;

  const realMarginCents = soldCents - postOpTotalCents;
  const realMarginHt = fromCents(realMarginCents);
  const realMarginPct =
    soldCents > 0 ? round2((realMarginCents / soldCents) * 100) : 0;

  const forecastCostCents = postOpTotalCents + remainingToCommitCents;
  const forecastCostHt = fromCents(forecastCostCents);
  const forecastMarginCents = soldCents - forecastCostCents;
  const forecastMarginHt = fromCents(forecastMarginCents);
  const forecastMarginPct =
    soldCents > 0 ? round2((forecastMarginCents / soldCents) * 100) : 0;

  const summary: BudgetSummary = {
    soldTotalHt,
    soldHt: soldTotalHt,
    preOpTotalHt,
    preOpHt: preOpTotalHt,
    preOpExternalHt,
    preOpRhHt,
    preOpAmortHt,
    postOpTotalHt,
    postOpHt: postOpTotalHt,
    postOpExternalHt,
    postOpRhHt,
    postOpAmortHt,
    remainingToCommitHt,
    grossMarginHt,
    grossMarginPct,
    plannedMarginHt,
    plannedMarginPct,
    realMarginHt,
    realMarginPct,
    forecastCostHt,
    forecastMarginHt,
    forecastMarginPct,
    // French aliases
    prixVenduHt: soldTotalHt,
    coutsPreOpTotal: preOpTotalHt,
    coutsPreOpExterne: preOpExternalHt,
    coutsPreOpRh: preOpRhHt,
    coutsPreOpAmortissement: preOpAmortHt,
    coutsPostOpTotal: postOpTotalHt,
    resteAEngager: remainingToCommitHt,
    margeBruteHt: grossMarginHt,
    margeBrutePct: grossMarginPct,
    margePrevueHt: plannedMarginHt,
    margePrevuePct: plannedMarginPct,
    margeReelleHt: realMarginHt,
    margeReellePct: realMarginPct,
  };

  const categories: CategoryBreakdown[] = Array.from(categoryMap.values()).map(
    (acc) => {
      const catPreCents =
        acc.preOpExternalCents + acc.preOpRhCents + acc.preOpAmortCents;
      const catPostCents =
        acc.postOpExternalCents + acc.postOpRhCents + acc.postOpAmortCents;
      const consumptionPct =
        catPreCents > 0
          ? round2((catPostCents / catPreCents) * 100)
          : catPostCents > 0
            ? 100
            : 0;

      return {
        category: acc.category,
        soldTotalHt: fromCents(acc.soldCents),
        preOpTotalHt: fromCents(catPreCents),
        preOpExternalHt: fromCents(acc.preOpExternalCents),
        preOpRhHt: fromCents(acc.preOpRhCents),
        preOpAmortHt: fromCents(acc.preOpAmortCents),
        postOpTotalHt: fromCents(catPostCents),
        postOpExternalHt: fromCents(acc.postOpExternalCents),
        postOpRhHt: fromCents(acc.postOpRhCents),
        postOpAmortHt: fromCents(acc.postOpAmortCents),
        remainingToCommitHt: fromCents(acc.remainingCents),
        consumptionPct,
        lineCount: acc.lineCount,
      };
    }
  );

  return {
    summary,
    categories,
    alerts,
  };
}
