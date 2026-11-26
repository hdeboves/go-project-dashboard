export const SHARED_DRIVE_ID = "0AH0MevQO5Eh6Uk9PVA";
export const APRES_VENTE_FOLDER_ID = "1MM7Gaz-ZkJ64pqqt7rGZF56OiiWjoWyb";
export const PROD_ROOT_FOLDER_ID = "16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD";
export const TEMPLATES_FOLDER_ID = "1b_c-pS0XiAWyP6AdgZdfvqZLvipNP5g3";

export const PROD_IMMUTABLE_IDS: ReadonlySet<string> = new Set([
  "16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD", // Projet PROD Caisse d'Épargne
  "1QUSOShHJmAlch3kP5F0RIf5txwyQ7Y6wf20A0jgCtMw", // Budget : CE - Fortnite
  "1ZG9mRIyDYDqTzJIGjGtJ4-ridgl6Cm2hqb75m1ba9XQ", // RETROPLANNING CAISSE EPARGNE
  "1C136EAzwoOUJI1DypSzBjr-vO6riZk3ncRKbI_9XAY0", // Reporting Caisse d'Epargne (Sheet)
  "1969-5uTXrKOlfOnEcYDfANfvl4trkn9wQNVPFJEckRU", // Reporting - Caisse d'Epargne (Slides)
  "1HWSWvNiTRxINZwsPHIHAa8SvhgwpP9euh3L-h1XCMrE", // Caisse d'Épargne - Weekly 11 septembre (Slides)
  "1b_c-pS0XiAWyP6AdgZdfvqZLvipNP5g3", // 5 - Templates projets
]);

// Direct file writes/deletes directly inside these top-level containers are blocked
// EXCEPT via bootstrapSandboxRoots() creating [PILOTE...] / [EXT - PILOTE...]
export const PROTECTED_CONTAINER_IDS: ReadonlySet<string> = new Set([
  SHARED_DRIVE_ID,
  APRES_VENTE_FOLDER_ID,
]);

export class SandboxViolationError extends Error {
  readonly code = "SANDBOX_VIOLATION" as const;
  readonly httpStatus = 403 as const;
  readonly statusCode = 403 as const;
  readonly operation: string;
  readonly targetId: string;
  readonly reason: string;
  readonly ancestryChain?: string[];
  readonly projectId?: string;

  constructor(params: {
    operation: string;
    targetId: string;
    reason: string;
    ancestryChain?: string[];
    projectId?: string;
  }) {
    super(
      `[SANDBOX GUARD] Opération bloquée (${params.operation}) sur "${params.targetId}" : ${params.reason}`
    );
    this.name = "SandboxViolationError";
    this.operation = params.operation;
    this.targetId = params.targetId;
    this.reason = params.reason;
    this.ancestryChain = params.ancestryChain;
    this.projectId = params.projectId;
  }
}

export interface DriveNodeMetadata {
  id: string;
  name?: string | null;
  parents?: string[] | null;
  driveId?: string | null;
}

export interface ParentResolver {
  getFileMetadata(fileId: string): Promise<DriveNodeMetadata>;
}

export interface SandboxProjectContext {
  projectId?: string;
  allowedRootIds: string[];
  onViolation?: (err: SandboxViolationError) => Promise<void> | void;
}

const CACHE_TTL_MS = 60_000;
const metadataCache = new Map<
  string,
  { meta: DriveNodeMetadata; expiresAt: number }
>();

export function clearSandboxCacheForTests(): void {
  metadataCache.clear();
}

export function isSandboxModeEnabled(): boolean {
  return process.env.SANDBOX_MODE !== "false";
}

function isAllowedSandboxRootName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.startsWith("[PILOTE") || name.startsWith("[EXT - PILOTE");
}

async function emitViolation(
  err: SandboxViolationError,
  ctx: SandboxProjectContext
): Promise<never> {
  if (ctx.onViolation) {
    try {
      await ctx.onViolation(err);
    } catch {
      // Never mask SandboxViolationError if AuditLog persistence fails
    }
  }
  throw err;
}

async function resolveCachedMetadata(
  fileId: string,
  resolver: ParentResolver
): Promise<DriveNodeMetadata> {
  const now = Date.now();
  const cached = metadataCache.get(fileId);
  if (cached && cached.expiresAt > now) {
    return cached.meta;
  }
  const meta = await resolver.getFileMetadata(fileId);
  metadataCache.set(fileId, { meta, expiresAt: now + CACHE_TTL_MS });
  return meta;
}

