import type { DriveNode, PrismaClient, RetroTask } from "@prisma/client";
import { AppHttpError } from "@/lib/errors";
import { toIsoDateOnly } from "@/lib/retroplanning/validation";

const ALLOWED_VISUAL_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const ALLOWED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
const FORBIDDEN_NON_IMAGE_EXTENSIONS = /\.(pdf|mp4|mov|avi|mkv|xlsx|csv|docx|zip)$/i;

export function isEligibleVisualNode(node: {
  code: string;
  isFolder: boolean;
  driveFileId: string | null;
  mimeType: string | null;
  name: string;
}): boolean {
  if (node.isFolder || !node.driveFileId) return false;
  if (!node.code.startsWith("004.")) return false;
  if (FORBIDDEN_NON_IMAGE_EXTENSIONS.test(node.name)) return false;

  const mime = (node.mimeType ?? "").toLowerCase().trim();
  if (ALLOWED_VISUAL_MIME_TYPES.has(mime)) return true;
  if (!mime && ALLOWED_IMAGE_EXTENSIONS.test(node.name)) return true;
  return false;
}

export async function collectWeeklyTasks(
  prisma: PrismaClient,
  projectId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<RetroTask[]> {
  const winStartIso = toIsoDateOnly(weekStart)!;
  const winEndIso = toIsoDateOnly(weekEnd)!;

  const allTasks = await prisma.retroTask.findMany({
    where: { projectId },
    orderBy: [{ sheetRowIndex: "asc" }, { startDate: "asc" }, { createdAt: "asc" }],
  });

  return allTasks.filter((task) => {
    const startIso = toIsoDateOnly(task.startDate);
    const endIso = toIsoDateOnly(task.endDate);
    if (!startIso && !endIso) return false;

    const effectiveStart = startIso ?? endIso!;
    const effectiveEnd = endIso ?? startIso!;

    return effectiveStart <= winEndIso && effectiveEnd >= winStartIso;
  });
}

export async function collectWeeklyVisuals(
  prisma: PrismaClient,
  projectId: string,
  requestedIds?: string[]
): Promise<DriveNode[]> {
  if (requestedIds && requestedIds.length > 0) {
    const candidates = await prisma.driveNode.findMany({
      where: {
        OR: [
          { id: { in: requestedIds } },
          { driveFileId: { in: requestedIds } },
        ],
      },
    });

    const foreign = candidates.find((c) => c.projectId !== projectId);
    if (foreign) {
      throw new AppHttpError(
        403,
        "FOREIGN_VISUAL_FORBIDDEN",
        "Accès interdit : un visuel demandé appartient à un autre projet."
      );
    }

    return candidates.filter((c) => isEligibleVisualNode(c));
  }

  const allProdNodes = await prisma.driveNode.findMany({
    where: {
      projectId,
      code: { startsWith: "004." },
      isFolder: false,
      driveFileId: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });

  return allProdNodes.filter((n) => isEligibleVisualNode(n)).slice(0, 6);
}
