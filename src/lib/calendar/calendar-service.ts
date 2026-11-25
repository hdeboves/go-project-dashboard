import type { CalendarEvent, CalendarRule, PrismaClient, Project } from "@prisma/client";
import {
  DEFAULT_CASCADE_RULES,
  computeCascadeWindow,
  renderRuleTemplate,
} from "@/lib/calendar/cascade-rules";
import { AppHttpError } from "@/lib/errors";
import {
  SandboxViolationError,
  assertCalendarIdAllowed,
} from "@/lib/google/sandbox-guard";
import type { CalendarPort } from "@/lib/ports";
import {
  MILESTONE_TYPES,
  parseStrictCalendarDate,
  type MilestoneType,
} from "@/lib/retroplanning/validation";

export function buildProjectCalendarSummary(project: {
  codeProjet: string;
  client: string;
  nomJeu: string;
  isSandbox: boolean;
}): string {
  if (project.isSandbox) {
    return `[PILOTE - ${project.codeProjet}] ${project.client} - ${project.nomJeu}`;
  }
  return `[${project.codeProjet}] ${project.client} - ${project.nomJeu}`;
}

export async function ensureDefaultCalendarRules(
  prisma: PrismaClient,
  projectId: string
): Promise<CalendarRule[]> {
  const existing = await prisma.calendarRule.findMany({
    where: { projectId },
    orderBy: [{ milestoneType: "asc" }, { offsetDays: "asc" }],
  });
  if (existing.length > 0) {
    return existing;
  }

  await prisma.calendarRule.createMany({
    data: DEFAULT_CASCADE_RULES.map((rule) => ({
      projectId,
      milestoneType: rule.milestoneType,
      offsetDays: rule.offsetDays,
      titleTemplate: rule.titleTemplate,
      descriptionTemplate: rule.descriptionTemplate,
    })),
  });

  return prisma.calendarRule.findMany({
    where: { projectId },
    orderBy: [{ milestoneType: "asc" }, { offsetDays: "asc" }],
  });
}

export async function getCalendarState(
  prisma: PrismaClient,
  projectId: string
): Promise<{
  projectId: string;
  calendarId: string | null;
  calendarSummary: string;
  rules: CalendarRule[];
  events: CalendarEvent[];
}> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  const [rules, events] = await Promise.all([
    prisma.calendarRule.findMany({
      where: { projectId },
      orderBy: [{ milestoneType: "asc" }, { offsetDays: "asc" }],
    }),
    prisma.calendarEvent.findMany({
      where: { projectId },
      orderBy: { startAt: "asc" },
    }),
  ]);

  return {
    projectId: project.id,
    calendarId: project.calendarId,
    calendarSummary: buildProjectCalendarSummary(project),
    rules,
    events,
  };
}

export async function provisionProjectCalendar(
  prisma: PrismaClient,
  calendarPort: CalendarPort,
  projectId: string,
  opts?: {
    summary?: string;
    description?: string;
    shareWithEmails?: string[];
    role?: "reader" | "writer" | "owner";
    explicitCalendarId?: string;
  }
): Promise<{
  calendarId: string;
  summary: string;
  rules: CalendarRule[];
  sharedRules: Array<{ email: string; ruleId: string }>;
}> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  // Strictly block any attempt to attach 'primary' or an unregistered foreign calendarId
  if (opts?.explicitCalendarId !== undefined) {
    try {
      assertCalendarIdAllowed(
        opts.explicitCalendarId,
        project.calendarId ? [project.calendarId] : []
      );
    } catch (err) {
      if (err instanceof SandboxViolationError) {
        await prisma.auditLog.create({
          data: {
            projectId: project.id,
            actor: "system:sandbox-guard",
            action: "SANDBOX_VIOLATION_BLOCKED",
            targetType: "GOOGLE_CALENDAR",
            targetId: opts.explicitCalendarId,
            detailsJson: JSON.stringify({
              operation: "calendar.attach",
              reason: err.reason,
            }),
          },
        });
      }
      throw err;
    }
  }

  const summary =
    opts?.summary?.trim() || buildProjectCalendarSummary(project);

  let calendarId = project.calendarId;
  let actualSummary = summary;

  if (!calendarId) {
    const created = await calendarPort.createSecondaryCalendar({
      summary,
      description:
        opts?.description ??
        `Agenda projet GamersOrigin — CP ${project.codeProjet} (${project.client} / ${project.nomJeu})`,
      timeZone: "Europe/Paris",
    });

    if (!created.calendarId || created.calendarId.toLowerCase() === "primary") {
      throw new SandboxViolationError({
        operation: "calendar.createSecondaryCalendar",
        targetId: created.calendarId || "(empty)",
        reason: "Le calendrier créé ne peut pas être 'primary'.",
        projectId: project.id,
      });
    }

    calendarId = created.calendarId;
    actualSummary = created.summary || summary;

    await prisma.project.update({
      where: { id: project.id },
      data: { calendarId },
    });

    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: "user",
        action: "CALENDAR_CREATED",
        targetType: "GOOGLE_CALENDAR",
        targetId: calendarId,
        detailsJson: JSON.stringify({
          summary: actualSummary,
          codeProjet: project.codeProjet,
        }),
      },
    });
  }

  const rules = await ensureDefaultCalendarRules(prisma, project.id);

  const sharedRules: Array<{ email: string; ruleId: string }> = [];
  for (const rawEmail of opts?.shareWithEmails ?? []) {
    const email = rawEmail.trim();
    if (!email) continue;
    const res = await calendarPort.shareCalendar({
      calendarId,
      email,
      role: opts?.role ?? "writer",
    });
    sharedRules.push({ email, ruleId: res.ruleId });
  }

  if (sharedRules.length > 0) {
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: "user",
        action: "CALENDAR_SHARED",
        targetType: "GOOGLE_CALENDAR",
        targetId: calendarId,
        detailsJson: JSON.stringify({ sharedRules }),
      },
    });
  }

  return {
    calendarId,
    summary: actualSummary,
    rules,
    sharedRules,
  };
}