export async function assertDescendantOfSandboxRoot(
  fileId: string,
  operation: string,
  resolver: ParentResolver,
  ctx: SandboxProjectContext
): Promise<void> {
  const maxDepth = 15;
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number; path: string[] }> = [
    { id: fileId, depth: 0, path: [fileId] },
  ];
  const ancestryChain: string[] = [];
  const allowedSet = new Set(ctx.allowedRootIds.filter(Boolean));
  const sandboxMode = isSandboxModeEnabled();
  let truncatedByDepth = false;
  let cycleDetected = false;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    ancestryChain.push(current.id);

    if (PROD_IMMUTABLE_IDS.has(current.id)) {
      await emitViolation(
        new SandboxViolationError({
          operation,
          targetId: fileId,
          reason: `La ressource réside dans la hiérarchie PROD immuable (${current.id}).`,
          ancestryChain,
          projectId: ctx.projectId,
        }),
        ctx
      );
    }

    if (allowedSet.has(current.id)) {
      // If it is the root itself, verify metadata name if available when sandbox mode is enabled
      let meta: DriveNodeMetadata | null = null;
      try {
        meta = await resolveCachedMetadata(current.id, resolver);
      } catch {
        // If resolver cannot resolve a pre-verified DB root, trust DB root ID unless sandbox check fails
        meta = null;
      }

      if (meta && PROD_IMMUTABLE_IDS.has(meta.id)) {
        await emitViolation(
          new SandboxViolationError({
            operation,
            targetId: fileId,
            reason: `La ressource cible un ID PROD immuable (${meta.id}).`,
            ancestryChain,
            projectId: ctx.projectId,
          }),
          ctx
        );
      }

      if (!sandboxMode || !meta || isAllowedSandboxRootName(meta.name)) {
        return;
      }

      await emitViolation(
        new SandboxViolationError({
          operation,
          targetId: fileId,
          reason: `Le dossier racine "${meta.name ?? current.id}" ne porte pas le préfixe [PILOTE ou [EXT - PILOTE.`,
          ancestryChain,
          projectId: ctx.projectId,
        }),
        ctx
      );
    }

    if (current.depth >= maxDepth) {
      truncatedByDepth = true;
      continue;
    }

    // Do not walk above protected containers without hitting an allowed sandbox root
    if (PROTECTED_CONTAINER_IDS.has(current.id)) {
      continue;
    }

    let meta: DriveNodeMetadata;
    try {
      meta = await resolveCachedMetadata(current.id, resolver);
    } catch (err) {
      await emitViolation(
        new SandboxViolationError({
          operation,
          targetId: fileId,
          reason: `Impossible de vérifier l'ascendance Drive de ${current.id} (${err instanceof Error ? err.message : "erreur inconnue"}).`,
          ancestryChain,
          projectId: ctx.projectId,
        }),
        ctx
      );
      return;
    }

    if (meta.name && sandboxMode && allowedSet.has(meta.id) && !isAllowedSandboxRootName(meta.name)) {
      await emitViolation(
        new SandboxViolationError({
          operation,
          targetId: fileId,
          reason: `Racine sandbox invalide "${meta.name}".`,
          ancestryChain,
          projectId: ctx.projectId,
        }),
        ctx
      );
    }

    const parents = meta.parents ?? [];
    for (const parentId of parents) {
      if (!parentId) continue;
      if (current.path.includes(parentId)) {
        cycleDetected = true;
        continue;
      }
      if (!visited.has(parentId)) {
        queue.push({
          id: parentId,
          depth: current.depth + 1,
          path: [...current.path, parentId],
        });
      }
    }
  }

  // Reached root/limit without finding an authorized sandbox root.
  // Always fail closed if traversal was truncated by depth or encountered a cycle,
  // even when SANDBOX_MODE="false", to guarantee PROD immutability beyond 15 hops.
  if (sandboxMode || allowedSet.size === 0 || truncatedByDepth || cycleDetected) {
    const reason = cycleDetected
      ? "Cycle détecté dans la chaîne d'ascendance Drive : impossible de vérifier l'absence de lien avec la hiérarchie PROD."
      : truncatedByDepth
        ? "Profondeur maximale d'ascendance Drive dépassée (>15 niveaux) : impossible de vérifier l'absence de lien avec la hiérarchie PROD."
        : allowedSet.size === 0
          ? "Aucun dossier racine sandbox autorisé n'est enregistré en base."
          : "La cible n'est pas un descendant d'un dossier sandbox autorisé ([PILOTE / [EXT - PILOTE).";

    await emitViolation(
      new SandboxViolationError({
        operation,
        targetId: fileId,
        reason,
        ancestryChain,
        projectId: ctx.projectId,
      }),
      ctx
    );
  }
}

