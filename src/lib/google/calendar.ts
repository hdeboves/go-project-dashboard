import { google, type calendar_v3 } from "googleapis";
import { assertCalendarIdAllowed } from "@/lib/google/sandbox-guard";
import type { CalendarEventItem, CalendarPort } from "@/lib/ports";

export class CalendarAdapter implements CalendarPort {
  private readonly api: calendar_v3.Calendar;
  private readonly registeredCalendarIds: Set<string>;

  constructor(params: {
    auth: InstanceType<typeof google.auth.OAuth2>;
    registeredCalendarIds: string[];
    rootUrl?: string;
  }) {
    this.api = google.calendar({
      version: "v3",
      auth: params.auth,
      ...(params.rootUrl ? { rootUrl: params.rootUrl } : {}),
    });
    this.registeredCalendarIds = new Set(
      params.registeredCalendarIds.filter(Boolean)
    );
  }

  async createSecondaryCalendar(params: {
    summary: string;
    description?: string;
    timeZone?: string;
  }): Promise<{ calendarId: string; summary: string }> {
    const summary = params.summary.trim();
    if (!summary) {
      throw new Error("Calendar summary cannot be empty.");
    }
    const res = await this.api.calendars.insert({
      requestBody: {
        summary,
        description: params.description,
        timeZone: params.timeZone ?? "Europe/Paris",
      },
    });
    const calendarId = res.data.id ?? "";
    if (calendarId) {
      this.registeredCalendarIds.add(calendarId);
    }
    return {
      calendarId,
      summary: res.data.summary ?? summary,
    };
  }

  async shareCalendar(params: {
    calendarId: string;
    email: string;
    role?: "reader" | "writer" | "owner";
  }): Promise<{ ruleId: string }> {
    assertCalendarIdAllowed(params.calendarId, this.registeredCalendarIds);
    const res = await this.api.acl.insert({
      calendarId: params.calendarId,
      requestBody: {
        role: params.role ?? "writer",
        scope: {
          type: "user",
          value: params.email,
        },
      },
    });
    return { ruleId: res.data.id ?? "" };
  }

  async listEvents(params: {
    calendarId: string;
    timeMin?: string;
    timeMax?: string;
  }): Promise<CalendarEventItem[]> {
    assertCalendarIdAllowed(params.calendarId, this.registeredCalendarIds);
    const res = await this.api.events.list({
      calendarId: params.calendarId,
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });
    return (res.data.items ?? []).map((ev) => ({
      id: ev.id ?? "",
      summary: ev.summary ?? "",
      description: ev.description ?? undefined,
      start: ev.start
        ? {
            dateTime: ev.start.dateTime ?? undefined,
            date: ev.start.date ?? undefined,
          }
        : undefined,
      end: ev.end
        ? {
            dateTime: ev.end.dateTime ?? undefined,
            date: ev.end.date ?? undefined,
          }
        : undefined,
      status: ev.status ?? undefined,
    }));
  }

  async insertEvent(params: {
    calendarId: string;
    event: {
      summary: string;
      description?: string;
      start: { dateTime?: string; date?: string; timeZone?: string };
      end: { dateTime?: string; date?: string; timeZone?: string };
    };
  }): Promise<{ eventId: string }> {
    assertCalendarIdAllowed(params.calendarId, this.registeredCalendarIds);
    const res = await this.api.events.insert({
      calendarId: params.calendarId,
      requestBody: params.event,
    });
    return { eventId: res.data.id ?? "" };
  }

  async patchEvent(params: {
    calendarId: string;
    eventId: string;
    event: Partial<{
      summary: string;
      description: string;
      start: { dateTime?: string; date?: string; timeZone?: string };
      end: { dateTime?: string; date?: string; timeZone?: string };
    }>;
  }): Promise<{ eventId: string }> {
    assertCalendarIdAllowed(params.calendarId, this.registeredCalendarIds);
    const res = await this.api.events.patch({
      calendarId: params.calendarId,
      eventId: params.eventId,
      requestBody: params.event,
    });
    return { eventId: res.data.id ?? params.eventId };
  }

  async deleteEvent(params: {
    calendarId: string;
    eventId: string;
  }): Promise<void> {
    assertCalendarIdAllowed(params.calendarId, this.registeredCalendarIds);
    await this.api.events.delete({
      calendarId: params.calendarId,
      eventId: params.eventId,
    });
  }
}
