import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import type {
  InfluenceMetric,
  PrismaClient,
  ReportingRawFile,
} from "@prisma/client";
import { provisionTalentFolders, slugifySegment } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import { CpConflictError, assertNoCpConflict } from "@/lib/isolation/cp-guard";
import type {
  DriveFileRecord,
  DrivePort,
  GeminiPort,
  GoogleWorkspacePort,
} from "@/lib/ports";
import {
  type InfluencePlatform,
  PLATFORM_FOLDER_ALIASES,
  computeEngagementRate,
  getTalentPlatformDriveCode,
  normalizeInfluencePlatform,
} from "@/lib/reporting/types";

export type SupportedImageMime = "image/png" | "image/jpeg" | "image/webp";

const ALLOWED_IMAGE_MIMES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export function detectImageMagicMime(buffer: Buffer): SupportedImageMime | null {
  if (!buffer || buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR minimum size
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // WEBP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export function extractPngTextChunks(buffer: Buffer): string[] {
  if (detectImageMagicMime(buffer) !== "image/png") return [];
  const texts: string[] = [];
  let offset = 8;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length > buffer.length || dataEnd + 4 > buffer.length) {
      break;
    }

    const chunkData = buffer.subarray(dataStart, dataEnd);
    if (type === "tEXt") {
      const text = chunkData.toString("latin1").replace(/\0/g, " ").trim();
      if (text) texts.push(text);
    } else if (type === "iTXt") {
      const text = chunkData.toString("utf8").replace(/\0/g, " ").trim();
      if (text) texts.push(text);
    } else if (type === "zTXt") {
      const nulIdx = chunkData.indexOf(0);
      if (nulIdx !== -1 && nulIdx + 2 < chunkData.length) {
        const keyword = chunkData.subarray(0, nulIdx).toString("latin1");
        try {
          const inflated = inflateSync(chunkData.subarray(nulIdx + 2), {
            maxOutputLength: 256 * 1024,
          }).toString("latin1");
          texts.push(`${keyword} ${inflated}`.trim());
        } catch {
          // Ignore malformed or oversized compressed chunk
        }
      }
    }

    offset = dataEnd + 4;
    if (type === "IEND") break;
  }

  return texts;
}

function getImageExtension(mime: SupportedImageMime): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return "webp";
}

function normalizeOptionalInt(
  val: number | null | undefined
): number | null {
  if (val === null || val === undefined) return null;
  if (!Number.isFinite(val)) return null;
  return Math.round(val);
}

