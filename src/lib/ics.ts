import { prisma } from "@/lib/db";
import type { Event } from "@prisma/client";
import { resolveFeatures } from "@/lib/features";
import { wallString, wallDateString, addDaysWall } from "@/lib/schedule";

/**
 * RFC 5545 (iCalendar) feed generator for the read-only calendar
 * subscription. Recurring events are exported with native RRULE/EXDATE —
 * the subscriber's calendar app does the expansion. Times are emitted as
 * FLOATING local date-times (no TZID/Z), which matches the app's wall-clock
 * convention: "15:00" means 3pm wherever the user is.
 */

// --- Formatting primitives ---

/** "yyyy-MM-ddTHH:mm" wall string -> "yyyyMMddTHHmm00" ICS floating date-time */
function icsDateTime(wall: string): string {
  return wall.replace(/[-:]/g, "") + "00";
}

/** "yyyy-MM-dd" -> "yyyyMMdd" */
function icsDate(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

/** Escape per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline) */
function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold lines longer than 74 octets (approximated as chars) with CRLF + space */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  return parts.join("\r\n");
}

function nowUtcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

// --- Event -> VEVENT ---

const FREQ_MAP: Record<string, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

function eventToVevent(event: Event, dtstamp: string): string[] {
  const lines: string[] = ["BEGIN:VEVENT"];
  lines.push(`UID:event-${event.id}@brocco.run`);
  lines.push(`DTSTAMP:${dtstamp}`);

  const startWall = wallString(event.startAt);
  const startDate = wallDateString(event.startAt);

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(startDate)}`);
    // DTEND for all-day events is EXCLUSIVE: a single-day event ends the
    // next morning; a multi-day event ends the morning after its last day
    const lastDay = event.endAt ? wallDateString(event.endAt) : startDate;
    const dtend = wallDateString(addDaysWall(new Date(`${lastDay}T00:00:00.000Z`), 1));
    lines.push(`DTEND;VALUE=DATE:${icsDate(dtend)}`);
  } else {
    lines.push(`DTSTART:${icsDateTime(startWall)}`);
    if (event.endAt) {
      lines.push(`DTEND:${icsDateTime(wallString(event.endAt))}`);
    }
  }

  if (event.recurrence !== "none") {
    const parts = [`FREQ=${FREQ_MAP[event.recurrence]}`];
    if (event.recurrenceInterval > 1) parts.push(`INTERVAL=${event.recurrenceInterval}`);
    if (event.recurrenceCount) parts.push(`COUNT=${event.recurrenceCount}`);
    else if (event.recurrenceUntil) {
      const until = wallDateString(event.recurrenceUntil);
      parts.push(event.allDay ? `UNTIL=${icsDate(until)}` : `UNTIL=${icsDateTime(`${until}T23:59`)}`);
    }
    lines.push(`RRULE:${parts.join(";")}`);

    const exdates = Array.isArray(event.exdates) ? (event.exdates as string[]) : [];
    for (const ex of exdates) {
      // EXDATE must match the DTSTART value type (and time-of-day for timed events)
      lines.push(
        event.allDay
          ? `EXDATE;VALUE=DATE:${icsDate(ex)}`
          : `EXDATE:${icsDateTime(`${ex}T${startWall.slice(11, 16)}`)}`
      );
    }
  }

  const emoji = event.category === "birthday" ? "🎂 " : "";
  lines.push(`SUMMARY:${esc(emoji + event.title)}`);
  if (event.location) lines.push(`LOCATION:${esc(event.location)}`);
  if (event.notes) lines.push(`DESCRIPTION:${esc(event.notes)}`);
  lines.push(`CATEGORIES:${esc(event.category)}`);
  lines.push("END:VEVENT");
  return lines;
}

// --- Feed assembly ---

export async function buildIcsFeed(userId: string): Promise<string> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { features: true },
  });
  const features = resolveFeatures(profile?.features);
  const dtstamp = nowUtcStamp();

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//brocco.run//Brocco Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Brocco",
    "X-WR-CALDESC:brocco.run calendar and training plan",
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];

  if (features.calendar) {
    const events = await prisma.event.findMany({ where: { userId }, orderBy: { startAt: "asc" } });
    for (const event of events) lines.push(...eventToVevent(event, dtstamp));
  }

  // Planned workouts from the active plan, as all-day entries (they have a
  // date but no time of day). Rest days are skipped.
  const workouts = await prisma.plannedWorkout.findMany({
    where: { plan: { userId, status: "active" }, workoutType: { not: "rest" } },
    orderBy: { date: "asc" },
  });
  for (const w of workouts) {
    const date = wallDateString(w.date);
    const details = [
      w.targetDistanceKm ? `${Number(w.targetDistanceKm)}km` : null,
      w.targetPace,
      w.targetDurationMin ? `${w.targetDurationMin}min` : null,
    ].filter(Boolean).join(" · ");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:workout-${w.id}@brocco.run`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(date)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(wallDateString(addDaysWall(new Date(`${date}T00:00:00.000Z`), 1)))}`);
    lines.push(`SUMMARY:${esc(`🏃 ${w.title}`)}`);
    if (details || w.description) {
      lines.push(`DESCRIPTION:${esc([details, w.description].filter(Boolean).join("\n"))}`);
    }
    lines.push("CATEGORIES:training");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
