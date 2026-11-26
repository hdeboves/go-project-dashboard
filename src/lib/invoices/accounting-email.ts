import {
  MANDATORY_ACCOUNTING_CC,
  MANDATORY_ACCOUNTING_TO,
} from "@/lib/auth/roles";
import { normalizeIsoDate } from "@/lib/shared/format";

export const VIGILANCE_THRESHOLD_EUR = 3000;

export interface InvoiceVerificationWarning {
  code:
    | "MISSING_VENDOR"
    | "MISSING_INVOICE_NUMBER"
    | "INVALID_DATE"
    | "INVALID_AMOUNT"
    | "MISSING_BUDGET_LINE"
    | "MULTI_CP_UNCONFIRMED"
    | "OTHER_CP_DETECTED"
    | "VIGILANCE_REQUIRED";
  severity: "error" | "warning";
  message: string;
}

export function requiresVigilanceAttestation(
  amountHt: number,
  amountTtc?: number | null
): boolean {
  const ht = Number.isFinite(amountHt) ? amountHt : 0;
  const ttc =
    typeof amountTtc === "number" && Number.isFinite(amountTtc) ? amountTtc : 0;
  return ht > VIGILANCE_THRESHOLD_EUR || ttc > VIGILANCE_THRESHOLD_EUR;
}

export function normalizeProjectCodesList(
  codes: readonly (string | null | undefined)[],
  fallbackCode?: string | null
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of codes) {
    const clean = (raw ?? "").trim().replace(/^CP\s*/i, "");
    if (!clean) continue;
    const key = clean.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }
  if (out.length === 0 && fallbackCode?.trim()) {
    out.push(fallbackCode.trim());
  }
  return out;
}

/**
 * Exact user-requested subject format:
 * Facture - code(s) projet(s) - nom du/des prestataire(s)
 */
export function buildAccountingEmailSubject(params: {
  projectCodes: readonly string[];
  vendorName: string;
}): string {
  const codes = normalizeProjectCodesList(params.projectCodes);
  const codesLabel = codes.length > 0 ? codes.join(" / ") : "SANS-CP";
  const vendor = params.vendorName.trim() || "Prestataire";
  return `Facture - ${codesLabel} - ${vendor}`;
}

/**
 * Exact user-requested body template:
 * Hello,
 *
 * Vous trouverez en pièce jointe la facture de [nom du prestataire] pour le [code projet]
 *
 * Merci
 */
export function buildAccountingEmailBody(params: {
  projectCodes: readonly string[];
  vendorName: string;
}): string {
  const codes = normalizeProjectCodesList(params.projectCodes);
  const codesLabel = codes.length > 0 ? codes.join(" / ") : "projet";
  const vendor = params.vendorName.trim() || "Prestataire";
  return [
    "Hello,",
    "",
    `Vous trouverez en pièce jointe la facture de ${vendor} pour le ${codesLabel}`,
    "",
    "Merci",
  ].join("\n");
}

export interface AccountingCcEntry {
  email: string;
  label: string;
  source: "MANDATORY_COMPTA" | "ROLE_COMPTA" | "PROJECT_PM" | "CURRENT_USER" | "CUSTOM";
  mandatory: boolean;
}