export async function upsertCalendarRule(
  prisma: PrismaClient,
  projectId: string,
  input: {
    id?: string;
    milestoneType: MilestoneType;
    offsetDays: number;
    titleTemplate: string;
    descriptionTemplate?: string | null;
  }
): Promise<CalendarRule> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  if (input.id) {
    const existing = await prisma.calendarRule.findUnique({
      where: { id: input.id },
    });
    if (!existing || existing.projectId !== projectId) {
      throw new AppHttpError(
        404,
        "CALENDAR_RULE_NOT_FOUND",
        "Règle Agenda introuvable pour ce projet."
      );
    }
    return prisma.calendarRule.update({
      where: { id: existing.id },
      data: {
        milestoneType: input.milestoneType,
        offsetDays: input.offsetDays,
        titleTemplate: input.titleTemplate.trim(),
        descriptionTemplate: input.descriptionTemplate?.trim() ?? null,
      },
    });
  }

  return prisma.calendarRule.create({
    data: {
      projectId,
      milestoneType: input.milestoneType,
      offsetDays: input.offsetDays,
      titleTemplate: input.titleTemplate.trim(),
      descriptionTemplate: input.descriptionTemplate?.trim() ?? null,
    },
  });
}

export async function deleteCalendarRule(
  prisma: PrismaClient,
  projectId: string,
  ruleId: string
): Promise<void> {
  const existing = await prisma.calendarRule.findUnique({
    where: { id: ruleId },
  });
  if (!existing || existing.projectId !== projectId) {
    throw new AppHttpError(
      404,
      "CALENDAR_RULE_NOT_FOUND",
      "Règle Agenda introuvable pour ce projet."
    );
  }
  await prisma.calendarRule.delete({ where: { id: existing.id } });
}

async function cancelLinkedEventsForTask(
  prisma: PrismaClient,
  calendarPort: CalendarPort,
  calendarId: string,
  projectId: string,
  retroTaskId: string
): Promise<number> {
  const activeEvents = await prisma.calendarEvent.findMany({
    where: {
      projectId,
      retroTaskId,
      status: { not: "CANCELLED" },
    },
  });

  let cancelled = 0;
  for (const ev of activeEvents) {
    if (ev.googleEventId) {
      try {
        await calendarPort.deleteEvent({
          calendarId,
          eventId: ev.googleEventId,
        });
      } catch {
        // Event may already be missing remotely; still cancel locally
      }
    }
    await prisma.calendarEvent.update({
      where: { id: ev.id },
      data: { status: "CANCELLED" },
    });
    cancelled++;
  }
  return cancelled;
}

