import type { DriveNode, PrismaClient, RetroTask, WeeklyReport } from "@prisma/client";
import { getSyncPolicy } from "@/lib/drive/sync-policy";
import { PILOT_SANDBOX_CONFIG } from "@/lib/drive/tree-service";
import { AppHttpError } from "@/lib/errors";
import type { GoogleWorkspacePort } from "@/lib/ports";
import {
  addUtcDays,
  parseStrictCalendarDate,
  toIsoDateOnly,
} from "@/lib/retroplanning/validation";
import {
  collectWeeklyTasks,
  collectWeeklyVisuals,
  isEligibleVisualNode,
} from "@/lib/weeklys/weekly-collector";

export const PROD_WEEKLY_SLIDES_TEMPLATE_ID =
  PILOT_SANDBOX_CONFIG.prodTemplates.weeklyTemplateSlidesId;

export interface GenerateWeeklyInput {
  weekStart?: string;
  weekEnd?: string;
  nextStepsClient?: string[];
  nextStepsGo?: string[];
  visualDriveIds?: string[];
  recipientEmail?: string;
}

export interface WeeklyPreviewData {
  weekStart: string;
  weekEnd: string;
  tasks: RetroTask[];
  availableVisuals: DriveNode[];
  suggestedNextStepsClient: string[];
  suggestedNextStepsGo: string[];
  krispMeetingsCount?: number;
  krispHighlights?: string[];
  previousWeeklyTitle?: string | null;
}

function resolveWeekWindow(
  weekStartRaw?: string,
  weekEndRaw?: string
): { weekStart: Date; weekEnd: Date; weekStartIso: string; weekEndIso: string } {
  const todayIso = new Date().toISOString().slice(0, 10);
  const endDate =
    weekEndRaw !== undefined && weekEndRaw.trim() !== ""
      ? parseStrictCalendarDate(weekEndRaw)
      : parseStrictCalendarDate(todayIso);

  if (!endDate) {
    throw new AppHttpError(
      400,
      "INVALID_WEEK_END",
      `Date weekEnd invalide : "${weekEndRaw}".`
    );
  }

  const startDate =
    weekStartRaw !== undefined && weekStartRaw.trim() !== ""
      ? parseStrictCalendarDate(weekStartRaw)
      : addUtcDays(endDate, -7);

  if (!startDate) {
    throw new AppHttpError(
      400,
      "INVALID_WEEK_START",
      `Date weekStart invalide : "${weekStartRaw}".`
    );
  }

  if (endDate.getTime() < startDate.getTime()) {
    throw new AppHttpError(
      400,
      "INVALID_WEEK_WINDOW",
      "La date weekEnd doit être postérieure ou égale à weekStart."
    );
  }

  return {
    weekStart: startDate,
    weekEnd: endDate,
    weekStartIso: toIsoDateOnly(startDate)!,
    weekEndIso: toIsoDateOnly(endDate)!,
  };
}

