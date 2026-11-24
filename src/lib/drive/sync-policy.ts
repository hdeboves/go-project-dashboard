export const SyncMode = {
  INTERNAL_ONLY: "INTERNAL_ONLY",
  NO_PERMANENT_EXT_SYNC: "NO_PERMANENT_EXT_SYNC",
  SYNCABLE_ON_VALIDATION: "SYNCABLE_ON_VALIDATION",
} as const;
export type SyncMode = (typeof SyncMode)[keyof typeof SyncMode];

export const ValidationStatus = {
  BROUILLON_INTERNE: "BROUILLON_INTERNE",
  EN_REVUE: "EN_REVUE",
  VALIDE_CLIENT: "VALIDE_CLIENT",
} as const;
export type ValidationStatus =
  (typeof ValidationStatus)[keyof typeof ValidationStatus];

export class RetroplanningPermanentSyncForbiddenError extends Error {
  readonly statusCode = 403 as const;
  readonly httpStatus = 403 as const;
  readonly code = "RETROPLANNING_PERMANENT_EXT_SYNC_FORBIDDEN" as const;

  constructor(public readonly nodeCode: string) {
    super(
      `[VERROU 002.1] Synchronisation permanente vers [EXT] strictement interdite pour "${nodeCode}". Le Rétroplanning Actif reste interne par défaut (seul un export ponctuel manuel est autorisé).`
    );
    this.name = "RetroplanningPermanentSyncForbiddenError";
  }
}

export class InternalOnlySyncForbiddenError extends Error {
  readonly statusCode = 403 as const;
  readonly httpStatus = 403 as const;
  readonly code = "INTERNAL_ONLY_EXT_SYNC_FORBIDDEN" as const;

  constructor(public readonly nodeCode: string) {
    super(
      `Synchronisation vers [EXT] interdite pour le nœud strictement interne "${nodeCode}".`
    );
    this.name = "InternalOnlySyncForbiddenError";
  }
}

export interface FolderBlueprint {
  code: string;
  name: string;
  parentCode: string | null;
  syncMode: SyncMode;
  extMirrorCode: string | null;
}

export interface ExternalMirrorBlueprint {
  code: string;
  name: string;
  parentCode: string | null;
}

export interface NodeSyncPolicy {
  code: string;
  syncMode: SyncMode;
  extMirrorCode: string | null;
  isExtEligible: boolean;
  allowPermanentExtSync: boolean;
}