export function buildAccountingCcEntries(params: {
  projectCollaborators?: Array<{ email: string; name?: string | null; role?: string | null }>;
  accountingUsers?: Array<{ email: string; name?: string | null }>;
  currentUserEmail?: string | null;
  extraCc?: string[];
}): AccountingCcEntry[] {
  const map = new Map<string, AccountingCcEntry>();

  const add = (entry: AccountingCcEntry) => {
    const cleanEmail = entry.email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) return;
    if (!map.has(cleanEmail)) {
      map.set(cleanEmail, { ...entry, email: cleanEmail });
    }
  };

  for (const email of MANDATORY_ACCOUNTING_CC) {
    add({
      email,
      label: "Compta obligatoire",
      source: "MANDATORY_COMPTA",
      mandatory: true,
    });
  }

  for (const u of params.accountingUsers ?? []) {
    add({
      email: u.email,
      label: u.name ? `${u.name} (Compta)` : "Service Comptable",
      source: "ROLE_COMPTA",
      mandatory: false,
    });
  }

  for (const collab of params.projectCollaborators ?? []) {
    add({
      email: collab.email,
      label: collab.name ? `${collab.name} (Chef de projet)` : "Chef de projet",
      source: "PROJECT_PM",
      mandatory: false,
    });
  }

  if (params.currentUserEmail) {
    add({
      email: params.currentUserEmail,
      label: "Vous",
      source: "CURRENT_USER",
      mandatory: false,
    });
  }

  for (const extra of params.extraCc ?? []) {
    add({
      email: extra,
      label: "Ajouté manuellement",
      source: "CUSTOM",
      mandatory: false,
    });
  }

  return Array.from(map.values());
}

export function getAccountingToAddress(configuredTo?: string | null): string {
  const clean = (configuredTo ?? "").trim();
  return clean && clean.includes("@") ? clean : MANDATORY_ACCOUNTING_TO;
}

export function evaluateInvoiceVerificationWarnings(params: {
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountHt: number;
  amountTtc?: number | null;
  budgetLineId: string;
  activeProjectCode: string;
  projectCodes: readonly string[];
  multiProjectConfirmed: boolean;
  hasVigilanceAttestation: boolean;
}): InvoiceVerificationWarning[] {
  const warnings: InvoiceVerificationWarning[] = [];

  if (!params.vendorName.trim()) {
    warnings.push({
      code: "MISSING_VENDOR",
      severity: "error",
      message: "Nom du prestataire manquant.",
    });
  }

  if (!params.invoiceNumber.trim()) {
    warnings.push({
      code: "MISSING_INVOICE_NUMBER",
      severity: "error",
      message: "Numéro de facture manquant (requis pour la nomenclature Drive).",
    });
  }

  if (!normalizeIsoDate(params.invoiceDate)) {
    warnings.push({
      code: "INVALID_DATE",
      severity: "error",
      message: "Date d'émission manquante ou invalide (format AAAA-MM-JJ).",
    });
  }

  if (!Number.isFinite(params.amountHt) || params.amountHt <= 0) {
    warnings.push({
      code: "INVALID_AMOUNT",
      severity: "error",
      message: "Montant HT manquant ou égal à 0 €.",
    });
  }

  if (!params.budgetLineId.trim()) {
    warnings.push({
      code: "MISSING_BUDGET_LINE",
      severity: "error",
      message: "Aucun poste budgétaire sélectionné pour imputer cette facture.",
    });
  }

  const normalizedCodes = normalizeProjectCodesList(
    params.projectCodes,
    params.activeProjectCode
  );
  const otherCodes = normalizedCodes.filter(
    (c) => c.toUpperCase() !== params.activeProjectCode.trim().toUpperCase()
  );

  if (normalizedCodes.length > 1 && !params.multiProjectConfirmed) {
    warnings.push({
      code: "MULTI_CP_UNCONFIRMED",
      severity: "warning",
      message: `Plusieurs codes projet détectés (${normalizedCodes.join(", ")}) : cochez la confirmation multi-projets après vérification.`,
    });
  } else if (
    normalizedCodes.length === 1 &&
    otherCodes.length > 0 &&
    !params.multiProjectConfirmed
  ) {
    warnings.push({
      code: "OTHER_CP_DETECTED",
      severity: "warning",
      message: `Code projet ${otherCodes.join(", ")} différent du projet actif (${params.activeProjectCode}) : vérifiez le code projet avant envoi.`,
    });
  }

  if (
    requiresVigilanceAttestation(params.amountHt, params.amountTtc) &&
    !params.hasVigilanceAttestation
  ) {
    warnings.push({
      code: "VIGILANCE_REQUIRED",
      severity: "warning",
      message:
        "Facture supérieure à 3 000 € : une attestation de vigilance (URSSAF) doit être jointe dans les fichiers Drive.",
    });
  }

  return warnings;
}