export async function assertSandboxWriteAllowed(params: {
  operation: string;
  targetIds?: Array<string | null | undefined>;
  parentIds?: Array<string | null | undefined>;
  resolver: ParentResolver;
  ctx: SandboxProjectContext;
}): Promise<void> {
  const ids = [...(params.targetIds ?? []), ...(params.parentIds ?? [])].filter(
    (id): id is string => Boolean(id && id.trim().length > 0)
  );

  if (ids.length === 0) {
    await emitViolation(
      new SandboxViolationError({
        operation: params.operation,
        targetId: "(empty)",
        reason: "Aucun identifiant cible ou parent fourni pour vérification sandbox.",
        projectId: params.ctx.projectId,
      }),
      params.ctx
    );
  }

  // Phase 1: Zero-network synchronous blocklist
  for (const id of ids) {
    if (PROD_IMMUTABLE_IDS.has(id)) {
      await emitViolation(
        new SandboxViolationError({
          operation: params.operation,
          targetId: id,
          reason: "Identifiant PROD immuable interdit en écriture/modification/suppression.",
          projectId: params.ctx.projectId,
        }),
        params.ctx
      );
    }
    if (PROTECTED_CONTAINER_IDS.has(id)) {
      await emitViolation(
        new SandboxViolationError({
          operation: params.operation,
          targetId: id,
          reason:
            "Écriture directe dans un conteneur racine protégé interdite hors bootstrapSandboxRoots().",
          projectId: params.ctx.projectId,
        }),
        params.ctx
      );
    }
  }

  // Phase 2: Upward parent-chain ancestry check
  for (const id of ids) {
    await assertDescendantOfSandboxRoot(
      id,
      params.operation,
      params.resolver,
      params.ctx
    );
  }
}

export async function assertSandboxCopyAllowed(params: {
  operation?: string;
  sourceFileId: string;
  destinationParentId: string;
  resolver: ParentResolver;
  ctx: SandboxProjectContext;
}): Promise<void> {
  const operation = params.operation ?? "drive.files.copy";
  if (!params.sourceFileId?.trim()) {
    await emitViolation(
      new SandboxViolationError({
        operation,
        targetId: "(missing-source)",
        reason: "sourceFileId manquant pour la copie.",
        projectId: params.ctx.projectId,
      }),
      params.ctx
    );
  }
  // Source file MAY be in PROD_IMMUTABLE_IDS (read/copy-from template only).
  // Destination parent MUST strictly pass sandbox write validation.
  await assertSandboxWriteAllowed({
    operation,
    targetIds: [],
    parentIds: [params.destinationParentId],
    resolver: params.resolver,
    ctx: params.ctx,
  });
}

export async function assertSandboxBootstrapCreateAllowed(params: {
  parentId: string;
  folderName: string;
  onViolation?: (err: SandboxViolationError) => Promise<void> | void;
}): Promise<void> {
  const { parentId, folderName, onViolation } = params;
  if (parentId !== APRES_VENTE_FOLDER_ID) {
    const err = new SandboxViolationError({
      operation: "drive.bootstrapSandboxRoots",
      targetId: parentId,
      reason: `Le bootstrap sandbox doit cibler exclusivement le dossier 3 - Après-vente (${APRES_VENTE_FOLDER_ID}).`,
    });
    if (onViolation) {
      try {
        await onViolation(err);
      } catch {
        // ignore
      }
    }
    throw err;
  }

  if (
    !folderName.startsWith("[PILOTE") &&
    !folderName.startsWith("[EXT - PILOTE")
  ) {
    const err = new SandboxViolationError({
      operation: "drive.bootstrapSandboxRoots",
      targetId: parentId,
      reason: `Nom de dossier racine non autorisé en mode sandbox : "${folderName}". Doit commencer par "[PILOTE" ou "[EXT - PILOTE".`,
    });
    if (onViolation) {
      try {
        await onViolation(err);
      } catch {
        // ignore
      }
    }
    throw err;
  }
}

export function assertCalendarIdAllowed(
  calendarId: string,
  registeredCalendarIds: Iterable<string>
): void {
  const normalized = calendarId?.trim() ?? "";
  if (!normalized || normalized.toLowerCase() === "primary") {
    throw new SandboxViolationError({
      operation: "calendar.guard",
      targetId: normalized || "(empty)",
      reason:
        "L'agenda personnel 'primary' est strictement interdit. Utilisez uniquement un agenda secondaire dédié au projet.",
    });
  }

  const allowed = new Set(Array.from(registeredCalendarIds).filter(Boolean));
  if (!allowed.has(normalized)) {
    throw new SandboxViolationError({
      operation: "calendar.guard",
      targetId: normalized,
      reason:
        "Identifiant d'agenda non enregistré dans les projets actifs de GO L'Intrus.",
    });
  }
}
