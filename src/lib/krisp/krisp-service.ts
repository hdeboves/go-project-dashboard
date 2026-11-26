import crypto from "node:crypto";
import type { PrismaClient, Project } from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getGoogleGateway } from "@/lib/container";
import { AppHttpError } from "@/lib/errors";
import { extractCodeProjets, normalizeCp } from "@/lib/isolation/cp-guard";
import type { DrivePort } from "@/lib/ports";

export const KRISP_SECRET_SETTING_KEY = "KRISP_WEBHOOK_SECRET";

export interface KrispActionItem {
  text: string;
  owner?: string | null;
  dueDate?: string | null;
}

export interface KrispIngestInput {
  projectId?: string | null;
  projectCode?: string | null;
  externalId?: string | null;
  source?: "KRISP_WEBHOOK" | "KRISP_IMPORT" | "MANUAL";
  title: string;
  meetingDate?: string | Date | null;
  durationMinutes?: number | null;
  participants?: string[];
  summary: string;
  keyDecisions?: string[];
  actionItems?: Array<string | KrispActionItem>;
  rawTranscript?: string | null;
}

export interface IngestedMeetingResult {
  meeting: {
    id: string;
    projectId: string;
    source: string;
    title: string;
    meetingDate: string;
    durationMinutes: number | null;
    participants: string[];
    summary: string;
    keyDecisions: string[];
    actionItems: KrispActionItem[];
    rawTranscript: string | null;
    driveFileId: string | null;
    driveFileName: string | null;
    driveWebViewLink: string | null;
    driveFolderCode: string;
    status: string;
    createdAt: string;
  };
  notificationId: string;
  savedToDrive: boolean;
  driveWarning?: string | null;
}

export async function getOrCreateKrispWebhookSecret(
  prisma: PrismaClient
): Promise<string> {
  const existing = await prisma.appSetting.findUnique({
    where: { key: KRISP_SECRET_SETTING_KEY },
  });
  if (existing?.valueEnc) {
    try {
      const decrypted = decryptSecret(existing.valueEnc).trim();
      if (decrypted.length >= 16) return decrypted;
    } catch {
      // regenerate below if corrupted
    }
  }

  const secret = `go_krisp_${crypto.randomBytes(20).toString("hex")}`;
  await prisma.appSetting.upsert({
    where: { key: KRISP_SECRET_SETTING_KEY },
    update: { valueEnc: encryptSecret(secret), isSecret: true },
    create: {
      key: KRISP_SECRET_SETTING_KEY,
      valueEnc: encryptSecret(secret),
      isSecret: true,
    },
  });
  return secret;
}

export async function rotateKrispWebhookSecret(
  prisma: PrismaClient
): Promise<string> {
  const secret = `go_krisp_${crypto.randomBytes(20).toString("hex")}`;
  await prisma.appSetting.upsert({
    where: { key: KRISP_SECRET_SETTING_KEY },
    update: { valueEnc: encryptSecret(secret), isSecret: true },
    create: {
      key: KRISP_SECRET_SETTING_KEY,
      valueEnc: encryptSecret(secret),
      isSecret: true,
    },
  });
  return secret;
}

export function normalizeActionItems(
  items?: Array<string | KrispActionItem>
): KrispActionItem[] {
  if (!items || items.length === 0) return [];
  return items
    .map((item): KrispActionItem | null => {
      if (typeof item === "string") {
        const cleaned = item.trim();
        return cleaned ? { text: cleaned, owner: null, dueDate: null } : null;
      }
      const cleaned = item.text?.trim();
      if (!cleaned) return null;
      return {
        text: cleaned,
        owner: item.owner?.trim() || null,
        dueDate: item.dueDate?.trim() || null,
      };
    })
    .filter((v): v is KrispActionItem => v !== null);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeFileName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 65);
}