export async function getWeeklyPreview(
  prisma: PrismaClient,
  projectId: string,
  weekStartRaw?: string,
  weekEndRaw?: string
): Promise<WeeklyPreviewData> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const { weekStart, weekEnd, weekStartIso, weekEndIso } = resolveWeekWindow(
    weekStartRaw,
    weekEndRaw
  );

  const [tasks, prodNodes, weekMeetings, lastWeekly] = await Promise.all([
    collectWeeklyTasks(prisma, projectId, weekStart, weekEnd),
    prisma.driveNode.findMany({
      where: {
        projectId,
        code: { startsWith: "004." },
        isFolder: false,
        driveFileId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.meetingNote.findMany({
      where: {
        projectId,
        meetingDate: {
          gte: addUtcDays(weekStart, -2),
          lte: addUtcDays(weekEnd, 2),
        },
      },
      orderBy: { meetingDate: "desc" },
      take: 5,
    }),
    prisma.weeklyReport.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { title: true },
    }),
  ]);

  const availableVisuals = prodNodes.filter((n) => isEligibleVisualNode(n));

  const clientSet = new Set<string>(
    tasks
      .filter((t) => t.status === "EN_ATTENTE_CLIENT")
      .map((t) => `Valider : ${t.tache}`)
  );
  const agencySet = new Set<string>(
    tasks
      .filter((t) => t.status === "EN_COURS" || t.status === "A_FAIRE")
      .slice(0, 5)
      .map((t) => `Finaliser : ${t.tache}`)
  );
  const krispHighlights: string[] = [];

  for (const m of weekMeetings) {
    try {
      const decisions = JSON.parse(m.keyDecisionsJson);
      if (Array.isArray(decisions)) {
        for (const d of decisions.slice(0, 3)) {
          if (typeof d === "string" && d.trim()) {
            krispHighlights.push(`${m.title} : ${d.trim()}`);
          }
        }
      }
    } catch {
      // ignore malformed json
    }
    try {
      const actions = JSON.parse(m.actionItemsJson) as Array<{
        text?: string;
        owner?: string | null;
      }>;
      if (Array.isArray(actions)) {
        for (const a of actions) {
          const text = a?.text?.trim();
          if (!text) continue;
          const isClient = (a.owner ?? "").toLowerCase().includes("client");
          if (isClient) clientSet.add(text);
          else agencySet.add(text);
        }
      }
    } catch {
      // ignore malformed json
    }
  }

  return {
    weekStart: weekStartIso,
    weekEnd: weekEndIso,
    tasks,
    availableVisuals,
    suggestedNextStepsClient: Array.from(clientSet).slice(0, 6),
    suggestedNextStepsGo: Array.from(agencySet).slice(0, 6),
    krispMeetingsCount: weekMeetings.length,
    krispHighlights: krispHighlights.slice(0, 5),
    previousWeeklyTitle: lastWeekly?.title ?? null,
  };
}

