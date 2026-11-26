export const USER_ROLES = [
  "ADMIN",
  "CHEF_DE_PROJET",
  "COMPTA",
  "MEMBER",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const MANDATORY_ACCOUNTING_TO =
  "gamersorigin-8j117x7x@suppliers.pennylane.com";

export const MANDATORY_ACCOUNTING_CC = [
  "s.aslam@gamersorigin.com",
  "louis.berody@gamersorigin.com",
] as const;

export const USER_ROLE_META: Record<
  UserRole,
  {
    label: string;
    shortLabel: string;
    description: string;
    badgeClass: string;
  }
> = {
  ADMIN: {
    label: "Administrateur",
    shortLabel: "Admin",
    description:
      "Accès global agence, gestion des rôles, backups hebdomadaires et audit.",
    badgeClass:
      "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  },
  CHEF_DE_PROJET: {
    label: "Chef de projet",
    shortLabel: "Chef de projet",
    description:
      "Pilote les projets assignés et est ajouté automatiquement en CC des mails compta de ses projets.",
    badgeClass:
      "bg-rose-50 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  },
  COMPTA: {
    label: "Service Comptable",
    shortLabel: "Compta",
    description:
      "Ajouté automatiquement en CC sur tous les brouillons d'envoi de factures à la comptabilité.",
    badgeClass:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  },
  MEMBER: {
    label: "Collaborateur",
    shortLabel: "Membre",
    description:
      "Accès standard aux projets créés ou partagés avec lui.",
    badgeClass:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
};

export function normalizeUserRole(raw: string | null | undefined): UserRole {
  const upper = (raw ?? "").trim().toUpperCase();
  if (
    upper === "ADMIN" ||
    upper === "CHEF_DE_PROJET" ||
    upper === "COMPTA" ||
    upper === "MEMBER"
  ) {
    return upper;
  }
  return "MEMBER";
}