export function formatKrispMeetingHtml(params: {
  project: Pick<Project, "codeProjet" | "client" | "nomJeu">;
  title: string;
  meetingDate: Date;
  durationMinutes: number | null;
  participants: string[];
  summary: string;
  keyDecisions: string[];
  actionItems: KrispActionItem[];
  rawTranscript: string | null;
}): string {
  const dateLabel = params.meetingDate.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const durationLabel = params.durationMinutes
    ? `${params.durationMinutes} min`
    : "Non précisée";

  const decisionsHtml =
    params.keyDecisions.length > 0
      ? `<ul>${params.keyDecisions.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>`
      : "<p><em>Aucune décision spécifique enregistrée.</em></p>";

  const actionsHtml =
    params.actionItems.length > 0
      ? `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th align="left">Action à mener</th>
              <th align="left">Responsable</th>
              <th align="left">Échéance</th>
            </tr>
          </thead>
          <tbody>
            ${params.actionItems
              .map(
                (a) => `<tr>
                  <td>${escapeHtml(a.text)}</td>
                  <td>${escapeHtml(a.owner || "À assigner")}</td>
                  <td>${escapeHtml(a.dueDate || "—")}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>`
      : "<p><em>Aucune action extraite.</em></p>";

  const transcriptHtml = params.rawTranscript?.trim()
    ? `<h2>Transcription complète (Krisp)</h2><pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:10pt;color:#334155;">${escapeHtml(params.rawTranscript.trim())}</pre>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /><title>${escapeHtml(params.title)}</title></head>
<body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5;">
  <p style="color:#4f46e5;font-weight:bold;font-size:10pt;text-transform:uppercase;letter-spacing:0.06em;">
    GO L'Intrus · Compte Rendu Krisp · Code projet ${escapeHtml(params.project.codeProjet)}
  </p>
  <h1 style="margin-top:4px;margin-bottom:8px;">${escapeHtml(params.title)}</h1>
  <p style="color:#475569;font-size:10pt;">
    <strong>Projet :</strong> ${escapeHtml(params.project.client)} — ${escapeHtml(params.project.nomJeu)} (CP ${escapeHtml(params.project.codeProjet)})<br/>
    <strong>Date :</strong> ${escapeHtml(dateLabel)} · <strong>Durée :</strong> ${escapeHtml(durationLabel)}<br/>
    <strong>Participants :</strong> ${escapeHtml(params.participants.length > 0 ? params.participants.join(", ") : "Non renseignés")}
  </p>
  <hr />
  <h2>Résumé exécutif</h2>
  <p>${escapeHtml(params.summary).replace(/\n/g, "<br/>")}</p>
  <h2>Décisions clés</h2>
  ${decisionsHtml}
  <h2>Prochaines actions</h2>
  ${actionsHtml}
  ${transcriptHtml}
</body>
</html>`;
}

export async function resolveTargetProject(
  prisma: PrismaClient,
  input: Pick<KrispIngestInput, "projectId" | "projectCode" | "title" | "summary">
): Promise<Project> {
  if (input.projectId) {
    const byId = await prisma.project.findUnique({
      where: { id: input.projectId },
    });
    if (!byId) {
      throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
    }
    return byId;
  }

  const allProjects = await prisma.project.findMany({
    where: { isArchived: false },
    orderBy: [{ isSandbox: "desc" }, { createdAt: "asc" }],
  });
  if (allProjects.length === 0) {
    throw new AppHttpError(
      404,
      "NO_PROJECT_AVAILABLE",
      "Aucun projet actif configuré pour recevoir ce compte rendu."
    );
  }

  // 1. Explicit projectCode
  if (input.projectCode) {
    const norm = normalizeCp(input.projectCode) ?? input.projectCode.trim();
    const match = allProjects.find((p) => p.codeProjet === norm);
    if (match) return match;
  }

  // 2. CP code detected inside title or summary
  const detectedCps = extractCodeProjets(`${input.title} ${input.summary}`);
  for (const cp of detectedCps) {
    const match = allProjects.find((p) => p.codeProjet === cp);
    if (match) return match;
  }

  // 3. Client or game name mentioned in title
  const haystack = `${input.title} ${input.summary}`.toLowerCase();
  const byName = allProjects.find(
    (p) =>
      haystack.includes(p.client.toLowerCase()) ||
      haystack.includes(p.nomJeu.toLowerCase())
  );
  if (byName) return byName;

  // 4. Only fallback if there is a single active project; otherwise avoid silent cross-project pollution
  if (allProjects.length === 1) {
    return allProjects[0];
  }

  throw new AppHttpError(
    422,
    "PROJECT_AMBIGUOUS",
    "Impossible d'identifier le projet cible pour ce CR Krisp. Mentionnez le code projet ou le nom du client dans le titre."
  );
}

export async function ingestKrispMeeting(
  prisma: PrismaClient,
  input: KrispIngestInput,
  options?: { drivePort?: DrivePort | null }
): Promise<IngestedMeetingResult> {
  const project = await resolveTargetProject(prisma, input);

  // Deduplicate webhook retries when externalId is provided
  if (input.externalId?.trim()) {
    const existing = await prisma.meetingNote.findFirst({
      where: {
        projectId: project.id,
        externalId: input.externalId.trim(),
      },
    });
    if (existing) {
      const existingNotif = await prisma.notification.findFirst({
        where: { projectId: project.id, type: "KRISP_CR" },
        orderBy: { createdAt: "desc" },
      });
      return {
        meeting: serializeMeetingNote(existing),
        notificationId: existingNotif?.id ?? "",
        savedToDrive: existing.status === "SAVED_TO_DRIVE",
        driveWarning: null,
      };
    }
  }

  const meetingDate =
    input.meetingDate instanceof Date
      ? input.meetingDate
      : input.meetingDate && !Number.isNaN(Date.parse(input.meetingDate))
        ? new Date(input.meetingDate)
        : new Date();

  const participants = (input.participants ?? [])
    .map((p) => p.trim())
    .filter(Boolean);
  const keyDecisions = (input.keyDecisions ?? [])
    .map((d) => d.trim())
    .filter(Boolean);
  const actionItems = normalizeActionItems(input.actionItems);

  const datePrefix = meetingDate.toISOString().slice(0, 10);
  const driveFileName = `CR_${datePrefix}_${sanitizeFileName(input.title) || "Reunion"}_CP${project.codeProjet}`;

  // Try saving natively as a Google Doc inside 002.3 Comptes Rendus (sandbox-guarded)
  let driveFileId: string | null = null;
  let driveWebViewLink: string | null = null;
  let status = "LOCAL_ONLY";
  let driveWarning: string | null = null;

  const crFolderNode = await prisma.driveNode.findFirst({
    where: { projectId: project.id, code: "002.3" },
  });
  const targetParentId =
    crFolderNode?.driveFileId || project.driveInternalRootId || null;

  if (targetParentId) {
    try {
      const drive =
        options?.drivePort !== undefined
          ? options.drivePort
          : (await getGoogleGateway()).drive;

      if (drive) {
        const htmlBody = formatKrispMeetingHtml({
          project,
          title: input.title.trim(),
          meetingDate,
          durationMinutes: input.durationMinutes ?? null,
          participants,
          summary: input.summary.trim(),
          keyDecisions,
          actionItems,
          rawTranscript: input.rawTranscript ?? null,
        });

        const uploaded = await drive.createFile({
          name: driveFileName,
          parentId: targetParentId,
          mimeType: "application/vnd.google-apps.document",
          sourceMimeType: "text/html",
          body: htmlBody,
        });

        driveFileId = uploaded.id;
        driveWebViewLink =
          uploaded.webViewLink ??
          `https://docs.google.com/document/d/${uploaded.id}/edit`;
        status = "SAVED_TO_DRIVE";

        // Mark 002.3 as having new content so PM can choose to sync to client [EXT.01]
        if (crFolderNode) {
          await prisma.driveNode.update({
            where: { id: crFolderNode.id },
            data: { internalModifiedAt: new Date() },
          });
        }
      }
    } catch (err) {
      status = "LOCAL_ONLY";
      driveWarning =
        err instanceof Error
          ? err.message
          : "Google Drive non connecté — CR conservé dans le hub.";
    }
  } else {
    driveWarning =
      "Dossier Drive 002.3 non encore initialisé — CR conservé localement dans le hub.";
  }

  const created = await prisma.meetingNote.create({
    data: {
      projectId: project.id,
      source: input.source ?? "KRISP_WEBHOOK",
      externalId: input.externalId?.trim() || null,
      title: input.title.trim(),
      meetingDate,
      durationMinutes: input.durationMinutes ?? null,
      participantsJson: JSON.stringify(participants),
      summary: input.summary.trim(),
      keyDecisionsJson: JSON.stringify(keyDecisions),
      actionItemsJson: JSON.stringify(actionItems),
      rawTranscript: input.rawTranscript?.trim() || null,
      driveFileId,
      driveFileName,
      driveWebViewLink,
      driveFolderCode: "002.3",
      status,
    },
  });

  const notif = await prisma.notification.create({
    data: {
      projectId: project.id,
      type: "KRISP_CR",
      title:
        status === "SAVED_TO_DRIVE"
          ? `Nouveau CR Krisp dans le Drive (${project.client})`
          : `Nouveau CR Krisp reçu (${project.client})`,
      message:
        status === "SAVED_TO_DRIVE"
          ? `« ${created.title} » a été rangé dans 002.3 Comptes Rendus (${actionItems.length} action(s) détectée(s)).`
          : `« ${created.title} » est prêt dans Comptes rendus (${actionItems.length} action(s)).`,
      actionUrl: `/meetings?meetingId=${created.id}`,
      driveUrl: driveWebViewLink,
      read: false,
    },
  });

  await prisma.auditLog.create({
    data: {
      projectId: project.id,
      actor: input.source === "KRISP_WEBHOOK" ? "krisp-webhook" : "user",
      action: "KRISP_MEETING_INGESTED",
      targetType: "MEETING_NOTE",
      targetId: created.id,
      detailsJson: JSON.stringify({
        title: created.title,
        driveFileId,
        driveFolderCode: "002.3",
        status,
        actionItemsCount: actionItems.length,
      }),
    },
  });

  return {
    meeting: {
      id: created.id,
      projectId: created.projectId,
      source: created.source,
      title: created.title,
      meetingDate: created.meetingDate.toISOString(),
      durationMinutes: created.durationMinutes,
      participants,
      summary: created.summary,
      keyDecisions,
      actionItems,
      rawTranscript: created.rawTranscript,
      driveFileId: created.driveFileId,
      driveFileName: created.driveFileName,
      driveWebViewLink: created.driveWebViewLink,
      driveFolderCode: created.driveFolderCode,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    },
    notificationId: notif.id,
    savedToDrive: status === "SAVED_TO_DRIVE",
    driveWarning,
  };
}