function buildNextStepsColumnRequests(
  presentation: Record<string, unknown>,
  clientLabel: string,
  nextStepsClient: string[],
  nextStepsGo: string[]
): {
  requests: Record<string, unknown>[];
  tableUpdate: {
    tableObjectId: string;
    updates: Array<{ rowIndex: number; columnIndex: number; text: string }>;
  } | null;
} {
  const slides = Array.isArray(presentation.slides)
    ? (presentation.slides as Array<{
        objectId?: string;
        pageElements?: Array<{
          objectId?: string;
          table?: unknown;
          shape?: {
            text?: {
              textElements?: Array<{ textRun?: { content?: string } }>;
            };
          };
        }>;
      }>)
    : [];

  const clientBody =
    nextStepsClient.length > 0
      ? nextStepsClient.map((s) => `• ${s}`).join("\n")
      : "• Aucune action client en attente cette semaine.";
  const goBody =
    nextStepsGo.length > 0
      ? nextStepsGo.map((s) => `• ${s}`).join("\n")
      : "• Poursuite du planning de production.";

  // Check if a slide has a table on a "Prochaines étapes" slide
  for (const slide of slides) {
    const texts = (slide.pageElements ?? [])
      .flatMap((el) =>
        (el.shape?.text?.textElements ?? []).map(
          (te) => te.textRun?.content ?? ""
        )
      )
      .join(" ");
    if (/prochaines\s*[ée]tapes/i.test(texts)) {
      const tableEl = (slide.pageElements ?? []).find((el) => Boolean(el.table));
      if (tableEl?.objectId) {
        return {
          requests: [],
          tableUpdate: {
            tableObjectId: tableEl.objectId,
            updates: [
              { rowIndex: 0, columnIndex: 0, text: `Côté Client (${clientLabel})` },
              { rowIndex: 0, columnIndex: 1, text: "Côté Agence" },
              { rowIndex: 1, columnIndex: 0, text: clientBody },
              { rowIndex: 1, columnIndex: 1, text: goBody },
            ],
          },
        };
      }
    }
  }

  // Handle PROD Slide 32 (g3faa55c2181_35_5) replacing single stacked textbox g3faa55c2181_35_7 with 2 side-by-side columns
  const prodSlide = slides.find((s) => s.objectId === "g3faa55c2181_35_5");
  const hasProdStackedBox = prodSlide?.pageElements?.some(
    (el) => el.objectId === "g3faa55c2181_35_7"
  );

  if (prodSlide?.objectId && hasProdStackedBox) {
    const leftId = `go_weekly_client_col_${Date.now()}`;
    const rightId = `go_weekly_go_col_${Date.now()}`;
    const leftText = `Côté Client — ${clientLabel}\n\n${clientBody}`;
    const rightText = `Côté Agence\n\n${goBody}`;

    const requests: Record<string, unknown>[] = [
      { deleteObject: { objectId: "g3faa55c2181_35_7" } },
      {
        createShape: {
          objectId: leftId,
          shapeType: "TEXT_BOX",
          elementProperties: {
            pageObjectId: prodSlide.objectId,
            size: {
              width: { magnitude: 3800000, unit: "EMU" },
              height: { magnitude: 2800000, unit: "EMU" },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: 550000,
              translateY: 1300000,
              unit: "EMU",
            },
          },
        },
      },
      { insertText: { objectId: leftId, text: leftText, insertionIndex: 0 } },
      {
        updateTextStyle: {
          objectId: leftId,
          style: {
            fontFamily: "Roboto",
            fontSize: { magnitude: 12, unit: "PT" },
            foregroundColor: { opaqueColor: { themeColor: "LIGHT1" } },
          },
          textRange: { type: "ALL" },
          fields: "fontFamily,fontSize,foregroundColor",
        },
      },
      {
        createShape: {
          objectId: rightId,
          shapeType: "TEXT_BOX",
          elementProperties: {
            pageObjectId: prodSlide.objectId,
            size: {
              width: { magnitude: 3800000, unit: "EMU" },
              height: { magnitude: 2800000, unit: "EMU" },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: 4750000,
              translateY: 1300000,
              unit: "EMU",
            },
          },
        },
      },
      { insertText: { objectId: rightId, text: rightText, insertionIndex: 0 } },
      {
        updateTextStyle: {
          objectId: rightId,
          style: {
            fontFamily: "Roboto",
            fontSize: { magnitude: 12, unit: "PT" },
            foregroundColor: { opaqueColor: { themeColor: "LIGHT1" } },
          },
          textRange: { type: "ALL" },
          fields: "fontFamily,fontSize,foregroundColor",
        },
      },
    ];

    return { requests, tableUpdate: null };
  }

  return { requests: [], tableUpdate: null };
}

