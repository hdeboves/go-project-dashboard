import type { MilestoneType } from "@/lib/retroplanning/validation";
import { addUtcDays, toIsoDateOnly } from "@/lib/retroplanning/validation";

export interface DefaultCascadeRuleSpec {
  milestoneType: MilestoneType;
  offsetDays: number;
  titleTemplate: string;
  descriptionTemplate: string;
}

export const DEFAULT_CASCADE_RULES: readonly DefaultCascadeRuleSpec[] = [
  // INFLUENCE (J) : J-10, J-3, J, J+7
  {
    milestoneType: "INFLUENCE",
    offsetDays: -10,
    titleTemplate: "J-10 · Validation du script / trame — {tache}",
    descriptionTemplate:
      "[{cp}] {client} - {nomJeu} : Valider le script et la trame avec le talent et le client.",
  },
  {
    milestoneType: "INFLUENCE",
    offsetDays: -3,
    titleTemplate: "J-3 · Réception & validation vidéo — {tache}",
    descriptionTemplate:
      "[{cp}] {client} - {nomJeu} : Réceptionner le montage vidéo et valider le rendu final.",
  },
  {
    milestoneType: "INFLUENCE",
    offsetDays: 0,
    titleTemplate: "J · Publication + vérif lien & code Spark — {tache}",
    descriptionTemplate:
      "[{cp}] {client} - {nomJeu} : Vérifier la publication live, les liens trackés et le code Spark.",
  },
  {
    milestoneType: "INFLUENCE",
    offsetDays: 7,
    titleTemplate: "J+7 · Relance & collecte screenshots stats — {tache}",
    descriptionTemplate:
      "[{cp}] {client} - {nomJeu} : Relancer les talents et archiver les captures stats dans 006.1.2.",
  },

  // LANCEMENT_MAP (J) : J-14, J-5, J-2, J
  {
    milestoneType: "LANCEMENT_MAP",
    offsetDays: -14,
    titleTemplate: "J-14 · Début QA / Tests Map — {tache}",
    descriptionTemplate:
      "[{cp}] {client} - {nomJeu} : Lancer la phase QA et les tests fonctionnels UEFN.",
  },
  {
    milestoneType: "LANCEMENT_MAP",
    offsetDays: -5,
    titleTemplate: "J-5 · Soumission modération Epic — {tache}",
    descriptionTemplate:
      "[{cp}] {client} - {nomJeu} : Soumettre la map à la modération Epic Games.",
  },
  {
    milestoneType: "LANCEMENT_MAP",
    offsetDays: -2,
    titleTemplate: "J-2 · Validation finale client — {tache}",
    descriptionTemplate:
      "[{cp}] {client} - {nomJeu} : Obtenir le GO final client avant mise en ligne.",
  },
  {
    milestoneType: "LANCEMENT_MAP",
    offsetDays: 0,
    titleTemplate: "J · Mise en ligne Map + Kit Com — {tache}",
    descriptionTemplate:
      "[{cp}] {client} - {nomJeu} : Publication officielle de l'expérience et activation Kit Com.",
  },

  // WEEKLY (J) : J-1, J
  {
    milestoneType: "WEEKLY",
    offsetDays: -1,
    titleTemplate: "J-1 · Préparation auto du deck Weekly — {tache}",
    descriptionTemplate:
      "[{cp}] {client} - {nomJeu} : Préparer le deck Slides 003.2 et le brouillon Gmail Weekly.",
  },
  {
    milestoneType: "WEEKLY",
    offsetDays: 0,
    titleTemplate: "J · Réunion Weekly Client — {tache}",
    descriptionTemplate:
      "[{cp}] {client} - {nomJeu} : Point hebdomadaire client et revue des prochaines étapes.",
  },

  // CUSTOM (J) : J
  {
    milestoneType: "CUSTOM",
    offsetDays: 0,
    titleTemplate: "J · Jalon projet — {tache}",
    descriptionTemplate: "[{cp}] {client} - {nomJeu} : Échéance jalon {tache}.",
  },
];

export function computeCascadeWindow(
  anchorDate: Date | string,
  offsetDays: number
): { dateOnly: string; startAt: Date; endAt: Date } {
  const shifted = addUtcDays(anchorDate, offsetDays);
  const dateOnly = toIsoDateOnly(shifted)!;
  const [y, m, d] = dateOnly.split("-").map((n) => Number.parseInt(n, 10));
  const startAt = new Date(Date.UTC(y, m - 1, d, 9, 0, 0, 0));
  const endAt = new Date(Date.UTC(y, m - 1, d, 10, 0, 0, 0));
  return { dateOnly, startAt, endAt };
}

export function renderRuleTemplate(
  template: string,
  vars: { tache: string; client: string; nomJeu: string; cp: string }
): string {
  return template
    .replace(/\{tache\}/gi, vars.tache)
    .replace(/\{client\}/gi, vars.client)
    .replace(/\{nomJeu\}/gi, vars.nomJeu)
    .replace(/\{cp\}/gi, vars.cp);
}