export function serializeMeetingNote(row: {
  id: string;
  projectId: string;
  source: string;
  title: string;
  meetingDate: Date;
  durationMinutes: number | null;
  participantsJson: string;
  summary: string;
  keyDecisionsJson: string;
  actionItemsJson: string;
  convertedActionIndexesJson?: string | null;
  rawTranscript: string | null;
  driveFileId: string | null;
  driveFileName: string | null;
  driveWebViewLink: string | null;
  driveFolderCode: string;
  status: string;
  createdAt: Date;
}) {
  const safeParseArray = <T,>(raw: string): T[] => {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  };

  return {
    id: row.id,
    projectId: row.projectId,
    source: row.source,
    title: row.title,
    meetingDate: row.meetingDate.toISOString(),
    durationMinutes: row.durationMinutes,
    participants: safeParseArray<string>(row.participantsJson),
    summary: row.summary,
    keyDecisions: safeParseArray<string>(row.keyDecisionsJson),
    actionItems: safeParseArray<KrispActionItem>(row.actionItemsJson),
    convertedActionIndexes: safeParseArray<number>(
      row.convertedActionIndexesJson ?? "[]"
    ),
    rawTranscript: row.rawTranscript,
    driveFileId: row.driveFileId,
    driveFileName: row.driveFileName,
    driveWebViewLink: row.driveWebViewLink,
    driveFolderCode: row.driveFolderCode,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
