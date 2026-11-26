import type { PrismaClient } from "@prisma/client";
import type { NormalizedExpenseType } from "@/lib/budget/calculator";

export const PROJECT_CATEGORIES = [
  "JEU",
  "YOUTUBE",
  "PROD_CREA",
  "EVENEMENT",
  "SPONSOR",
] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export interface ProjectCategoryMeta {
  id: ProjectCategory;
  label: string;
  shortLabel: string;
  description: string;
  badgeClass: string;
}

export const PROJECT_CATEGORY_META: Record<ProjectCategory, ProjectCategoryMeta> = {
  JEU: {
    id: "JEU",
    label: "Projet Jeu",
    shortLabel: "Jeu",
    description:
      "Création de map Fortnite/Roblox, expérience interactive, DA, influence & lancement.",
    badgeClass:
      "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/80 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30",
  },
  YOUTUBE: {
    id: "YOUTUBE",
    label: "Projet YouTube",
    shortLabel: "YouTube",
    description:
      "Production vidéo YouTube : écriture, tournage, montage, miniature, talents & diffusion.",
    badgeClass:
      "bg-rose-50 text-rose-700 ring-1 ring-rose-200/80 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  },
  PROD_CREA: {
    id: "PROD_CREA",
    label: "Prod Créa & Vidéo",
    shortLabel: "Prod Créa",
    description:
      "Brand content, film publicitaire, DA, motion design, tournage, post-production & assets sociaux.",
    badgeClass:
      "bg-violet-50 text-violet-700 ring-1 ring-violet-200/80 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30",
  },
  EVENEMENT: {
    id: "EVENEMENT",
    label: "Projet Événement",
    shortLabel: "Événement",
    description:
      "Tournoi, activation physique, stand, régie technique, animation, captation & logistique.",
    badgeClass:
      "bg-amber-50 text-amber-800 ring-1 ring-amber-200/80 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  },
  SPONSOR: {
    id: "SPONSOR",
    label: "Sponsor",
    shortLabel: "Sponsor",
    description:
      "Partenariat marque : droits d'image, activations sociales, visibilité live & reporting ROI.",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  },
};

export function normalizeProjectCategory(
  raw: string | null | undefined
): ProjectCategory {
  const upper = (raw ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (upper === "YOUTUBE") return "YOUTUBE";
  if (
    upper === "PROD_CREA" ||
    upper === "PROD" ||
    upper === "CREA" ||
    upper === "VIDEO"
  ) {
    return "PROD_CREA";
  }
  if (upper === "EVENEMENT" || upper === "EVENT") return "EVENEMENT";
  if (upper === "SPONSOR" || upper === "SPONSORING") return "SPONSOR";
  return "JEU";
}

export interface BlankBudgetTemplateLine {
  category: string;
  objet: string;
  expenseType: NormalizedExpenseType;
  realisePar?: string | null;
}

export interface BlankRetroTemplateTask {
  phase: string;
  etape: string;
  tache: string;
  isMilestone?: boolean;
  milestoneType?: "INFLUENCE" | "LANCEMENT_MAP" | "WEEKLY" | "CUSTOM" | null;
}

export const DEFAULT_BUDGET_TEMPLATES: Record<
  ProjectCategory,
  readonly BlankBudgetTemplateLine[]
> = {
  JEU: [
    {
      category: "CONCEPTION & GAME DESIGN",
      objet: "Cadrage créatif & Game Design Document (GDD)",
      expenseType: "RH Internes",
      realisePar: "Interne agence",
    },
    {
      category: "CONCEPTION & GAME DESIGN",
      objet: "Level Design & maquettage parcours joueur",
      expenseType: "Externe",
    },
    {
      category: "CRÉATION & DÉVELOPPEMENT DU JEU",
      objet: "Développement Map / Mécaniques & Scripting",
      expenseType: "Externe",
    },
    {
      category: "CRÉATION & DÉVELOPPEMENT DU JEU",
      objet: "Modélisation 3D, Environnement & Assets dédiés",
      expenseType: "Externe",
    },
    {
      category: "CRÉATION & DÉVELOPPEMENT DU JEU",
      objet: "Sound Design & Musique originale",
      expenseType: "Externe",
    },
    {
      category: "CRÉATION & DÉVELOPPEMENT DU JEU",
      objet: "QA, Playtests & Modération / Publication",
      expenseType: "Externe",
    },
    {
      category: "DIRECTION ARTISTIQUE & VISUELS",
      objet: "Charte graphique, Key Art & Vignettes jeu",
      expenseType: "Externe",
    },
    {
      category: "DIRECTION ARTISTIQUE & VISUELS",
      objet: "Trailer de lancement & Assets social media",
      expenseType: "Externe",
    },
    {
      category: "INFLUENCE & MÉDIATISATION",
      objet: "Cachets Talents / Créateurs de contenu",
      expenseType: "Externe",
    },
    {
      category: "INFLUENCE & MÉDIATISATION",
      objet: "Achat média / Boost social & Sponsoring",
      expenseType: "Externe",
    },
    {
      category: "GESTION DE PROJET & FRAIS DIVERS",
      objet: "Direction & Gestion de projet",
      expenseType: "RH Internes",
      realisePar: "Interne agence",
    },
    {
      category: "GESTION DE PROJET & FRAIS DIVERS",
      objet: "Licences logiciels, Serveurs & Matériel",
      expenseType: "Amortissement",
      realisePar: "Interne agence",
    },
    {
      category: "GESTION DE PROJET & FRAIS DIVERS",
      objet: "Reporting & Bilan post-opération",
      expenseType: "RH Internes",
      realisePar: "Interne agence",
    },
  ],
  YOUTUBE: [
    {
      category: "PRÉ-PRODUCTION & ÉCRITURE",
      objet: "Concept créatif, Script & Conducteur",
      expenseType: "RH Internes",
      realisePar: "Interne agence",
    },
    {
      category: "PRÉ-PRODUCTION & ÉCRITURE",
      objet: "Repérage, Casting & Préparation accessoires",
      expenseType: "Externe",
    },
    {
      category: "TOURNAGE & STUDIO",
      objet: "Location studio / Lieu de tournage",
      expenseType: "Externe",
    },
    {
      category: "TOURNAGE & STUDIO",
      objet: "Équipe technique (Cadreur, Ingé son, Lumière)",
      expenseType: "Externe",
    },
    {
      category: "TOURNAGE & STUDIO",
      objet: "Location / Amortissement matériel caméra & son",
      expenseType: "Amortissement",
      realisePar: "Interne agence",
    },
    {
      category: "TOURNAGE & STUDIO",
      objet: "Régie, Catering & Déplacements tournage",
      expenseType: "Externe",
    },
    {
      category: "POST-PRODUCTION & HABILLAGE",
      objet: "Montage vidéo principal (YouTube long format)",
      expenseType: "Externe",
    },
    {
      category: "POST-PRODUCTION & HABILLAGE",
      objet: "Motion Design, VFX & Étalonnage",
      expenseType: "Externe",
    },
    {
      category: "POST-PRODUCTION & HABILLAGE",
      objet: "Mixage audio, Droits musicaux & Sous-titrage",
      expenseType: "Externe",
    },
    {
      category: "POST-PRODUCTION & HABILLAGE",
      objet: "Création Miniatures (A/B test) & Déclinaisons Shorts",
      expenseType: "Externe",
    },
    {
      category: "TALENTS & DIFFUSION",
      objet: "Cachets Talents / Invités",
      expenseType: "Externe",
    },
    {
      category: "TALENTS & DIFFUSION",
      objet: "Médiatisation, Promotion & Community Management",
      expenseType: "Externe",
    },
    {
      category: "GESTION DE PROJET",
      objet: "Coordination de production & Suivi client",
      expenseType: "RH Internes",
      realisePar: "Interne agence",
    },
  ],
  PROD_CREA: [
    {
      category: "CONCEPTION & DIRECTION ARTISTIQUE",
      objet: "Concept créatif, Moodboard & Storyboard",
      expenseType: "RH Internes",
      realisePar: "Interne agence",
    },
    {
      category: "CONCEPTION & DIRECTION ARTISTIQUE",
      objet: "Direction Artistique, Key Visuals & Charte campagne",
      expenseType: "Externe",
    },
    {
      category: "PRODUCTION & TOURNAGE",
      objet: "Réalisateur, DOP & Équipe technique tournage",
      expenseType: "Externe",
    },
    {
      category: "PRODUCTION & TOURNAGE",
      objet: "Studio, Décors, Accessoires & Régie plateau",
      expenseType: "Externe",
    },
    {
      category: "PRODUCTION & TOURNAGE",
      objet: "Casting, Comédiens / Talents & Droits à l'image",
      expenseType: "Externe",
    },
    {
      category: "POST-PRODUCTION & LIVRABLES",
      objet: "Montage offline/online, Motion Design & 3D",
      expenseType: "Externe",
    },
    {
      category: "POST-PRODUCTION & LIVRABLES",
      objet: "Étalonnage, Sound Design, Mixage & Droits musicaux",
      expenseType: "Externe",
    },
    {
      category: "POST-PRODUCTION & LIVRABLES",
      objet: "Déclinaisons formats sociaux (9:16, 16:9, 1:1) & Mastering",
      expenseType: "Externe",
    },
    {
      category: "GESTION DE PROJET & FRAIS",
      objet: "Production exécutive & Suivi client",
      expenseType: "RH Internes",
      realisePar: "Interne agence",
    },
    {
      category: "GESTION DE PROJET & FRAIS",
      objet: "Amortissement matériel & Stockage rushes",
      expenseType: "Amortissement",
      realisePar: "Interne agence",
    },
  ],
  EVENEMENT: [
    {
      category: "LIEU & LOGISTIQUE",
      objet: "Location de salle / Emplacement stand",
      expenseType: "Externe",
    },
    {
      category: "LIEU & LOGISTIQUE",
      objet: "Transport, Fret & Stockage matériel",
      expenseType: "Externe",
    },
    {
      category: "LIEU & LOGISTIQUE",
      objet: "Hébergement, Déplacements & Restauration équipes",
      expenseType: "Externe",
    },
    {
      category: "SCÉNOGRAPHIE & TECHNIQUE",
      objet: "Décoration, Signalétique & Habillage stand/scène",
      expenseType: "Externe",
    },
    {
      category: "SCÉNOGRAPHIE & TECHNIQUE",
      objet: "Sonorisation, Éclairage & Écrans LED",
      expenseType: "Externe",
    },
    {
      category: "SCÉNOGRAPHIE & TECHNIQUE",
      objet: "Postes Gaming, Réseau / Fibre & Électricité",
      expenseType: "Externe",
    },
    {
      category: "ANIMATION, TALENTS & STAFF",
      objet: "Animateurs, Casters & Talents présents",
      expenseType: "Externe",
    },
    {
      category: "ANIMATION, TALENTS & STAFF",
      objet: "Hôtesses, Staff accueil & Arbitrage tournoi",
      expenseType: "Externe",
    },
    {
      category: "ANIMATION, TALENTS & STAFF",
      objet: "Cashprize, Goodies & Dotations participants",
      expenseType: "Externe",
    },
    {
      category: "CAPTATION & BROADCAST",
      objet: "Régie stream / Broadcast live",
      expenseType: "Externe",
    },
    {
      category: "CAPTATION & BROADCAST",
      objet: "Photographe & Aftermovie événement",
      expenseType: "Externe",
    },
    {
      category: "SÉCURITÉ & GESTION DE PROJET",
      objet: "Sécurité, Assurance RC & Secourisme",
      expenseType: "Externe",
    },
    {
      category: "SÉCURITÉ & GESTION DE PROJET",
      objet: "Amortissement matériel interne événementiel",
      expenseType: "Amortissement",
      realisePar: "Interne agence",
    },
    {
      category: "SÉCURITÉ & GESTION DE PROJET",
      objet: "Direction de production & Coordination terrain",
      expenseType: "RH Internes",
      realisePar: "Interne agence",
    },
  ],
  SPONSOR: [
    {
      category: "DROITS & STRATÉGIE PARTENARIAT",
      objet: "Droits d'image & Visibilité marque (Maillot / Équipe)",
      expenseType: "RH Internes",
      realisePar: "Interne agence",
    },
    {
      category: "DROITS & STRATÉGIE PARTENARIAT",
      objet: "Direction stratégique & Plan d'activation annuel",
      expenseType: "RH Internes",
      realisePar: "Interne agence",
    },
    {
      category: "CONTENUS & ACTIVATIONS SOCIALES",
      objet: "Production vidéos / Formats sociaux dédiés sponsor",
      expenseType: "Externe",
    },
    {
      category: "CONTENUS & ACTIVATIONS SOCIALES",
      objet: "Création graphique (Overlays, Bannières, Assets RS)",
      expenseType: "Externe",
    },
    {
      category: "CONTENUS & ACTIVATIONS SOCIALES",
      objet: "Shooting photo & Media Day joueurs/talents",
      expenseType: "Externe",
    },
    {
      category: "VISIBILITÉ LIVE & ÉVÉNEMENTIEL",
      objet: "Intégration overlays Twitch/YouTube & Segments live",
      expenseType: "Externe",
    },
    {
      category: "VISIBILITÉ LIVE & ÉVÉNEMENTIEL",
      objet: "Flocage maillots, Merchandising & Dotations jeu-concours",
      expenseType: "Externe",
    },
    {
      category: "VISIBILITÉ LIVE & ÉVÉNEMENTIEL",
      objet: "Hospitalités / Expériences VIP partenaire",
      expenseType: "Externe",
    },
    {
      category: "INFLUENCE & MÉDIATISATION",
      objet: "Activations ambassadeurs / Créateurs partenaires",
      expenseType: "Externe",
    },
    {
      category: "INFLUENCE & MÉDIATISATION",
      objet: "Médiatisation posts & Campagne paid social",
      expenseType: "Externe",
    },
    {
      category: "SUIVI & REPORTING",
      objet: "Account Management & Comités de pilotage",
      expenseType: "RH Internes",
      realisePar: "Interne agence",
    },
    {
      category: "SUIVI & REPORTING",
      objet: "Outils de tracking & Bilan ROI / Valorisation média",
      expenseType: "Amortissement",
      realisePar: "Interne agence",
    },
  ],
};

/**
 * Unified blank retroplanning tasks (same baseline tasks for every project, NO dates).
 */
export const DEFAULT_RETRO_TEMPLATE_TASKS: readonly BlankRetroTemplateTask[] = [
  {
    phase: "1. Cadrage & Kick-off",
    etape: "Lancement",
    tache: "Réunion Kick-off interne & client",
    isMilestone: true,
    milestoneType: "CUSTOM",
  },
  {
    phase: "1. Cadrage & Kick-off",
    etape: "Cadrage",
    tache: "Validation du brief, objectifs et KPIs",
    isMilestone: false,
    milestoneType: null,
  },
  {
    phase: "1. Cadrage & Kick-off",
    etape: "Cadrage",
    tache: "Réception des éléments de marque (Brand Kit & assets client)",
    isMilestone: false,
    milestoneType: null,
  },
  {
    phase: "2. Pré-production",
    etape: "Conception",
    tache: "Rédaction du concept détaillé / note d'intention",
    isMilestone: false,
    milestoneType: null,
  },
  {
    phase: "2. Pré-production",
    etape: "Conception",
    tache: "Direction artistique & propositions visuelles",
    isMilestone: false,
    milestoneType: null,
  },
  {
    phase: "2. Pré-production",
    etape: "Validation",
    tache: "Validation client pré-production (GO prod)",
    isMilestone: true,
    milestoneType: "CUSTOM",
  },
  {
    phase: "3. Production",
    etape: "Réalisation",
    tache: "Production V1 des livrables principaux",
    isMilestone: false,
    milestoneType: null,
  },
  {
    phase: "3. Production",
    etape: "Suivi",
    tache: "Point d'étape intermédiaire & Weekly client",
    isMilestone: true,
    milestoneType: "WEEKLY",
  },
  {
    phase: "3. Production",
    etape: "Itérations",
    tache: "Intégration des retours & Production V2",
    isMilestone: false,
    milestoneType: null,
  },
  {
    phase: "4. Recette & Validation",
    etape: "Contrôle qualité",
    tache: "Tests internes / Relecture / Contrôle qualité",
    isMilestone: false,
    milestoneType: null,
  },
  {
    phase: "4. Recette & Validation",
    etape: "Validation",
    tache: "Validation finale client (BAT / Ready to launch)",
    isMilestone: true,
    milestoneType: "CUSTOM",
  },
  {
    phase: "5. Lancement & Activation",
    etape: "Mise en ligne",
    tache: "Lancement officiel / Mise en ligne de l'opération",
    isMilestone: true,
    milestoneType: "LANCEMENT_MAP",
  },
  {
    phase: "5. Lancement & Activation",
    etape: "Diffusion",
    tache: "Activation communication & talents / influence",
    isMilestone: true,
    milestoneType: "INFLUENCE",
  },
  {
    phase: "6. Clôture & Bilan",
    etape: "Reporting",
    tache: "Collecte des statistiques & résultats finaux",
    isMilestone: false,
    milestoneType: null,
  },
  {
    phase: "6. Clôture & Bilan",
    etape: "Clôture",
    tache: "Présentation du bilan final & clôture budget",
    isMilestone: true,
    milestoneType: "CUSTOM",
  },
];

export interface BlankWeeklyTemplate {
  nextStepsClient: string[];
  nextStepsGo: string[];
  summaryPlaceholder: string;
}

export const DEFAULT_WEEKLY_TEMPLATE: BlankWeeklyTemplate = {
  nextStepsClient: [
    "Validation des livrables présentés cette semaine",
    "Retour sur les éléments créatifs / visuels en attente",
  ],
  nextStepsGo: [
    "Poursuite de la production selon le rétroplanning",
    "Préparation du prochain jalon et partage des assets",
  ],
  summaryPlaceholder: "Résumé hebdomadaire à compléter.",
};

export const BLANK_WEEKLY_DEFAULTS = DEFAULT_WEEKLY_TEMPLATE;

export async function getWeeklyTemplate(
  prisma: PrismaClient
): Promise<BlankWeeklyTemplate> {
  try {
    const custom = await prisma.categoryTemplate.findUnique({
      where: { category: "WEEKLY_GLOBAL" },
    });
    if (custom?.weeklyTemplateJson) {
      const parsed = JSON.parse(custom.weeklyTemplateJson) as Partial<BlankWeeklyTemplate>;
      return {
        nextStepsClient: Array.isArray(parsed.nextStepsClient)
          ? parsed.nextStepsClient.filter((s): s is string => typeof s === "string")
          : [...DEFAULT_WEEKLY_TEMPLATE.nextStepsClient],
        nextStepsGo: Array.isArray(parsed.nextStepsGo)
          ? parsed.nextStepsGo.filter((s): s is string => typeof s === "string")
          : [...DEFAULT_WEEKLY_TEMPLATE.nextStepsGo],
        summaryPlaceholder:
          typeof parsed.summaryPlaceholder === "string" &&
          parsed.summaryPlaceholder.trim()
            ? parsed.summaryPlaceholder.trim()
            : DEFAULT_WEEKLY_TEMPLATE.summaryPlaceholder,
      };
    }
  } catch {
    // Fallback to built-in weekly template
  }
  return {
    nextStepsClient: [...DEFAULT_WEEKLY_TEMPLATE.nextStepsClient],
    nextStepsGo: [...DEFAULT_WEEKLY_TEMPLATE.nextStepsGo],
    summaryPlaceholder: DEFAULT_WEEKLY_TEMPLATE.summaryPlaceholder,
  };
}

export async function getBudgetTemplateForCategory(
  prisma: PrismaClient,
  categoryRaw: string | null | undefined
): Promise<BlankBudgetTemplateLine[]> {
  const category = normalizeProjectCategory(categoryRaw);
  try {
    const custom = await prisma.categoryTemplate.findUnique({
      where: { category },
    });
    if (custom?.budgetLinesJson) {
      const parsed = JSON.parse(custom.budgetLinesJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as BlankBudgetTemplateLine[];
      }
    }
  } catch {
    // Fallback to built-in template
  }
  return [...DEFAULT_BUDGET_TEMPLATES[category]];
}

export async function getRetroTemplateTasks(
  prisma: PrismaClient,
  categoryRaw?: string | null
): Promise<BlankRetroTemplateTask[]> {
  try {
    const customGlobal = await prisma.categoryTemplate.findUnique({
      where: { category: "RETRO_GLOBAL" },
    });
    if (customGlobal?.retroTasksJson) {
      const parsed = JSON.parse(customGlobal.retroTasksJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as BlankRetroTemplateTask[];
      }
    }
    if (categoryRaw) {
      const category = normalizeProjectCategory(categoryRaw);
      const customCat = await prisma.categoryTemplate.findUnique({
        where: { category },
      });
      if (customCat?.retroTasksJson) {
        const parsed = JSON.parse(customCat.retroTasksJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as BlankRetroTemplateTask[];
        }
      }
    }
  } catch {
    // Fallback to built-in retro tasks
  }
  return [...DEFAULT_RETRO_TEMPLATE_TASKS];
}

/**
 * Seeds blank budget lines (usual expense posts with ZERO amounts, 1x1 qty/days) for a project.
 */
export async function seedBlankBudgetForProject(
  prisma: PrismaClient,
  projectId: string,
  categoryRaw: string | null | undefined,
  options: { replaceExisting?: boolean; append?: boolean } = {}
): Promise<{ createdCount: number; category: ProjectCategory }> {
  const category = normalizeProjectCategory(categoryRaw);
  const templateLines = await getBudgetTemplateForCategory(prisma, category);

  const existingCount = await prisma.budgetLine.count({
    where: { projectId },
  });
  if (existingCount > 0 && !options.replaceExisting && !options.append) {
    return { createdCount: 0, category };
  }

  const startRowIndex = options.append && !options.replaceExisting
    ? existingCount + 12
    : 12;

  await prisma.$transaction(async (tx) => {
    if (options.replaceExisting && existingCount > 0) {
      await tx.budgetLine.deleteMany({ where: { projectId } });
    }
    if (templateLines.length > 0) {
      await tx.budgetLine.createMany({
        data: templateLines.map((item, i) => ({
          projectId,
          category: item.category,
          objet: item.objet,
          realisePar: item.realisePar ?? null,
          expenseType: item.expenseType,
          saleQty: 1,
          saleDays: 1,
          saleUnitPrice: 0,
          saleTotalHt: 0,
          preOpUnitCost: 0,
          preOpTotalHt: 0,
          postOpQty: 0,
          postOpDays: 0,
          postOpUnitCost: 0,
          postOpTotalHt: 0,
          sheetRowIndex: startRowIndex + i,
        })),
      });
    }
  });

  return { createdCount: templateLines.length, category };
}

/**
 * Seeds blank retroplanning tasks (same tasks, NO dates) for a project.
 */
export async function seedBlankRetroForProject(
  prisma: PrismaClient,
  projectId: string,
  options: {
    replaceExisting?: boolean;
    append?: boolean;
    category?: string | null;
  } = {}
): Promise<{ createdCount: number }> {
  const templateTasks = await getRetroTemplateTasks(prisma, options.category);

  const existingCount = await prisma.retroTask.count({
    where: { projectId },
  });
  if (existingCount > 0 && !options.replaceExisting && !options.append) {
    return { createdCount: 0 };
  }

  const startRowIndex = options.append && !options.replaceExisting
    ? existingCount + 3
    : 3;

  await prisma.$transaction(async (tx) => {
    if (options.replaceExisting && existingCount > 0) {
      await tx.retroTask.deleteMany({ where: { projectId } });
    }
    if (templateTasks.length > 0) {
      await tx.retroTask.createMany({
        data: templateTasks.map((t, i) => ({
          projectId,
          phase: t.phase,
          etape: t.etape,
          tache: t.tache,
          owner: null,
          startDate: null,
          endDate: null,
          status: "A_FAIRE",
          sheetRowIndex: startRowIndex + i,
          isMilestone: Boolean(t.isMilestone),
          milestoneType: t.milestoneType ?? null,
        })),
      });
    }
  });

  return { createdCount: templateTasks.length };
}