async function syncSingleMilestoneTask(
  prisma: PrismaClient,
  calendarPort: CalendarPort,
  project: Project,
  calendarId: string,
  rules: CalendarRule[],
  task: {
    id: string;
    tache: string;
    startDate: Date | null;
    endDate: Date | null;
    status: string;
    isMilestone: boolean;
    milestoneType: string | null;
  }
): Promise<{ synced: CalendarEvent[]; cancelledCount: number }> {
  if (!task.isMilestone || task.status === "CANCELLED") {
    const cancelledCount = await cancelLinkedEventsForTask(
      prisma,
      calendarPort,
      calendarId,
      project.id,
      task.id
    );
    return { synced: [], cancelledCount };
  }

  const anchor = task.endDate ?? task.startDate;
  if (!anchor) {
    throw new AppHttpError(
      400,
      "MILESTONE_DATE_MISSING",
      `Le jalon "${task.tache}" ne possède pas de date de référence.`
    );
  }

  const mType = (
    MILESTONE_TYPES.includes(task.milestoneType as MilestoneType)
      ? task.milestoneType
      : "CUSTOM"
  ) as MilestoneType;

  const matchingRules = rules.filter((r) => r.milestoneType === mType);
  const matchingRuleIds = new Set(matchingRules.map((r) => r.id));
  const existingEvents = await prisma.calendarEvent.findMany({
    where: { projectId: project.id, retroTaskId: task.id },
  });

  // Cancel any stale non-CANCELLED events whose rule no longer matches the task's milestoneType
  let cancelledCount = 0;
  for (const existing of existingEvents) {
    if (
      existing.status !== "CANCELLED" &&
      (!existing.calendarRuleId || !matchingRuleIds.has(existing.calendarRuleId))
    ) {
      if (existing.googleEventId) {
        try {
          await calendarPort.deleteEvent({
            calendarId,
            eventId: existing.googleEventId,
          });
        } catch {
          // Event may already be missing remotely; still cancel locally
        }
      }
      await prisma.calendarEvent.update({
        where: { id: existing.id },
        data: { status: "CANCELLED" },
      });
      cancelledCount++;
    }
  }

  const synced: CalendarEvent[] = [];
  const vars = {
    tache: task.tache,
    client: project.client,
    nomJeu: project.nomJeu,
    cp: project.codeProjet,
  };

  for (const rule of matchingRules) {
    const { startAt, endAt } = computeCascadeWindow(anchor, rule.offsetDays);
    const title = renderRuleTemplate(rule.titleTemplate, vars);
    const description = rule.descriptionTemplate
      ? renderRuleTemplate(rule.descriptionTemplate, vars)
      : `[${project.codeProjet}] ${project.client} - ${project.nomJeu}`;

    const existing = existingEvents.find((e) => e.calendarRuleId === rule.id);

    if (
      existing &&
      existing.googleEventId &&
      existing.status !== "CANCELLED"
    ) {
      // In-place reschedule via events.patch preserving googleEventId (zero duplicates)
      const patched = await calendarPort.patchEvent({
        calendarId,
        eventId: existing.googleEventId,
        event: {
          summary: title,
          description,
          start: { dateTime: startAt.toISOString(), timeZone: "Europe/Paris" },
          end: { dateTime: endAt.toISOString(), timeZone: "Europe/Paris" },
        },
      });
      const updated = await prisma.calendarEvent.update({
        where: { id: existing.id },
        data: {
          googleEventId: patched.eventId || existing.googleEventId,
          title,
          startAt,
          endAt,
          status: "SCHEDULED",
        },
      });
      synced.push(updated);
    } else {
      const inserted = await calendarPort.insertEvent({
        calendarId,
        event: {
          summary: title,
          description,
          start: { dateTime: startAt.toISOString(), timeZone: "Europe/Paris" },
          end: { dateTime: endAt.toISOString(), timeZone: "Europe/Paris" },
        },
      });

      const saved = existing
        ? await prisma.calendarEvent.update({
            where: { id: existing.id },
            data: {
              googleEventId: inserted.eventId,
              title,
              startAt,
              endAt,
              status: "SCHEDULED",
            },
          })
        : await prisma.calendarEvent.create({
            data: {
              projectId: project.id,
              retroTaskId: task.id,
              calendarRuleId: rule.id,
              googleEventId: inserted.eventId,
              title,
              startAt,
              endAt,
              status: "SCHEDULED",
            },
          });
      synced.push(saved);
    }
  }

  return { synced, cancelledCount };
}

