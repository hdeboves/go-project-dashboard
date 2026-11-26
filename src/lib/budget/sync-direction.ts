export type BudgetSyncDirection =
  | "PULL_FROM_SHEET"
  | "PUSH_TO_SHEET"
  | "UP_TO_DATE";

export interface BudgetSyncDecisionInput {
  sheetModifiedAt: Date | null;
  lastKnownSheetModifiedAt: Date | null;
  siteModifiedAt: Date | null;
  lastSyncedAt: Date | null;
  siteLineCount: number;
  forceDirection?: "auto" | "pull" | "push";
  toleranceMs?: number;
}

export interface BudgetSyncDecision {
  direction: BudgetSyncDirection;
  reason: string;
  sheetChangedSinceSync: boolean;
  siteChangedSinceSync: boolean;
}

/**
 * Pure last-write-wins bidirectional sync decision between the web app (Site)
 * and the attached Google Sheet.
 */
export function decideBudgetSyncDirection(
  input: BudgetSyncDecisionInput
): BudgetSyncDecision {
  const tolerance = input.toleranceMs ?? 2000;

  if (input.forceDirection === "pull") {
    return {
      direction: "PULL_FROM_SHEET",
      reason: "Import forcé depuis Google Sheets.",
      sheetChangedSinceSync: true,
      siteChangedSinceSync: false,
    };
  }
  if (input.forceDirection === "push") {
    return {
      direction: "PUSH_TO_SHEET",
      reason: "Envoi forcé du site vers Google Sheets.",
      sheetChangedSinceSync: false,
      siteChangedSinceSync: true,
    };
  }

  const sheetMs = input.sheetModifiedAt?.getTime() ?? null;
  const lastSheetMs = input.lastKnownSheetModifiedAt?.getTime() ?? null;
  const siteMs = input.siteModifiedAt?.getTime() ?? null;
  const lastSyncMs = input.lastSyncedAt?.getTime() ?? null;

  const sheetChangedSinceSync =
    sheetMs !== null &&
    (lastSheetMs === null || sheetMs > lastSheetMs + tolerance);

  const siteChangedSinceSync =
    siteMs !== null && (lastSyncMs === null || siteMs > lastSyncMs + tolerance);

  if (sheetChangedSinceSync && !siteChangedSinceSync) {
    return {
      direction: "PULL_FROM_SHEET",
      reason:
        "Modifications détectées dans Google Sheets — importées vers le site.",
      sheetChangedSinceSync,
      siteChangedSinceSync,
    };
  }

  if (siteChangedSinceSync && !sheetChangedSinceSync) {
    return {
      direction: "PUSH_TO_SHEET",
      reason:
        "Modifications détectées sur le site — envoyées vers Google Sheets.",
      sheetChangedSinceSync,
      siteChangedSinceSync,
    };
  }

  if (sheetChangedSinceSync && siteChangedSinceSync) {
    if (sheetMs !== null && siteMs !== null && sheetMs > siteMs) {
      return {
        direction: "PULL_FROM_SHEET",
        reason:
          "Les deux côtés ont été modifiés : le Google Sheet est le plus récent et a été importé.",
        sheetChangedSinceSync,
        siteChangedSinceSync,
      };
    }
    return {
      direction: "PUSH_TO_SHEET",
      reason:
        "Les deux côtés ont été modifiés : le site est le plus récent et a été envoyé vers Google Sheets.",
      sheetChangedSinceSync,
      siteChangedSinceSync,
    };
  }

  if (input.siteLineCount === 0 && sheetMs !== null) {
    return {
      direction: "PULL_FROM_SHEET",
      reason:
        "Le budget du site est vide — import initial depuis Google Sheets.",
      sheetChangedSinceSync,
      siteChangedSinceSync,
    };
  }

  return {
    direction: "UP_TO_DATE",
    reason: "Le site et Google Sheets sont déjà synchronisés.",
    sheetChangedSinceSync,
    siteChangedSinceSync,
  };
}