// Exhaustive 61 internal folders (001. -> 006.)
export const INTERNAL_FOLDER_TREE: readonly FolderBlueprint[] = [
  // 001. Budget & Finance (INTERNAL_ONLY)
  { code: "001", name: "001. Budget & Finance", parentCode: null, syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "001.1", name: "001.1 Budget", parentCode: "001", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "001.2", name: "001.2 Devis", parentCode: "001", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "001.3", name: "001.3 Factures", parentCode: "001", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },

  // 002. Pilotage & Rétroplanning
  { code: "002", name: "002. Pilotage & Rétroplanning", parentCode: null, syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "002.1", name: "002.1 Rétroplanning Actif", parentCode: "002", syncMode: SyncMode.NO_PERMANENT_EXT_SYNC, extMirrorCode: null },
  { code: "002.2", name: "002.2 Historique Rétroplanning", parentCode: "002", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "002.3", name: "002.3 Comptes Rendus", parentCode: "002", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.01" },

  // 003. Présentations & Weeklys
  { code: "003", name: "003. Présentations & Weeklys", parentCode: null, syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "003.1", name: "003.1 Kick-off & Recommandations", parentCode: "003", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.02" },
  { code: "003.2", name: "003.2 Weeklys Clients", parentCode: "003", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.02" },
  { code: "003.3", name: "003.3 _Archives", parentCode: "003", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },

  // 004. Production
  { code: "004", name: "004. Production", parentCode: null, syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "004.1", name: "004.1 Charte & Assets Client", parentCode: "004", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },

  { code: "004.2", name: "004.2 Jeu & Dev", parentCode: "004", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.1" },
  { code: "004.2.1", name: "01_Brief_Mapping", parentCode: "004.2", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.1" },
  { code: "004.2.2", name: "02_3D_et_Assets", parentCode: "004.2", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.1" },
  { code: "004.2.3", name: "03_HUD", parentCode: "004.2", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.1" },
  { code: "004.2.4", name: "04_Builds_et_Captures", parentCode: "004.2", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.1" },

  { code: "004.3", name: "004.3 Influence", parentCode: "004", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.2" },
  { code: "004.3.1", name: "01_Brief_Influence", parentCode: "004.3", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.2" },
  { code: "004.3.2", name: "02_Talents", parentCode: "004.3", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.2" },

  { code: "004.4", name: "004.4 Communication & Assets Créa", parentCode: "004", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.1", name: "01_Logo_Jeu", parentCode: "004.4", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.1.1", name: "Fixe", parentCode: "004.4.1", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.1.2", name: "Animé", parentCode: "004.4.1", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.2", name: "02_Digital", parentCode: "004.4", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.2.1", name: "Annonce", parentCode: "004.4.2", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.2.2", name: "Lots", parentCode: "004.4.2", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.2.3", name: "Guide", parentCode: "004.4.2", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.2.4", name: "Bannières Web", parentCode: "004.4.2", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.3", name: "03_Print", parentCode: "004.4", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.3.1", name: "Affiches", parentCode: "004.4.3", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.3.2", name: "Kakémonos", parentCode: "004.4.3", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.3.3", name: "Vitrophanie", parentCode: "004.4.3", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.3.4", name: "Stickers", parentCode: "004.4.3", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.4", name: "04_Newsletter", parentCode: "004.4", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.5", name: "05_Bande_Annonce", parentCode: "004.4", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.5.1", name: "DOOH", parentCode: "004.4.5", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.5.2", name: "RS", parentCode: "004.4.5", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.6", name: "06_Kit_Communication", parentCode: "004.4", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },
  { code: "004.4.7", name: "07_Presse", parentCode: "004.4", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.3" },

  { code: "004.5", name: "004.5 Site Web & Juridique Jeu", parentCode: "004", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.4" },
  { code: "004.5.1", name: "01_Maquettes", parentCode: "004.5", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.4" },
  { code: "004.5.2", name: "02_Textes", parentCode: "004.5", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.4" },
  { code: "004.5.3", name: "03_Mentions_et_Reglement", parentCode: "004.5", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.03.4" },

  { code: "004.6", name: "004.6 Événementiel & Terrain", parentCode: "004", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "004.6.1", name: "01_Conducteur", parentCode: "004.6", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "004.6.2", name: "02_Quiz_et_Regie", parentCode: "004.6", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "004.6.3", name: "03_Logistique_et_Briefs", parentCode: "004.6", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },

  // 005. Administratif & Juridique (INTERNAL_ONLY)
  { code: "005", name: "005. Administratif & Juridique", parentCode: null, syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "005.1", name: "005.1 Contrats Client", parentCode: "005", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "005.2", name: "005.2 Contrats Prestataires & Talents", parentCode: "005", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "005.3", name: "005.3 Règlements & Conformité", parentCode: "005", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },

  // 006. Reporting & Bilan
  { code: "006", name: "006. Reporting & Bilan", parentCode: null, syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "006.1", name: "006.1 Données Brutes", parentCode: "006", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "006.1.1", name: "01_Fortnite_Creator_Portal", parentCode: "006.1", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "006.1.2", name: "02_Influence", parentCode: "006.1", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "006.1.3", name: "03_Verbatims_et_Scores", parentCode: "006.1", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "006.2", name: "006.2 Reporting Excel & Sheets", parentCode: "006", syncMode: SyncMode.INTERNAL_ONLY, extMirrorCode: null },
  { code: "006.3", name: "006.3 Reporting Client (Slides)", parentCode: "006", syncMode: SyncMode.SYNCABLE_ON_VALIDATION, extMirrorCode: "EXT.04" },
];

// Exhaustive 8 [EXT] mirror folders
export const EXTERNAL_MIRROR_TREE: readonly ExternalMirrorBlueprint[] = [
  { code: "EXT.01", name: "01. Rétroplanning & CR", parentCode: null },
  { code: "EXT.02", name: "02. Présentations & Weeklys", parentCode: null },
  { code: "EXT.03", name: "03. Production Validée", parentCode: null },
  { code: "EXT.03.1", name: "Jeu", parentCode: "EXT.03" },
  { code: "EXT.03.2", name: "Influence", parentCode: "EXT.03" },
  { code: "EXT.03.3", name: "Kit Com", parentCode: "EXT.03" },
  { code: "EXT.03.4", name: "Site Web", parentCode: "EXT.03" },
  { code: "EXT.04", name: "04. Reporting Final", parentCode: null },
];

const BLUEPRINT_BY_CODE = new Map<string, FolderBlueprint>(
  INTERNAL_FOLDER_TREE.map((f) => [f.code, f])
);

const SORTED_PREFIXES = [...INTERNAL_FOLDER_TREE].sort(
  (a, b) => b.code.length - a.code.length
);

export function isRetroplanningNodeCode(nodeCode: string): boolean {
  const normalized = nodeCode.trim();
  return normalized === "002.1" || normalized.startsWith("002.1.");
}

export function getSyncPolicy(nodeCode: string): NodeSyncPolicy {
  const normalized = nodeCode.trim();

  // Hard unconditional lock on 002.1 and all children/files inside it
  if (isRetroplanningNodeCode(normalized)) {
    return {
      code: normalized,
      syncMode: SyncMode.NO_PERMANENT_EXT_SYNC,
      extMirrorCode: null,
      isExtEligible: false,
      allowPermanentExtSync: false,
    };
  }

  const exact = BLUEPRINT_BY_CODE.get(normalized);
  if (exact) {
    const syncable = exact.syncMode === SyncMode.SYNCABLE_ON_VALIDATION;
    return {
      code: normalized,
      syncMode: exact.syncMode,
      extMirrorCode: exact.extMirrorCode,
      isExtEligible: syncable,
      allowPermanentExtSync: syncable,
    };
  }

  // Longest prefix match (e.g., 004.3.2.kalut.video -> 004.3.2)
  for (const candidate of SORTED_PREFIXES) {
    if (normalized.startsWith(`${candidate.code}.`)) {
      const syncable = candidate.syncMode === SyncMode.SYNCABLE_ON_VALIDATION;
      return {
        code: normalized,
        syncMode: candidate.syncMode,
        extMirrorCode: candidate.extMirrorCode,
        isExtEligible: syncable,
        allowPermanentExtSync: syncable,
      };
    }
  }

  // Fail-closed default for unknown codes
  return {
    code: normalized,
    syncMode: SyncMode.INTERNAL_ONLY,
    extMirrorCode: null,
    isExtEligible: false,
    allowPermanentExtSync: false,
  };
}

export function assertExtSyncAllowed(nodeCode: string): NodeSyncPolicy {
  const policy = getSyncPolicy(nodeCode);
  if (policy.syncMode === SyncMode.NO_PERMANENT_EXT_SYNC) {
    throw new RetroplanningPermanentSyncForbiddenError(nodeCode);
  }
  if (policy.syncMode === SyncMode.INTERNAL_ONLY) {
    throw new InternalOnlySyncForbiddenError(nodeCode);
  }
  return policy;
}