export async function syncCalendarCascades(
  prisma: PrismaClient,
  calendarPort: CalendarPort,
  projectId: string,
  opts?: {
    retroTaskId?: string;
    milestoneType?: string;
    anchorDate?: string;
  }
): Promise<{
  syncedCount: number;
  cancelledCount: number;
  events: CalendarEvent[];
}> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new AppHttpError(404, "PROJECT_NOT_FOUND", "Projet introuvable.");
  }

  if (!project.calendarId) {
    throw new AppHttpError(
      400,
      "CALENDAR_NOT_INITIALIZED",
      "Aucun calendrier secondaire dédié n'est initialisé pour ce projet."
    );
  }

  assertCalendarIdAllowed(project.calendarId, [project.calendarId]);
  const rules = await ensureDefaultCalendarRules(prisma, project.id);

  // Case 1: Specific retroTaskId
  if (opts?.retroTaskId) {
    const task = await prisma.retroTask.findUnique({
      where: { id: opts.retroTaskId },
    });
    if (!task || task.projectId !== project.id) {
      throw new AppHttpError(
        404,
        "RETRO_TASK_NOT_FOUND",
        "Tâche de rétroplanning introuvable pour ce projet."
      );
    }

    const res = await syncSingleMilestoneTask(
      prisma,
      calendarPort,
      project,
      project.calendarId,
      rules,
      task
    );

    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: "user",
        action: "CALENDAR_CASCADES_SYNCED",
        targetType: "GOOGLE_CALENDAR",
        targetId: project.calendarId,
        detailsJson: JSON.stringify({
          retroTaskId: task.id,
          syncedCount: res.synced.length,
          cancelledCount: res.cancelledCount,
        }),
      },
    });

    const allEvents = await prisma.calendarEvent.findMany({
      where: { projectId: project.id },
      orderBy: { startAt: "asc" },
    });

    return {
      syncedCount: res.synced.length,
      cancelledCount: res.cancelledCount,
      events: allEvents,
    };
  }

  // Case 2: Ad-hoc milestoneType + anchorDate
  if (opts?.milestoneType) {
    if (!MILESTONE_TYPES.includes(opts.milestoneType as MilestoneType)) {
      throw new AppHttpError(
        400,
        "INVALID_MILESTONE_TYPE",
        `Type de jalon invalide : "${opts.milestoneType}".`
      );
    }
    const anchor = parseStrictCalendarDate(opts.anchorDate);
    if (!anchor) {
      throw new AppHttpError(
        400,
        "INVALID_ANCHOR_DATE",
        "anchorDate est requis au format YYYY-MM-DD valide."
      );
    }

    const matchingRules = rules.filter(
      (r) => r.milestoneType === opts.milestoneType
    );
    const created: CalendarEvent[] = [];
    const vars = {
      tache: opts.milestoneType,
      client: project.client,
      nomJeu: project.nomJeu,
      cp: project.codeProjet,
    };

    for (const rule of matchingRules) {
      const { startAt, endAt } = computeCascadeWindow(anchor, rule.offsetDays);
      const title = renderRuleTemplate(rule.titleTemplate, vars);
      const description = rule.descriptionTemplate
        ? renderRuleTemplate(rule.descriptionTemplate, vars)
        : `[${project.codeProjet}] ${project.client} - ${project.nomJeu}`;

      const inserted = await calendarPort.insertEvent({
        calendarId: project.calendarId,
        event: {
          summary: title,
          description,
          start: { dateTime: startAt.toISOString(), timeZone: "Europe/Paris" },
          end: { dateTime: endAt.toISOString(), timeZone: "Europe/Paris" },
        },
      });
      const ev = await prisma.calendarEvent.create({
        data: {
          projectId: project.id,
          retroTaskId: null,
          calendarRuleId: rule.id,
          googleEventId: inserted.eventId,
          title,
          startAt,
          endAt,
          status: "SCHEDULED",
        },
      });
      created.push(ev);
    }

    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: "user",
        action: "CALENDAR_CASCADES_SYNCED",
        targetType: "GOOGLE_CALENDAR",
        targetId: project.calendarId,
        detailsJson: JSON.stringify({
          milestoneType: opts.milestoneType,
          anchorDate: opts.anchorDate,
          syncedCount: created.length,
        }),
      },
    });

    const allEvents = await prisma.calendarEvent.findMany({
      where: { projectId: project.id },
      orderBy: { startAt: "asc" },
    });

    return {
      syncedCount: created.length,
      cancelledCount: 0,
      events: allEvents,
    };
  }

  // Case 3: Bulk sync all milestones (and clean up any unmarked tasks with stale scheduled events)
  const tasks = await prisma.retroTask.findMany({
    where: { projectId: project.id },
  });

  let syncedCount = 0;
  let cancelledCount = 0;

  for (const task of tasks) {
    if (!task.isMilestone) {
      cancelledCount += await cancelLinkedEventsForTask(
        prisma,
        calendarPort,
        project.calendarId,
        project.id,
        task.id
      );
      continue;
    }

    if (!task.endDate && !task.startDate) {
      continue;
    }

    const res = await syncSingleMilestoneTask(
      prisma,
      calendarPort,
      project,
      project.calendarId,
      rules,
      task
    );
    syncedCount += res.synced.length;
    cancelledCount += res.cancelledCount;
  }

  await prisma.auditLog.create({
    data: {
      projectId: project.id,
      actor: "user",
      action: "CALENDAR_CASCADES_SYNCED",
      targetType: "GOOGLE_CALENDAR",
      targetId: project.calendarId,
      detailsJson: JSON.stringify({
        mode: "BULK",
        syncedCount,
        cancelledCount,
      }),
    },
  });

  const allEvents = await prisma.calendarEvent.findMany({
    where: { projectId: project.id },
    orderBy: { startAt: "asc" },
  });

  return { syncedCount, cancelledCount, events: allEvents };
}
