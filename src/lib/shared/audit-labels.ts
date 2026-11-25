import { formatEur } from "@/lib/shared/format";

const ACTION_LABELS: Record<string, string> = {
  PROJECT_CREATED: "Projet créé",
  PROJECT_ARCHIVED: "Projet archivé",
  PROJECT_UNARCHIVED: "Projet restauré",
  PROJECT_MEMBER_ADDED: "Accès partagé",
  PROJECT_MEMBER_UPDATED: "Rôle projet modifié",
  PROJECT_MEMBER_REMOVED: "Accès retiré",
  SANDBOX_BOOTSTRAPPED: "Projet pilote initialisé",
  BUDGET_IMPORTED: "Budget importé",
  BUDGET_LINE_UPSERTED: "Poste budgétaire mis à jour",
  BUDGET_LINE_DELETED: "Poste budgétaire supprimé",
  BUDGET_TEMPLATE_APPLIED: "Modèle budget vierge appliqué",
  INVOICE_UPLOADED: "Facture importée",
  INVOICE_GMAIL_SCANNED: "Factures récupérées depuis Gmail",
  INVOICE_VALIDATED: "Facture validée (Drive + Pennylane)",
  INVOICE_DELETED: "Facture rejetée / supprimée",
  CP_CONFLICT_DETECTED: "Conflit de code projet bloqué",
  CP_CONFLICT_OVERRIDDEN: "Conflit CP levé manuellement",
  QUOTE_CREATED: "Devis créé",
  QUOTE_UPDATED: "Devis mis à jour",
  QUOTE_DELETED: "Devis supprimé",
  RETRO_SYNCED: "Rétroplanning synchronisé",
  RETRO_TASK_CREATED: "Tâche ajoutée au rétroplanning",
  RETRO_TASK_UPDATED: "Tâche modifiée",
  RETRO_TASK_DELETED: "Tâche supprimée",
  RETRO_DATES_SHIFTED: "Dates du rétroplanning décalées",
  RETRO_TEMPLATE_APPLIED: "Modèle rétroplanning appliqué",
  RETRO_EXPORTED_SHEET: "Rétroplanning exporté vers Google Sheets",
  EXT_SYNC_PUBLISHED: "Dossiers publiés dans l'espace client",
  MEETING_IMPORTED: "Compte rendu Krisp importé",
  WEEKLY_GENERATED: "Weekly client généré",
  WEEKLY_REPORT_GENERATED: "Weekly client généré",
  REPORTING_CONSOLIDATED: "Reporting consolidé",
  REPORTING_SLIDES_GENERATED: "Slides reporting générées",
  TALENT_ADDED: "Talent ajouté (dossiers Drive)",
  USER_ROLE_UPDATED: "Rôle utilisateur modifié",
  BACKUP_CREATED: "Sauvegarde créée",
  TEMPLATE_UPDATED: "Modèle vierge mis à jour",
  GOOGLE_OAUTH_CONNECTED: "Compte Google connecté",
  OAUTH_CONNECTED: "Compte Google connecté",
  SETTINGS_UPDATED: "Paramètres mis à jour",
};

export function formatAuditActionFr(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll("_", " ").toLowerCase();
}

export function formatAuditDetailsFr(
  action: string,
  detailsJson: string
): string {
  if (!detailsJson || detailsJson === "{}") return "—";
  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(detailsJson);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return String(detailsJson);
    }
    parsed = raw as Record<string, unknown>;
  } catch {
    return detailsJson;
  }

  if (action === "USER_ROLE_UPDATED") {
    const email = String(parsed.email ?? "");
    const nextRole = parsed.nextRole === "ADMIN" ? "Administrateur" : "Membre";
    return `${email} → ${nextRole}`;
  }

  if (action === "BACKUP_CREATED") {
    const trigger =
      parsed.trigger === "WEEKLY_SCHEDULE" ? "Auto hebdo" : "Manuel";
    const projects = Number(parsed.projectsCount ?? 0);
    const invoices = Number(parsed.invoicesCount ?? 0);
    const quotes = Number(parsed.quotesCount ?? 0);
    return `${trigger} · ${projects} projet(s), ${quotes} devis, ${invoices} facture(s)`;
  }

  if (action === "PROJECT_ARCHIVED" || action === "PROJECT_UNARCHIVED") {
    const cp = parsed.codeProjet ? `CP ${parsed.codeProjet}` : "";
    const client = parsed.client ? String(parsed.client) : "";
    return [cp, client].filter(Boolean).join(" · ") || "Statut d'archive mis à jour";
  }

  if (action === "INVOICE_VALIDATED") {
    const vendor = parsed.vendorName ? String(parsed.vendorName) : "";
    const amount =
      typeof parsed.amountHt === "number" ? formatEur(parsed.amountHt, { decimals: 2 }) : "";
    const file = parsed.renamedFilename ? String(parsed.renamedFilename) : "";
    return [vendor, amount, file].filter(Boolean).join(" · ") || "Validée";
  }

  if (action === "QUOTE_CREATED" || action === "QUOTE_UPDATED") {
    const num = parsed.quoteNumber ? String(parsed.quoteNumber) : "";
    const vendor = parsed.vendorName ? String(parsed.vendorName) : "";
    const amount =
      typeof parsed.amountHt === "number" ? formatEur(parsed.amountHt, { decimals: 2 }) : "";
    return [num, vendor, amount].filter(Boolean).join(" · ") || "Devis enregistré";
  }

  const parts: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "object") continue;
    parts.push(`${k}: ${String(v)}`);
    if (parts.length >= 3) break;
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}
