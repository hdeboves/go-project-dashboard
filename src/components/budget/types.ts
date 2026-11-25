export interface BudgetLineDto {
  id: string;
  projectId: string;
  category: string;
  objet: string;
  realisePar: string | null;
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
  sheetRowIndex: number | null;
  invoiceNumbersNote: string | null;
}

export interface BudgetSummaryDto {
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
  grossMarginHt: number;
  grossMarginPct: number;
  plannedMarginHt: number;
  plannedMarginPct: number;
  realMarginHt: number;
  realMarginPct: number;
  forecastCostHt?: number;
  forecastMarginHt?: number;
  forecastMarginPct?: number;
}

export interface CategoryBreakdownDto {
  category: string;
  soldTotalHt: number;
  preOpTotalHt: number;
  postOpTotalHt: number;
  remainingToCommitHt: number;
  consumptionPct: number;
  lineCount: number;
}

export interface BudgetAlertDto {
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

export interface BudgetDataDto {
  budgetSheetId: string | null;
  lines: BudgetLineDto[];
  summary: BudgetSummaryDto;
  categories: CategoryBreakdownDto[];
  alerts: BudgetAlertDto[];
  warnings?: string[];
}

export interface InvoiceDto {
  id: string;
  projectId: string;
  budgetLineId: string | null;
  gmailMessageId: string | null;
  originalFilename: string;
  renamedFilename: string | null;
  driveFileId: string | null;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountHt: number;
  tvaAmount: number;
  amountTtc: number;
  invoiceType: string;
  prestationLabel: string | null;
  detectedCodeProjet: string | null;
  cpConflict: boolean;
  status: string;
  pennylaneDraftId: string | null;
  extractedJson: string;
  stepDriveDone: boolean;
  stepSheetDone: boolean;
  stepGmailDone: boolean;
  createdAt: string;
}

export function formatEur(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const fixed = Math.abs(safe).toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
  const sign = safe < 0 ? "-" : "";
  return `${sign}${grouped},${decPart}\u00A0€`;
}
