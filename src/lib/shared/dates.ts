/**
 * Europe/Paris calendar-date utilities.
 * Prevents the UTC 12:00 / midnight drift where tasks due "today" falsely flip to "late" at 13:00/14:00 Paris time
 * or where Monday 00:30 Paris produces Sunday -> Thursday in Weeklys.
 */

export const PARIS_TIMEZONE = "Europe/Paris";

/**
 * Returns today's calendar date in Europe/Paris as "YYYY-MM-DD".
 */
export function getParisTodayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Returns the UTC timestamp corresponding to 00:00:00Z of today's Europe/Paris date.
 * Because RetroTask.endDate stores calendar dates at 12:00:00Z (parseStrictCalendarDate),
 * comparing `endDate < startOfParisTodayUtc()` is strictly true ONLY for dates strictly BEFORE today!
 */
export function startOfParisTodayUtc(now: Date = new Date()): Date {
  return new Date(`${getParisTodayIso(now)}T00:00:00.000Z`);
}

/**
 * Checks whether a calendar date (Date or ISO string) is strictly before today in Europe/Paris.
 */
export function isCalendarDateLate(
  value: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!value) return false;
  const iso =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return iso < getParisTodayIso(now);
}

/**
 * Computes the current Monday -> Friday work week window in Europe/Paris ("YYYY-MM-DD").
 */
export function getParisWorkWeekWindow(now: Date = new Date()): {
  weekStart: string;
  weekEnd: string;
} {
  const todayIso = getParisTodayIso(now);
  const [y, m, d] = todayIso.split("-").map(Number);
  const middayUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dow = middayUtc.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(middayUtc);
  monday.setUTCDate(middayUtc.getUTCDate() + diffToMonday);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: friday.toISOString().slice(0, 10),
  };
}
