/**
 * iCalendar (RFC 5545) serialization for exported schedules.
 *
 * Calendar events in the UI live on a dummy week (see generateEventsFromMeetings
 * in app/page.tsx) so react-big-calendar can draw a generic week without caring
 * which term it is. That dummy week must never reach an .ics file — it would
 * place every class in January 2023, which importers accept happily and then
 * file three years in the past. Everything here exists to re-anchor those events
 * onto the section's real meeting dates before serializing.
 */

export type IcsMeeting = {
  startTime?: string | null;
  endTime?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  building?: string | null;
  room?: string | null;
};

export type IcsCourse = {
  crn?: string | null;
  title?: string | null;
  term?: string | null;
  professors?: string[] | null;
};

export type IcsEvent = {
  title: string;
  /** Dummy-week start; only the weekday and wall-clock time are used. */
  start: Date;
  /** Dummy-week end; only the wall-clock time is used. */
  end: Date;
  courseInfo?: IcsCourse | null;
  meetingInfo?: IcsMeeting | null;
};

const ICS_WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** RFC 5545 §3.3.11 — backslash, semicolon, comma and newlines are reserved in TEXT values. */
export function escapeIcsText(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1 — content lines fold at 75 octets, continuations start with a space. */
export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    chunks.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length > 0) chunks.push(" " + rest);
  return chunks.join("\r\n");
}

/** Local wall-clock stamp, no trailing Z — a "floating" time the importer reads in its own zone. */
export function formatIcsLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Genuine UTC stamp — DTSTAMP is required to be UTC. */
export function formatIcsUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** "YYYY-MM-DD" -> local midnight Date. Parsed by hand so no timezone shift can occur. */
export function parseIsoDate(value?: string | null): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Approximate term start for sections whose real meeting dates never made it
 * through the pipeline. Deliberately vague — but in the right term, which is
 * the whole point. Term labels look like "2026-Fall" / "2026-Winter/Spring".
 */
export function approximateTermStart(term?: string | null, today = new Date()): Date {
  const match = /^(\d{4})-(.+)$/.exec(String(term ?? "").trim());
  if (match) {
    const year = Number(match[1]);
    const season = match[2];
    if (season === "Winter/Spring") return new Date(year, 0, 20);
    if (season === "Summer") return new Date(year, 5, 8);
    if (season === "Fall") return new Date(year, 7, 24);
  }
  // Last resort: the coming Monday, so the export at least lands in the present.
  const fallback = new Date(today);
  fallback.setHours(0, 0, 0, 0);
  fallback.setDate(fallback.getDate() + ((8 - fallback.getDay()) % 7 || 7));
  return fallback;
}

/** First date on or after `from` that falls on `weekday` (0 = Sunday). */
export function firstOccurrenceOnOrAfter(from: Date, weekday: number): Date {
  const result = new Date(from);
  result.setDate(result.getDate() + ((weekday - result.getDay() + 7) % 7));
  return result;
}

/** Serializes one dummy-week event into VEVENT content lines anchored to real dates. */
function buildVevent(event: IcsEvent, stamp: string): string[] {
  const meeting = event.meetingInfo || {};
  const course = event.courseInfo || {};
  const weekday = event.start.getDay();
  const dayCode = ICS_WEEKDAY_CODES[weekday];

  const termStart = parseIsoDate(meeting.startDate) || approximateTermStart(course.term);
  const firstDay = firstOccurrenceOnOrAfter(termStart, weekday);

  const start = new Date(firstDay);
  start.setHours(event.start.getHours(), event.start.getMinutes(), 0, 0);
  const end = new Date(firstDay);
  end.setHours(event.end.getHours(), event.end.getMinutes(), 0, 0);

  // Real term end when we have it; otherwise fall back to the old 16-week guess.
  const termEnd = parseIsoDate(meeting.endDate);
  const until = termEnd
    ? formatIcsLocal(
        new Date(termEnd.getFullYear(), termEnd.getMonth(), termEnd.getDate(), 23, 59, 59),
      )
    : null;
  const recurrence = until
    ? `RRULE:FREQ=WEEKLY;BYDAY=${dayCode};UNTIL=${until}`
    : `RRULE:FREQ=WEEKLY;BYDAY=${dayCode};COUNT=16`;

  // Stable UID: re-importing the same schedule updates events instead of duplicating them.
  const uidSeed = `${course.crn || "evt"}-${dayCode}-${String(meeting.startTime || "").replace(":", "")}`;
  const professors = course.professors?.join(", ") || "TBA";
  const location = [meeting.building, meeting.room].filter(Boolean).join(" ");

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uidSeed.replace(/[^A-Za-z0-9-]/g, "")}@cypress-scheduler`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${formatIcsLocal(start)}`,
    `DTEND:${formatIcsLocal(end)}`,
    recurrence,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(
      `${course.title || ""}\nCRN: ${course.crn || "—"}\nInstructor: ${professors}`,
    )}`,
  ];
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  lines.push("END:VEVENT");
  return lines;
}

/** Builds a complete .ics document (CRLF-terminated, folded) from dummy-week events. */
export function buildIcsCalendar(events: IcsEvent[], now = new Date()): string {
  const stamp = formatIcsUtc(now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cypress Scheduler//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const event of events) lines.push(...buildVevent(event, stamp));
  lines.push("END:VCALENDAR");

  // RFC 5545 §3.1: CRLF line endings, folded content lines.
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