async function resolveInfluenceTargetFolderId(
  prisma: PrismaClient,
  drive: DrivePort,
  projectId: string,
  talentName: string,
  platform: InfluencePlatform
): Promise<string | null> {
  const exactCode = getTalentPlatformDriveCode(talentName, platform);
  const existingExact = await prisma.driveNode.findFirst({
    where: { projectId, code: exactCode },
  });
  if (existingExact?.driveFileId) {
    return existingExact.driveFileId;
  }

  const folder00612 = await prisma.driveNode.findFirst({
    where: { projectId, code: "006.1.2" },
  });

  if (folder00612?.driveFileId) {
    try {
      const provisioned = await provisionTalentFolders(
        prisma,
        drive,
        projectId,
        talentName
      );
      const match = provisioned.createdNodes.find((n) => n.code === exactCode);
      if (match?.driveFileId) {
        return match.driveFileId;
      }
    } catch {
      // Fallback below
    }

    // Check Drive directly for PROD-style uppercase folder aliases (TIKTOK, YOUTUBE, INSTA, SNAP)
    try {
      const talentFolders = await drive.listChildren(folder00612.driveFileId);
      const talentSlug = slugifySegment(talentName);
      const talentDir = talentFolders.find(
        (f) =>
          f.mimeType === "application/vnd.google-apps.folder" &&
          slugifySegment(f.name) === talentSlug
      );
      if (talentDir) {
        const platFolders = await drive.listChildren(talentDir.id);
        const aliases = PLATFORM_FOLDER_ALIASES[platform].map((a) =>
          a.toLowerCase()
        );
        const matchedPlat = platFolders.find(
          (f) =>
            f.mimeType === "application/vnd.google-apps.folder" &&
            aliases.includes(f.name.trim().toLowerCase())
        );
        if (matchedPlat) return matchedPlat.id;
        return talentDir.id;
      }
    } catch {
      // Fallback to 006.1.2
    }

    return folder00612.driveFileId;
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  return project?.driveInternalRootId ?? null;
}

export async function listDriveInfluenceCandidates(
  prisma: PrismaClient,
  drive: DrivePort,
  projectId: string
): Promise<
  Array<{
    driveFileId: string;
    name: string;
    mimeType: string;
    talentHint: string | null;
    platformHint: InfluencePlatform | null;
  }>
> {
  const folder00612 = await prisma.driveNode.findFirst({
    where: { projectId, code: "006.1.2" },
  });
  if (!folder00612?.driveFileId) return [];

  const candidates: Array<{
    driveFileId: string;
    name: string;
    mimeType: string;
    talentHint: string | null;
    platformHint: InfluencePlatform | null;
  }> = [];

  const topChildren = await drive.listChildren(folder00612.driveFileId);
  for (const child of topChildren) {
    if (child.mimeType !== "application/vnd.google-apps.folder") {
      if (child.mimeType.startsWith("image/")) {
        candidates.push({
          driveFileId: child.id,
          name: child.name,
          mimeType: child.mimeType,
          talentHint: null,
          platformHint: null,
        });
      }
      continue;
    }

    const talentHint = child.name;
    const level2: DriveFileRecord[] = await drive.listChildren(child.id);
    for (const sub of level2) {
      if (sub.mimeType !== "application/vnd.google-apps.folder") {
        if (sub.mimeType.startsWith("image/")) {
          candidates.push({
            driveFileId: sub.id,
            name: sub.name,
            mimeType: sub.mimeType,
            talentHint,
            platformHint: null,
          });
        }
        continue;
      }

      const platformHint = normalizeInfluencePlatform(sub.name);
      const files = await drive.listChildren(sub.id);
      for (const f of files) {
        if (
          f.mimeType !== "application/vnd.google-apps.folder" &&
          f.mimeType.startsWith("image/")
        ) {
          candidates.push({
            driveFileId: f.id,
            name: f.name,
            mimeType: f.mimeType,
            talentHint,
            platformHint,
          });
        }
      }
    }
  }

  return candidates;
}

export async function saveLocalReportingPreview(params: {
  projectId: string;
  rawFileId: string;
  mimeType: SupportedImageMime;
  buffer: Buffer;
}): Promise<string | null> {
  const ext = getImageExtension(params.mimeType);
  const baseDir =
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
      ? path.join(os.tmpdir(), "go-project-hub-data")
      : path.join(process.cwd(), ".data");
  const dir = path.join(baseDir, "reporting-previews", params.projectId);
  const filePath = path.join(dir, `${params.rawFileId}.${ext}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, params.buffer);
    return filePath;
  } catch {
    // Non-fatal in serverless read-only environments; Google Drive file is the durable source.
    return null;
  }
}

export interface IngestInfluenceInput {
  fileBuffer?: Buffer | null;
  filename?: string;
  declaredMimeType?: string;
  driveFileId?: string | null;
  talentName: string;
  platform: string;
  contentUrl?: string | null;
  sparkCode?: string | null;
  publishedAt?: string | null;
}

export async function ingestInfluenceScreenshot(
  services: {
    prisma: PrismaClient;
    getGoogleGateway: (activeProjectId?: string) => Promise<GoogleWorkspacePort>;
    getGeminiClient: () => Promise<GeminiPort>;
  },
  projectId: string,
  input: IngestInfluenceInput
): Promise<{
  metric: InfluenceMetric;
  rawFile: ReportingRawFile;
}> {
  const { prisma } = services;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const talentName = input.talentName.trim();
  if (!talentName) {
    throw new AppHttpError(
      400,
      "INVALID_TALENT_NAME",
      "Le nom du talent est obligatoire."
    );
  }

  const platform = normalizeInfluencePlatform(input.platform);
  if (!platform) {
    throw new AppHttpError(
      400,
      "UNSUPPORTED_PLATFORM",
      `Plateforme non supportée : "${input.platform}". Valeurs attendues : TIKTOK, YOUTUBE_SHORTS, INSTAGRAM, SNAPCHAT.`
    );
  }

  if (input.declaredMimeType) {
    const cleanDeclared = input.declaredMimeType.trim().toLowerCase();
    if (cleanDeclared && !ALLOWED_IMAGE_MIMES.has(cleanDeclared)) {
      throw new AppHttpError(
        415,
        "UNSUPPORTED_IMAGE_MIME",
        `Type MIME non supporté : "${input.declaredMimeType}". Formats acceptés : PNG, JPEG, WEBP.`
      );
    }
  }

  let imageBuffer = input.fileBuffer ?? null;
  let filename = input.filename?.trim() || "influence_screenshot.png";

  // Pre-flight CP check on metadata before any network/AI call
  try {
    assertNoCpConflict(
      project.codeProjet,
      null,
      [
        talentName,
        filename,
        input.contentUrl ?? "",
        input.sparkCode ?? "",
      ].join(" ")
    );
  } catch (err) {
    if (err instanceof CpConflictError) {
      await prisma.auditLog.create({
        data: {
          projectId,
          actor: "system:cp-guard",
          action: "CP_CONFLICT_BLOCKED",
          targetType: "INFLUENCE_SCREENSHOT",
          targetId: filename,
          detailsJson: JSON.stringify(err.result),
        },
      });
    }
    throw err;
  }

  let detectedMime: SupportedImageMime | null = null;
  if (imageBuffer) {
    detectedMime = detectImageMagicMime(imageBuffer);
    if (!detectedMime) {
      throw new AppHttpError(
        400,
        "INVALID_IMAGE_BUFFER",
        "Le fichier image fourni est corrompu ou n'est pas un PNG/JPEG/WEBP valide."
      );
    }
    const pngTexts = extractPngTextChunks(imageBuffer);
    if (pngTexts.length > 0) {
      try {
        assertNoCpConflict(project.codeProjet, null, pngTexts.join(" "));
      } catch (err) {
        if (err instanceof CpConflictError) {
          await prisma.auditLog.create({
            data: {
              projectId,
              actor: "system:cp-guard",
              action: "CP_CONFLICT_BLOCKED",
              targetType: "INFLUENCE_SCREENSHOT",
              targetId: filename,
              detailsJson: JSON.stringify(err.result),
            },
          });
        }
        throw err;
      }
    }
  }

  // Acquire external services (propagates 412 PreconditionError when unconfigured)
  const gateway = await services.getGoogleGateway(projectId);
  const gemini = await services.getGeminiClient();

  let driveFileId: string | null = input.driveFileId?.trim() || null;
  if (!imageBuffer) {
    if (!driveFileId) {
      throw new AppHttpError(
        400,
        "MISSING_IMAGE_FILE",
        "Veuillez fournir une capture d'écran image ou un fichier Drive 006.1.2."
      );
    }
    const meta = await gateway.drive.getFileMetadata(driveFileId);
    filename = meta.name || filename;
    imageBuffer = await gateway.drive.downloadFile(driveFileId);
    detectedMime = detectImageMagicMime(imageBuffer);
    if (!detectedMime) {
      throw new AppHttpError(
        400,
        "INVALID_IMAGE_BUFFER",
        "Le fichier Drive sélectionné n'est pas une image PNG/JPEG/WEBP valide."
      );
    }
    const pngTexts = extractPngTextChunks(imageBuffer);
    try {
      assertNoCpConflict(
        project.codeProjet,
        null,
        [filename, ...pngTexts].join(" ")
      );
    } catch (err) {
      if (err instanceof CpConflictError) {
        await prisma.auditLog.create({
          data: {
            projectId,
            actor: "system:cp-guard",
            action: "CP_CONFLICT_BLOCKED",
            targetType: "INFLUENCE_SCREENSHOT",
            targetId: filename,
            detailsJson: JSON.stringify(err.result),
          },
        });
      }
      throw err;
    }
  }

  const extracted = await gemini.extractInfluenceMetricsFromImage({
    imageBuffer,
    mimeType: detectedMime!,
    talentName,
    platform,
  });

  // Post-extraction CP conflict check
  const extractedCorpus = [
    extracted.detectedHandleOrCaption ?? "",
    ...(extracted.extractionNotes ?? []),
  ].join(" ");
  try {
    assertNoCpConflict(project.codeProjet, null, extractedCorpus);
  } catch (err) {
    if (err instanceof CpConflictError) {
      await prisma.auditLog.create({
        data: {
          projectId,
          actor: "system:cp-guard",
          action: "CP_CONFLICT_BLOCKED",
          targetType: "INFLUENCE_SCREENSHOT",
          targetId: filename,
          detailsJson: JSON.stringify(err.result),
        },
      });
    }
    throw err;
  }

  if (!driveFileId) {
    const targetFolderId = await resolveInfluenceTargetFolderId(
      prisma,
      gateway.drive,
      projectId,
      talentName,
      platform
    );
    if (targetFolderId) {
      const uploaded = await gateway.drive.createFile({
        name: filename,
        parentId: targetFolderId,
        mimeType: detectedMime!,
        body: imageBuffer,
      });
      driveFileId = uploaded.id;
    }
  }

  const rawFile = await prisma.reportingRawFile.create({
    data: {
      projectId,
      sourceType: "INFLUENCE_SCREENSHOT",
      talentName,
      platform,
      driveFileId,
      processed: true,
    },
  });

  const localPreviewPath = await saveLocalReportingPreview({
    projectId,
    rawFileId: rawFile.id,
    mimeType: detectedMime!,
    buffer: imageBuffer,
  });

  const updatedRawFile = await prisma.reportingRawFile.update({
    where: { id: rawFile.id },
    data: { localPreviewPath },
  });

  const views = normalizeOptionalInt(extracted.views);
  const likes = normalizeOptionalInt(extracted.likes);
  const comments = normalizeOptionalInt(extracted.comments);
  const shares = normalizeOptionalInt(extracted.shares);
  const reposts = normalizeOptionalInt(extracted.reposts);
  const saves = normalizeOptionalInt(extracted.saves);
  const engagementRate = computeEngagementRate({
    views,
    likes,
    comments,
    shares,
    reposts,
    saves,
  });

  let parsedPublishedAt: Date | null = null;
  if (input.publishedAt) {
    const dt = new Date(input.publishedAt);
    if (!Number.isNaN(dt.getTime())) parsedPublishedAt = dt;
  }

  const metric = await prisma.influenceMetric.create({
    data: {
      projectId,
      rawFileId: updatedRawFile.id,
      talentName,
      platform,
      contentUrl: input.contentUrl?.trim() || null,
      sparkCode: input.sparkCode?.trim() || null,
      publishedAt: parsedPublishedAt,
      views,
      likes,
      comments,
      shares,
      reposts,
      saves,
      engagementRate,
      confidenceJson: JSON.stringify(extracted.fieldConfidence ?? {}),
      verifiedByHuman: false,
    },
  });

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "INFLUENCE_SCREENSHOT_EXTRACTED",
      targetType: "INFLUENCE_METRIC",
      targetId: metric.id,
      detailsJson: JSON.stringify({
        talentName,
        platform,
        rawFileId: updatedRawFile.id,
        driveFileId,
        views,
        likes,
        engagementRate,
      }),
    },
  });

  return { metric, rawFile: updatedRawFile };
}

export interface VerifyInfluencePatch {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  reposts?: number | null;
  saves?: number | null;
  contentUrl?: string | null;
  sparkCode?: string | null;
  verifiedByHuman?: boolean;
}

function assertNonNegativeOptionalInt(
  value: number | null | undefined,
  fieldName: string
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new AppHttpError(
      400,
      "NEGATIVE_INFLUENCE_METRIC",
      `La métrique "${fieldName}" doit être un entier positif ou nul.`
    );
  }
  return Math.round(value);
}

export async function verifyInfluenceMetric(
  prisma: PrismaClient,
  projectId: string,
  metricId: string,
  patch: VerifyInfluencePatch
): Promise<InfluenceMetric> {
  const existing = await prisma.influenceMetric.findUnique({
    where: { id: metricId },
  });
  if (!existing || existing.projectId !== projectId) {
    throw new AppHttpError(
      404,
      "INFLUENCE_METRIC_NOT_FOUND",
      "Métrique Influence introuvable pour ce projet."
    );
  }

  const views = assertNonNegativeOptionalInt(patch.views, "views");
  const likes = assertNonNegativeOptionalInt(patch.likes, "likes");
  const comments = assertNonNegativeOptionalInt(patch.comments, "comments");
  const shares = assertNonNegativeOptionalInt(patch.shares, "shares");
  const reposts = assertNonNegativeOptionalInt(patch.reposts, "reposts");
  const saves = assertNonNegativeOptionalInt(patch.saves, "saves");

  const nextViews = views !== undefined ? views : existing.views;
  const nextLikes = likes !== undefined ? likes : existing.likes;
  const nextComments = comments !== undefined ? comments : existing.comments;
  const nextShares = shares !== undefined ? shares : existing.shares;
  const nextReposts = reposts !== undefined ? reposts : existing.reposts;
  const nextSaves = saves !== undefined ? saves : existing.saves;

  const engagementRate = computeEngagementRate({
    views: nextViews,
    likes: nextLikes,
    comments: nextComments,
    shares: nextShares,
    reposts: nextReposts,
    saves: nextSaves,
  });

  const updated = await prisma.influenceMetric.update({
    where: { id: existing.id },
    data: {
      views: nextViews,
      likes: nextLikes,
      comments: nextComments,
      shares: nextShares,
      reposts: nextReposts,
      saves: nextSaves,
      ...(patch.contentUrl !== undefined
        ? { contentUrl: patch.contentUrl?.trim() || null }
        : {}),
      ...(patch.sparkCode !== undefined
        ? { sparkCode: patch.sparkCode?.trim() || null }
        : {}),
      engagementRate,
      verifiedByHuman: patch.verifiedByHuman ?? true,
    },
  });

  await prisma.auditLog.create({
    data: {
      projectId,
      actor: "user",
      action: "INFLUENCE_METRIC_VERIFIED",
      targetType: "INFLUENCE_METRIC",
      targetId: updated.id,
      detailsJson: JSON.stringify({
        talentName: updated.talentName,
        platform: updated.platform,
        views: updated.views,
        likes: updated.likes,
        engagementRate: updated.engagementRate,
        verifiedByHuman: updated.verifiedByHuman,
      }),
    },
  });

  return updated;
}
