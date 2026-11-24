export interface CpConflictResult {
  hasConflict: boolean;
  activeCp: string;
  detectedCps: string[];
  conflictingCps: string[];
  reason?: string;
}

export class CpConflictError extends Error {
  readonly statusCode = 409 as const;
  readonly httpStatus = 409 as const;
  readonly code = "CP_CONFLICT" as const;
  readonly result: CpConflictResult;

  constructor(result: CpConflictResult) {
    super(
      result.reason ??
        `Conflit de Code Projet détecté (actif: ${result.activeCp}, détectés: ${result.conflictingCps.join(", ")})`
    );
    this.name = "CpConflictError";
    this.result = result;
  }
}

export function normalizeCp(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/^CP[\s:=\-#]*/i, "").trim();
  if (/^\d{4,8}$/.test(stripped)) {
    return stripped;
  }
  return null;
}

export function extractCodeProjets(
  input: string | null | undefined,
  activeCpHint?: string | null
): string[] {
  if (!input || typeof input !== "string" || !input.trim()) {
    return [];
  }

  const found = new Set<string>();

  // Pattern 1a: Explicit CP / code_projet keywords (4-8 digits)
  const explicitKeywordRegex =
    /(?:^|[^A-Za-z0-9])(?:CP|code[\s_-]*projet|code\s*cp)\s*[:=\-#]?\s*(\d{4,8})(?![0-9]|[.,]\d)/gi;
  for (const match of input.matchAll(explicitKeywordRegex)) {
    if (match[1]) {
      found.add(match[1]);
    }
  }

  // Pattern 1b: "projet" only with explicit key-value delimiter (:, =, #) and ignoring 4-digit years (19xx/20xx)
  const explicitProjetDelimiterRegex =
    /(?:^|[^A-Za-z0-9])projet\s*[:=#]\s*(\d{4,8})(?![0-9]|[.,]\d)/gi;
  for (const match of input.matchAll(explicitProjetDelimiterRegex)) {
    if (match[1] && !/^(?:19|20)\d{2}$/.test(match[1])) {
      found.add(match[1]);
    }
  }

  // Pattern 2: Delimiter-bounded GO 6-digit project codes starting with "32"
  // Uses (?:^|[^0-9]) instead of \b so underscore-separated filenames like QF08_326018.pdf match,
  // and excludes monetary decimals like 326018.00 or 326018,50.
  const goCodeRegex = /(?:^|[^0-9])(32\d{4})(?![0-9]|[.,]\d)/g;
  for (const match of input.matchAll(goCodeRegex)) {
    if (match[1]) {
      found.add(match[1]);
    }
  }

  // Pattern 3: 6-digit CP embedded in invoice/document filenames regardless of prefix
  // (e.g. Facture QF08_410088.pdf, Facture QF08_550088.pdf, 2026-11-24_410088_Studio_1000EUR.pdf)
  const filenameCpRegex =
    /(?:^|[^A-Za-z0-9])[A-Za-z0-9-]+_(\d{6})(?=\.[A-Za-z][A-Za-z0-9]{1,4}(?:$|[^A-Za-z0-9])|_[A-Za-z0-9._-]+\.[A-Za-z][A-Za-z0-9]{1,4}(?:$|[^A-Za-z0-9]))/g;
  for (const match of input.matchAll(filenameCpRegex)) {
    if (match[1]) {
      found.add(match[1]);
    }
  }

  // Optional prefix match if activeCpHint has a different 2-digit prefix (e.g. 41xxxx)
  const normalizedHint = normalizeCp(activeCpHint);
  if (
    normalizedHint &&
    normalizedHint.length >= 5 &&
    normalizedHint.length <= 7 &&
    !normalizedHint.startsWith("32")
  ) {
    const prefix = normalizedHint.slice(0, 2);
    const restLen = normalizedHint.length - 2;
    const hintRegex = new RegExp(
      `(?:^|[^0-9])(${prefix}\\d{${restLen}})(?![0-9]|[.,]\\d)`,
      "g"
    );
    for (const match of input.matchAll(hintRegex)) {
      if (match[1]) {
        found.add(match[1]);
      }
    }
  }

  return Array.from(found);
}

export function checkCodeProjetConflict(
  activeCp: string,
  extractedCp: string | null,
  rawText: string
): CpConflictResult {
  const normalizedActive = normalizeCp(activeCp) ?? activeCp?.trim() ?? "";
  const candidates = new Set<string>();

  if (extractedCp && typeof extractedCp === "string" && extractedCp.trim()) {
    const direct = normalizeCp(extractedCp);
    if (direct) {
      candidates.add(direct);
    }
    for (const extracted of extractCodeProjets(extractedCp, normalizedActive)) {
      candidates.add(extracted);
    }
  }

  for (const fromText of extractCodeProjets(rawText, normalizedActive)) {
    candidates.add(fromText);
  }

  const detectedCps = Array.from(candidates);
  const conflictingCps = detectedCps.filter((cp) => cp !== normalizedActive);
  const hasConflict = conflictingCps.length > 0;

  if (!hasConflict) {
    return {
      hasConflict: false,
      activeCp: normalizedActive,
      detectedCps,
      conflictingCps: [],
    };
  }

  return {
    hasConflict: true,
    activeCp: normalizedActive,
    detectedCps,
    conflictingCps,
    reason:
      normalizedActive.length > 0
        ? `Conflit de Code Projet détecté : CP ${conflictingCps.join(", ")} détecté(s) dans le projet actif CP ${normalizedActive}. Injection automatique bloquée.`
        : `Code Projet actif manquant/vide : CP ${conflictingCps.join(", ")} détecté(s). Injection automatique bloquée.`,
  };
}

export function assertNoCpConflict(
  activeCp: string,
  extractedCp: string | null,
  rawText: string
): CpConflictResult {
  const result = checkCodeProjetConflict(activeCp, extractedCp, rawText);
  if (result.hasConflict) {
    throw new CpConflictError(result);
  }
  return result;
}