export async function generateWeeklyReport(
  prisma: PrismaClient,
  projectId: string,
  resolveGateway: () => Promise<GoogleWorkspacePort>,
  input: GenerateWeeklyInput = {},
  actor = "user"
): Promise<{
  weekly: WeeklyReport;
  warnings: string[];
}> {
  // 1. Validate dates strictly BEFORE any Google calls
  const { weekStart, weekEnd, weekStartIso, weekEndIso } = resolveWeekWindow(
    input.weekStart,
    input.weekEnd
  );

  // 2. Check project exists
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  // 3. Resolve Google Gateway BEFORE mutating DB/Drive (412 if unconfigured)
  const gateway = await resolveGateway();

  // 4. Collect J-7 -> J tasks and 004. visuals (rejects foreign visuals with 403)
  const [collectedTasks, selectedVisuals] = await Promise.all([
    collectWeeklyTasks(prisma, projectId, weekStart, weekEnd),
    collectWeeklyVisuals(prisma, projectId, input.visualDriveIds),
  ]);

  // 5. Find 003.2 Weeklys Clients folder
  const folder0032 = await prisma.driveNode.findFirst({
    where: { projectId, code: "003.2", isFolder: true },
  });
  if (!folder0032?.driveFileId) {
    throw new AppHttpError(
      400,
      "DRIVE_003_2_MISSING",
      "Dossier 003.2 Weeklys Clients introuvable. Provisionnez l'arborescence Drive d'abord."
    );
  }

  const nextStepsClient = (input.nextStepsClient ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const nextStepsGo = (input.nextStepsGo ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

  const title = `${weekEndIso} - Weekly ${project.client}`;
  const templateId =
    project.weeklyTemplateSlidesId ?? PROD_WEEKLY_SLIDES_TEMPLATE_ID;

  // 6. Copy Weekly template into sandbox 003.2
  const copiedDeck = await gateway.drive.copyFile({
    sourceFileId: templateId,
    destinationParentId: folder0032.driveFileId,
    name: title,
  });

  // 7. Populate Slides deck
  const warnings: string[] = [];
  const presentation = await gateway.slides
    .getPresentation(copiedDeck.id)
    .catch(() => ({ slides: [] }));

  const doneCount = collectedTasks.filter((t) => t.status === "TERMINE").length;
  const inProgressCount = collectedTasks.filter((t) => t.status === "EN_COURS").length;
  const waitingCount = collectedTasks.filter(
    (t) => t.status === "EN_ATTENTE_CLIENT"
  ).length;

  const synthesisText =
    collectedTasks.length > 0
      ? `Période ${weekStartIso} → ${weekEndIso} : ${collectedTasks.length} tâche(s) (${doneCount} terminée(s), ${inProgressCount} en cours, ${waitingCount} en attente client).`
      : `Période ${weekStartIso} → ${weekEndIso} : suivi hebdomadaire ${project.client} - ${project.nomJeu}.`;

  await gateway.slides.replaceAllText({
    presentationId: copiedDeck.id,
    replacements: [
      { token: "{{CLIENT}}", value: project.client },
      { token: "{{NOM_JEU}}", value: project.nomJeu },
      { token: "{{DATE_WEEKLY}}", value: weekEndIso },
      { token: "{{PERIODE}}", value: `${weekStartIso} → ${weekEndIso}` },
      { token: "{{SYNTHESE}}", value: synthesisText },
      { token: "by Caisse d’Epargne", value: `by ${project.client}` },
      {
        token: "{{NEXT_STEPS_CLIENT}}",
        value:
          nextStepsClient.length > 0
            ? nextStepsClient.map((s) => `• ${s}`).join("\n")
            : "• RAS",
      },
      {
        token: "{{NEXT_STEPS_GO}}",
        value:
          nextStepsGo.length > 0
            ? nextStepsGo.map((s) => `• ${s}`).join("\n")
            : "• RAS",
      },
    ],
  });

  // 2-column Prochaines étapes (Côté Client vs Côté GO)
  const nextStepsOps = buildNextStepsColumnRequests(
    presentation,
    project.client,
    nextStepsClient,
    nextStepsGo
  );
  if (nextStepsOps.tableUpdate) {
    await gateway.slides.updateTableCells({
      presentationId: copiedDeck.id,
      tableObjectId: nextStepsOps.tableUpdate.tableObjectId,
      updates: nextStepsOps.tableUpdate.updates,
    });
  } else if (nextStepsOps.requests.length > 0) {
    await gateway.slides.batchUpdate({
      presentationId: copiedDeck.id,
      requests: nextStepsOps.requests,
    });
  }

  // Insert latest PNG/JPG visuals from 004. Production
  for (let i = 0; i < Math.min(selectedVisuals.length, 3); i++) {
    const visual = selectedVisuals[i];
    if (!visual.driveFileId) continue;
    const imgRes = await gateway.slides.replaceShapesWithDriveImage({
      presentationId: copiedDeck.id,
      containsText: `{{VISUAL_${i + 1}}}`,
      driveFileId: visual.driveFileId,
      replaceMethod: "CENTER_INSIDE",
    });
    if (!imgRes.applied && imgRes.warning) {
      warnings.push(`${visual.name}: ${imgRes.warning}`);
    }
  }

  // 8. Create Gmail Draft ONLY BEFORE persisting DB rows (so Gmail failure leaves zero orphan DB rows)
  const taskBulletLines =
    collectedTasks.length > 0
      ? collectedTasks
          .map(
            (t) =>
              `- [${t.status}] ${t.tache} (${toIsoDateOnly(t.startDate) ?? "?"} → ${toIsoDateOnly(t.endDate) ?? "?"})`
          )
          .join("\n")
      : "- Aucune tâche planifiée sur la période.";

  const clientBullets =
    nextStepsClient.length > 0
      ? nextStepsClient.map((s) => `- ${s}`).join("\n")
      : "- Aucune action requise cette semaine.";
  const goBullets =
    nextStepsGo.length > 0
      ? nextStepsGo.map((s) => `- ${s}`).join("\n")
      : "- Suivi de production continu.";

  const slidesLink =
    copiedDeck.webViewLink ??
    `https://docs.google.com/presentation/d/${copiedDeck.id}/edit`;

  const draftSubject = `[CP ${project.codeProjet}] ${title} — ${project.nomJeu}`;
  const draftTextBody = [
    `Bonjour,`,
    ``,
    `Veuillez trouver ci-dessous le récapitulatif Weekly (${weekStartIso} → ${weekEndIso}) pour ${project.client} - ${project.nomJeu} :`,
    ``,
    `1. Avancement J-7 → J :`,
    taskBulletLines,
    ``,
    `2. Prochaines étapes — Côté Client :`,
    clientBullets,
    ``,
    `3. Prochaines étapes — Côté Agence :`,
    goBullets,
    ``,
    `Support interne (Brouillon 003.2) : ${slidesLink}`,
    ``,
    `Bien cordialement,`,
    `L'équipe projet`,
  ].join("\n");

  const draftRes = await gateway.gmail.createDraft({
    to: input.recipientEmail?.trim() || "",
    subject: draftSubject,
    textBody: draftTextBody,
  });

  // 9. Persist WeeklyReport, 003.2 DriveNode, SyncStatus, and AuditLog atomically
  const policy0032 = getSyncPolicy("003.2");
  const finalizedWeekly = await prisma.$transaction(async (tx) => {
    const weekly = await tx.weeklyReport.create({
      data: {
        projectId,
        weekStart,
        weekEnd,
        title,
        slidesFileId: copiedDeck.id,
        gmailDraftId: draftRes.draftId,
        collectedTasksJson: JSON.stringify(
          collectedTasks.map((t) => ({
            id: t.id,
            phase: t.phase,
            etape: t.etape,
            tache: t.tache,
            status: t.status,
            startDate: toIsoDateOnly(t.startDate),
            endDate: toIsoDateOnly(t.endDate),
          }))
        ),
        visualsDriveIdsJson: JSON.stringify(selectedVisuals.map((v) => v.id)),
        nextStepsClientJson: JSON.stringify(nextStepsClient),
        nextStepsGoJson: JSON.stringify(nextStepsGo),
        status: "DRAFT",
      },
    });

    const weeklyDriveNode = await tx.driveNode.create({
      data: {
        projectId,
        code: `003.2.weekly.${weekly.id}`,
        name: title,
        driveFileId: copiedDeck.id,
        parentNodeId: folder0032.id,
        isFolder: false,
        mimeType: "application/vnd.google-apps.presentation",
        isExtEligible: policy0032.isExtEligible,
        extMirrorFileId: null,
      },
    });

    await tx.syncStatus.create({
      data: {
        projectId,
        driveNodeId: weeklyDriveNode.id,
        validationStatus: "BROUILLON_INTERNE",
        driftDetected: false,
        allowPermanentExtSync: policy0032.allowPermanentExtSync,
      },
    });

    await tx.auditLog.create({
      data: {
        projectId,
        actor,
        action: "WEEKLY_REPORT_GENERATED",
        targetType: "WEEKLY_REPORT",
        targetId: weekly.id,
        detailsJson: JSON.stringify({
          title,
          slidesFileId: copiedDeck.id,
          gmailDraftId: draftRes.draftId,
          tasksCount: collectedTasks.length,
          visualsCount: selectedVisuals.length,
          warnings,
        }),
      },
    });

    return weekly;
  });

  return {
    weekly: finalizedWeekly,
    warnings,
  };
}
