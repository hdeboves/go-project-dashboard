/**
 * Authoritative Opaque-Box Constants for GO Project Hub E2E Suite.
 * Derived strictly from ORIGINAL_REQUEST.md, PROJECT.md, and verified PROD specs.
 * Zero imports from src/ or prisma/.
 */

export const BASE_URL: string =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`;
export const IS_BOUNDARY_HARNESS: boolean = process.env.TEST_BOUNDARY_HARNESS === "1";
export const IS_LIVE_SANDBOX: boolean = process.env.RUN_LIVE_SANDBOX_E2E === "true";

export const BOUNDARY_HARNESS_HEADER = "x-test-boundary-harness" as const;
export const BOUNDARY_SCENARIO_HEADER = "x-test-boundary-scenario" as const;

export const PROD_IDS = {
  SHARED_DRIVE_13_PROJETS_NEW: "0AH0MevQO5Eh6Uk9PVA",
  FOLDER_APRES_VENTE: "1MM7Gaz-ZkJ64pqqt7rGZF56OiiWjoWyb",
  FOLDER_TEMPLATES_PROJETS: "1b_c-pS0XiAWyP6AdgZdfvqZLvipNP5g3",
  PROD_PROJECT_CE: "16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD",
  PROD_BUDGET_SHEET: "1QUSOShHJmAlch3kP5F0RIf5txwyQ7Y6wf20A0jgCtMw",
  PROD_RETROPLANNING_SHEET: "1ZG9mRIyDYDqTzJIGjGtJ4-ridgl6Cm2hqb75m1ba9XQ",
  PROD_REPORTING_SHEET: "1C136EAzwoOUJI1DypSzBjr-vO6riZk3ncRKbI_9XAY0",
  PROD_REPORTING_SLIDES: "1969-5uTXrKOlfOnEcYDfANfvl4trkn9wQNVPFJEckRU",
  PROD_WEEKLY_SLIDES: "1HWSWvNiTRxINZwsPHIHAa8SvhgwpP9euh3L-h1XCMrE",
} as const;

/**
 * All 9 primary PROD IDs enumerated in ORIGINAL_REQUEST.md (read/copy-from ONLY;
 * direct mutations targeting any of these IDs must be rejected by SandboxGuard).
 */
export const PROD_IMMUTABLE_IDS: readonly string[] = [
  PROD_IDS.SHARED_DRIVE_13_PROJETS_NEW,
  PROD_IDS.FOLDER_APRES_VENTE,
  PROD_IDS.FOLDER_TEMPLATES_PROJETS,
  PROD_IDS.PROD_PROJECT_CE,
  PROD_IDS.PROD_BUDGET_SHEET,
  PROD_IDS.PROD_RETROPLANNING_SHEET,
  PROD_IDS.PROD_REPORTING_SHEET,
  PROD_IDS.PROD_REPORTING_SLIDES,
  PROD_IDS.PROD_WEEKLY_SLIDES,
];

/** Known PROD child folders/files and template IDs protected by SandboxGuard ancestry checks. */
export const PROD_CHILD_AND_TEMPLATE_IDS: readonly string[] = [
  // PROD 16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD children
  "18-fjLE9eyQ0xSmJMWL31IxhuVRgkVtKx", // 0_Budgets
  "11dFtgEa2soMKvAROeKCfBiCWjxoWesPgm4fAI_v-MQ8", // Budget : Caisse d'Epargne - Event Col...
  "1hLWYNmk3pcpCv82p4yiW289C7iZ_ldDs", // 1_Présentations
  "1VIUtOT85S7LHym3SIosDAn__FXk7VZYS", // 2_Production
  "1Yns2y6uz8kiaPyf_dgzN98jj7ddkH_hZ", // 3_Administratif
  "11BMR7k3xA1vQXzBLorAtnOb9OuuhSw3M", // 4_Reporting
  "1XnrwAufDxZ8k23u0H2O-xcV12PluiXQu", // 4_Reporting/AKSIANKA
  "1gRcxDRA03TjTFmnwRDuAjenP0JkUOEJd", // 4_Reporting/ALLYSON
  "15Gs1BshY_oXuBo90eVa1WeKS0HthfhZt", // 4_Reporting/KALUT
  "1Yk0pZWOLihnqbY-rbEJ4Db6cSunc-NX3", // 4_Reporting/WIG
  // 5 - Templates projets children
  "1CINbjqJkaMorChNM5hJbCNpb9vQOc8hAIB2oOw-cyHo", // Budget Template
  "1PA9I95xcm6gHwrwiLgLcnd3NRmZInQXF7dbepeONVpE", // Template reporting
  "1j4ljCkrsjDmhAj7jOqQIoqA_PCB96-8bf8YxGB0LWPE", // Template Reporting contenus influence...
  "1JCJ0CB4pFFFVjKjR2GJ1cntLrj49w9ptO9CCen875cU", // Suivi de projet - Template général
];

export const ALL_PROD_PROTECTED_IDS: readonly string[] = [
  ...PROD_IMMUTABLE_IDS,
  ...PROD_CHILD_AND_TEMPLATE_IDS,
];

export const PROD_IMMUTABLE_ID_SET: ReadonlySet<string> = new Set(ALL_PROD_PROTECTED_IDS);

export const PILOT_PROJECT = {
  codeProjet: "326027",
  client: "Caisse d'Épargne",
  nomJeu: "Fortnite",
  fullGameName: "La Map qui te met biiien",
  internalRootName: "[PILOTE - 326027] Caisse d'Épargne - Fortnite",
  externalRootName: "[EXT - PILOTE 326027] Caisse d'Épargne - Fortnite",
  calendarName: "[326027] Caisse d'Épargne - Fortnite",
  sandboxCalendarName: "[PILOTE - 326027] Caisse d'Épargne - Fortnite",
  talents: ["Kalut", "Aksianka", "Allyson", "Wig"] as const,
} as const;

export const CONFLICT_CP_CRISTALINE = {
  codeProjet: "326018",
  client: "Cristaline",
  invoiceFilename: "Facture QF08_326018.pdf",
} as const;

export const SECONDARY_PROJECT_326099 = {
  codeProjet: "326099",
  client: "Caisse d'Épargne",
  nomJeu: "Event Collaborateurs",
} as const;

export type SyncModePolicy = "INTERNAL_ONLY" | "NO_PERMANENT_EXT_SYNC" | "SYNCABLE_ON_VALIDATION";
export type ValidationStatusValue = "BROUILLON_INTERNE" | "EN_REVUE" | "VALIDE_CLIENT";
export type InfluencePlatform = "TIKTOK" | "YOUTUBE_SHORTS" | "INSTAGRAM" | "SNAPCHAT";

export interface DriveFolderSpec {
  code: string;
  name: string;
  syncMode: SyncModePolicy;
  extTargetPath?: string;
}

export const INTERNAL_TOP_LEVEL_FOLDERS: readonly string[] = [
  "001. Budget & Finance",
  "002. Pilotage & Rétroplanning",
  "003. Présentations & Weeklys",
  "004. Production",
  "005. Administratif & Juridique",
  "006. Reporting & Bilan",
];

export const INTERNAL_FOLDER_SPECS: readonly DriveFolderSpec[] = [
  { code: "001", name: "001. Budget & Finance", syncMode: "INTERNAL_ONLY" },
  { code: "001.1", name: "001.1 Budget", syncMode: "INTERNAL_ONLY" },
  { code: "001.2", name: "001.2 Devis", syncMode: "INTERNAL_ONLY" },
  { code: "001.3", name: "001.3 Factures", syncMode: "INTERNAL_ONLY" },
  { code: "002", name: "002. Pilotage & Rétroplanning", syncMode: "INTERNAL_ONLY" },
  { code: "002.1", name: "002.1 Rétroplanning Actif", syncMode: "NO_PERMANENT_EXT_SYNC" },
  { code: "002.2", name: "002.2 Historique Rétroplanning", syncMode: "INTERNAL_ONLY" },
  { code: "002.3", name: "002.3 Comptes Rendus", syncMode: "SYNCABLE_ON_VALIDATION", extTargetPath: "01. Rétroplanning & CR" },
  { code: "003", name: "003. Présentations & Weeklys", syncMode: "INTERNAL_ONLY" },
  { code: "003.1", name: "003.1 Kick-off & Recommandations", syncMode: "SYNCABLE_ON_VALIDATION", extTargetPath: "02. Présentations & Weeklys" },
  { code: "003.2", name: "003.2 Weeklys Clients", syncMode: "SYNCABLE_ON_VALIDATION", extTargetPath: "02. Présentations & Weeklys" },
  { code: "003.3", name: "003.3 _Archives", syncMode: "INTERNAL_ONLY" },
  { code: "004", name: "004. Production", syncMode: "SYNCABLE_ON_VALIDATION" },
  { code: "004.1", name: "004.1 Charte & Assets Client", syncMode: "SYNCABLE_ON_VALIDATION", extTargetPath: "03. Production Validée" },
  { code: "004.2", name: "004.2 Jeu & Dev", syncMode: "SYNCABLE_ON_VALIDATION", extTargetPath: "03. Production Validée/Jeu" },
  { code: "004.3", name: "004.3 Influence", syncMode: "SYNCABLE_ON_VALIDATION", extTargetPath: "03. Production Validée/Influence" },
  { code: "004.4", name: "004.4 Communication & Assets Créa", syncMode: "SYNCABLE_ON_VALIDATION", extTargetPath: "03. Production Validée/Kit Com" },
  { code: "004.5", name: "004.5 Site Web & Juridique Jeu", syncMode: "SYNCABLE_ON_VALIDATION", extTargetPath: "03. Production Validée/Site Web" },
  { code: "004.6", name: "004.6 Événementiel & Terrain", syncMode: "SYNCABLE_ON_VALIDATION", extTargetPath: "03. Production Validée" },
  { code: "005", name: "005. Administratif & Juridique", syncMode: "INTERNAL_ONLY" },
  { code: "005.1", name: "005.1 Contrats Client", syncMode: "INTERNAL_ONLY" },
  { code: "005.2", name: "005.2 Contrats Prestataires & Talents", syncMode: "INTERNAL_ONLY" },
  { code: "005.3", name: "005.3 Règlements & Conformité", syncMode: "INTERNAL_ONLY" },
  { code: "006", name: "006. Reporting & Bilan", syncMode: "INTERNAL_ONLY" },
  { code: "006.1", name: "006.1 Données Brutes", syncMode: "INTERNAL_ONLY" },
  { code: "006.2", name: "006.2 Reporting Excel & Sheets", syncMode: "INTERNAL_ONLY" },
  { code: "006.3", name: "006.3 Reporting Client (Slides)", syncMode: "SYNCABLE_ON_VALIDATION", extTargetPath: "04. Reporting Final" },
];

export const INTERNAL_NESTED_SUBFOLDERS: Readonly<Record<string, readonly string[]>> = {
  "004.2": ["01_Brief_Mapping", "02_3D_et_Assets", "03_HUD", "04_Builds_et_Captures"],
  "004.3": ["01_Brief_Influence", "02_Talents"],
  "004.4": [
    "01_Logo_Jeu",
    "02_Digital",
    "03_Print",
    "04_Newsletter",
    "05_Bande_Annonce",
    "06_Kit_Communication",
    "07_Presse",
  ],
  "004.5": ["01_Maquettes", "02_Textes", "03_Mentions_et_Reglement"],
  "004.6": ["01_Conducteur", "02_Quiz_et_Regie", "03_Logistique_et_Briefs"],
  "006.1": ["01_Fortnite_Creator_Portal", "02_Influence", "03_Verbatims_et_Scores"],
};

export const INTERNAL_004_4_LEAF_SUBFOLDERS: readonly string[] = [
  "Fixe",
  "Animé",
  "Annonce",
  "Lots",
  "Guide",
  "Bannières Web",
  "Affiches",
  "Kakémonos",
  "Vitrophanie",
  "Stickers",
  "DOOH",
  "RS",
];

export const TALENT_SUBFOLDERS_004_3: readonly string[] = ["Script", "Trame", "Vidéo", "Validations"];
export const INFLUENCE_PLATFORMS: readonly InfluencePlatform[] = ["TIKTOK", "YOUTUBE_SHORTS", "INSTAGRAM", "SNAPCHAT"];
export const INFLUENCE_PLATFORM_FOLDER_LABELS: readonly string[] = [
  "TikTok",
  "YouTube Shorts",
  "Instagram",
  "Snapchat",
];

export const EXT_MIRROR_FOLDERS: readonly string[] = [
  "01. Rétroplanning & CR",
  "02. Présentations & Weeklys",
  "03. Production Validée",
  "04. Reporting Final",
];
export const EXT_PRODUCTION_SUBFOLDERS: readonly string[] = ["Jeu", "Influence", "Kit Com", "Site Web"];

export const PENNYLANE_EMAIL = "gamersorigin-8j117x7x@suppliers.pennylane.com" as const;
export const PENNYLANE_DEFAULT_CC_NAMES: readonly string[] = ["Souléimane", "Louis", "Paul"];
export const INVOICE_FILENAME_REGEX = /^\d{4}-\d{2}-\d{2}_\d+_[^_]+_[\d.]+EUR\.pdf$/;
export const PENNYLANE_SUBJECT_REGEX = /^Facture \| .+ - .+ \| CP \d+$/;

export const BUDGET_TABS: readonly string[] = ["Vue d'ensemble", "Postes de dépenses"];
export const BUDGET_BLOCKS: readonly string[] = [
  "Prix de vente",
  "Coûts réels pré-opération",
  "Coûts réels post-opération",
];
export const BUDGET_ROW8_BLOCKS = {
  COL_A_SALE: "Prix de vente",
  COL_J_PRE_OP: "Couts réels pré-opération",
  COL_P_POST_OP: "Couts réels post-opération",
} as const;
export const BUDGET_ROW11_HEADERS = {
  SALE_C_TO_H: ["Objet", "Réalisé par", "Quantité", "Jours", "Coût/ unité (€)", "Prix (€)"],
  PRE_OP_J_TO_L: ["Type de dépenses", "Coût réel/u (€)", "Coût réel (€)"],
  POST_OP_P_TO_S: ["Qté", "Jours", "Coût réel/u (€)", "Coût réel (€)"],
} as const;
export const BUDGET_ALERT_THRESHOLDS = { WARNING_PCT: 85, CRITICAL_PCT: 100 } as const;

export const RETRO_SHEET_TAB = "Par semaine" as const;
export const RETRO_COLUMNS: readonly string[] = ["PHASES", "ÉTAPES", "TACHES"];
export const RETRO_SNAPSHOT_INTERVAL_DAYS = 14 as const;
export const RETRO_SNAPSHOT_NAME_REGEX = /^\d{4}-\d{2}-\d{2}_Retroplanning_.+$/;

export const CASCADE_OFFSETS = {
  INFLUENCE: [-10, -3, 0, 7] as const,
  LANCEMENT_MAP: [-14, -5, -2, 0] as const,
  WEEKLY: [-1, 0] as const,
} as const;

export const REPORTING_TABS: readonly string[] = [
  "Synthèse Fortnite",
  "Influence par Talent",
  "Cumulé Réseaux",
  "Verbatims",
];
export const REPORTING_SLIDES_DIMENSIONS_EMU = { width: 9144000, height: 5143500 } as const;
export const REPORTING_SLIDE_PATTERN: readonly string[] = [
  "Couverture",
  "Temps forts",
  "Chronologie",
  "Expérience",
  "Chiffres Fortnite",
  "Contenus - Talent",
  "Chiffres cumulés",
  "Ce que la communauté en dit",
];

export const PRECONDITION_CODES = ["GOOGLE_NOT_CONNECTED", "GEMINI_KEY_MISSING"] as const;
export const OAUTH_REQUIRED_SCOPE_TOKENS: readonly string[] = [
  "drive",
  "spreadsheets",
  "presentations",
  "gmail",
  "calendar",
];

export const M1_UI_ROUTES: readonly string[] = ["/", "/settings", "/projects", "/drive"];
export const UI_ROUTES: readonly string[] = [
  "/",
  "/settings",
  "/projects",
  "/drive",
  "/budget",
  "/retroplanning",
  "/calendar",
  "/weeklys",
  "/reporting",
];

const RESERVED_CPS = new Set(["326027", "326018", "326099"]);
let cpCounter = 0;

/** Generates a worker/test-unique 6-digit CP avoiding 326027, 326018, 326099. */
export function uniqueTestCp(workerIndex = 0): string {
  for (;;) {
    cpCounter = (cpCounter + 1) % 1000;
    const prefix = 400 + ((Math.abs(workerIndex) * 73 + cpCounter) % 590);
    const suffix = (Date.now() + cpCounter * 17) % 1000;
    const candidate = `${prefix}${String(suffix).padStart(3, "0")}`;
    if (!RESERVED_CPS.has(candidate)) {
      return candidate;
    }
  }
}

export function expectedInvoiceFilename(
  dateIso: string,
  cp: string,
  presta: string,
  amountHt: number
): string {
  const sanitizedPresta = presta.replace(/[^a-zA-Z0-9À-ÿ-]/g, "");
  const formattedAmount = Number.isInteger(amountHt) ? String(amountHt) : amountHt.toFixed(2);
  return `${dateIso}_${cp}_${sanitizedPresta}_${formattedAmount}EUR.pdf`;
}

export function expectedPennylaneSubject(presta: string, prestation: string, cp: string): string {
  return `Facture | ${presta} - ${prestation} | CP ${cp}`;
}
