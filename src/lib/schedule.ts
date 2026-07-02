import { prisma } from "@/lib/db";
import type { Event, RecurrenceFreq } from "@prisma/client";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";

/**
 * Calendar + tasks + workouts assembly.
 *
 * Wall-clock convention: event times are stored as naive timestamps holding the
 * user's local wall time. We serialize them as "yyyy-MM-ddTHH:mm" strings and
 * always read/write through UTC accessors (toISOString) so the server timezone
 * never shifts them. Date-only values are "yyyy-MM-dd" strings.
 */

// --- Wall-time helpers ---

/** Parse a "yyyy-MM-ddTHH:mm" (or date-only) wall-time string into a UTC-anchored Date for storage. */
export function parseWall(s: string): Date {
  const normalized = s.length === 10 ? `${s}T00:00` : s.slice(0, 16);
  return new Date(`${normalized}:00.000Z`);
}

/** Serialize a stored wall-time Date back to "yyyy-MM-ddTHH:mm". */
export function wallString(d: Date): string {
  return d.toISOString().slice(0, 16);
}

/** Date part of a stored wall-time Date: "yyyy-MM-dd". */
export function wallDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Calendar date ("yyyy-MM-dd") of a real UTC instant, as seen in the given
 * IANA timezone. Use this (not wallDateString) for actual timestamps like
 * stravaLastSyncAt — wallDateString is only for the naive local-time
 * convention used by events/todos.
 */
export function dateInTimezone(instant: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/** Today's date ("yyyy-MM-dd") in the user's IANA timezone. */
export function todayInTimezone(tz: string): string {
  return dateInTimezone(new Date(), tz);
}

/** Current wall-clock "yyyy-MM-ddTHH:mm" in the user's IANA timezone. */
export function nowInTimezone(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
  } catch {
    return new Date().toISOString().slice(0, 16);
  }
}

const WEEKDAY_FMT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_FMT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu, Jun 11" from a "yyyy-MM-dd" date string. */
export function formatDateShort(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return `${WEEKDAY_FMT[d.getUTCDay()]}, ${MONTH_FMT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "15:00" from a "yyyy-MM-ddTHH:mm" wall string. */
export function formatTimeShort(wall: string): string {
  return wall.slice(11, 16);
}

// --- Event occurrence expansion ---

export interface EventOccurrence {
  eventId: string;
  /** Unique within a query: eventId + date */
  occurrenceKey: string;
  date: string; // yyyy-MM-dd
  start: string; // yyyy-MM-ddTHH:mm wall time
  end: string | null;
  title: string;
  location: string | null;
  notes: string | null;
  category: string;
  allDay: boolean;
  recurring: boolean;
  reminderMinutes: number | null;
}

const MAX_EXPANSION_STEPS = 2000;

function advance(d: Date, freq: RecurrenceFreq, interval: number): Date {
  switch (freq) {
    case "daily": return addDays(d, interval);
    case "weekly": return addWeeks(d, interval);
    case "monthly": return addMonths(d, interval);
    case "yearly": return addYears(d, interval);
    default: return d;
  }
}

/**
 * Expand a single event into occurrences within [rangeStart, rangeEnd] (inclusive,
 * "yyyy-MM-dd" strings). Recurring events are expanded by stepping from the series
 * start; exdates remove individual occurrences (but still count toward recurrenceCount).
 */
export function expandEvent(event: Event, rangeStart: string, rangeEnd: string): EventOccurrence[] {
  const exdates = new Set(Array.isArray(event.exdates) ? (event.exdates as string[]) : []);
  const durationMs = event.endAt ? event.endAt.getTime() - event.startAt.getTime() : 0;

  const toOccurrence = (start: Date): EventOccurrence => {
    const startStr = wallString(start);
    return {
      eventId: event.id,
      occurrenceKey: `${event.id}:${startStr.slice(0, 10)}`,
      date: startStr.slice(0, 10),
      start: startStr,
      end: durationMs > 0 ? wallString(new Date(start.getTime() + durationMs)) : null,
      title: event.title,
      location: event.location,
      notes: event.notes,
      category: event.category,
      allDay: event.allDay,
      recurring: event.recurrence !== "none",
      reminderMinutes: event.reminderMinutes,
    };
  };

  if (event.recurrence === "none") {
    const date = wallDateString(event.startAt);
    const endDate = event.endAt ? wallDateString(event.endAt) : date;
    // Include if the event overlaps the range
    if (endDate >= rangeStart && date <= rangeEnd) return [toOccurrence(event.startAt)];
    return [];
  }

  const interval = Math.max(1, event.recurrenceInterval);
  const until = event.recurrenceUntil ? wallDateString(event.recurrenceUntil) : null;
  const maxCount = event.recurrenceCount ?? Infinity;

  const occurrences: EventOccurrence[] = [];
  let cursor = event.startAt;
  let generated = 0;

  for (let step = 0; step < MAX_EXPANSION_STEPS; step++) {
    const dateStr = wallDateString(cursor);
    if (dateStr > rangeEnd) break;
    if (until && dateStr > until) break;
    generated++;
    if (generated > maxCount) break;
    if (dateStr >= rangeStart && !exdates.has(dateStr)) {
      occurrences.push(toOccurrence(cursor));
    }
    cursor = advance(cursor, event.recurrence, interval);
  }

  return occurrences;
}

/** All event occurrences for a user within [rangeStart, rangeEnd]. */
export async function getEventOccurrences(
  userId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<EventOccurrence[]> {
  const events = await prisma.event.findMany({
    where: {
      userId,
      OR: [
        // Non-recurring: must start before range end (overlap checked in expansion)
        { recurrence: "none", startAt: { lte: parseWall(`${rangeEnd}T23:59`) } },
        // Recurring: series must start before range end and not be over before range start
        {
          recurrence: { not: "none" },
          startAt: { lte: parseWall(`${rangeEnd}T23:59`) },
          OR: [
            { recurrenceUntil: null },
            { recurrenceUntil: { gte: parseWall(rangeStart) } },
          ],
        },
      ],
    },
    orderBy: { startAt: "asc" },
  });

  const occurrences = events.flatMap((e) => expandEvent(e, rangeStart, rangeEnd));
  occurrences.sort((a, b) => a.start.localeCompare(b.start));
  return occurrences;
}

// --- Planned workouts (read-through from the active training plan) ---

export interface WorkoutItem {
  workoutId: string;
  date: string; // yyyy-MM-dd
  title: string;
  workoutType: string;
  activityType: string;
  targetDistanceKm: number | null;
  targetPace: string | null;
  targetDurationMin: number | null;
  description: string | null;
  status: string;
}

export async function getPlannedWorkouts(
  userId: string,
  rangeStart: string,
  rangeEnd: string,
  opts: { includeRest?: boolean } = {}
): Promise<WorkoutItem[]> {
  const workouts = await prisma.plannedWorkout.findMany({
    where: {
      plan: { userId, status: "active" },
      date: { gte: parseWall(rangeStart), lte: parseWall(rangeEnd) },
      ...(opts.includeRest ? {} : { workoutType: { not: "rest" } }),
    },
    orderBy: { date: "asc" },
  });

  return workouts.map((w) => ({
    workoutId: w.id,
    date: wallDateString(w.date),
    title: w.title,
    workoutType: w.workoutType,
    activityType: w.activityType,
    targetDistanceKm: w.targetDistanceKm ? Number(w.targetDistanceKm) : null,
    targetPace: w.targetPace,
    targetDurationMin: w.targetDurationMin,
    description: w.description,
    status: w.status,
  }));
}

// --- Tasks ---

export interface TodoItem {
  todoId: string;
  title: string;
  notes: string | null;
  dueDate: string | null; // yyyy-MM-dd
  dueTime: string | null; // HH:mm
  priority: string | null;
  recurrence: string;
  done: boolean;
  listId: string | null;
  listName: string | null;
  parentId: string | null;
  overdue: boolean;
}

/** Open tasks due within the range, plus (optionally) everything overdue. */
export async function getDueTodos(
  userId: string,
  rangeStart: string,
  rangeEnd: string,
  opts: { includeOverdue?: boolean; today?: string } = {}
): Promise<TodoItem[]> {
  const today = opts.today ?? rangeStart;
  const todos = await prisma.todo.findMany({
    where: {
      userId,
      done: false,
      dueDate: opts.includeOverdue
        ? { lte: parseWall(rangeEnd) }
        : { gte: parseWall(rangeStart), lte: parseWall(rangeEnd) },
    },
    include: { list: { select: { id: true, name: true } } },
    orderBy: [{ dueDate: "asc" }, { position: "asc" }],
  });

  return todos.map((t) => {
    const due = t.dueDate ? wallDateString(t.dueDate) : null;
    return {
      todoId: t.id,
      title: t.title,
      notes: t.notes,
      dueDate: due,
      dueTime: t.dueTime,
      priority: t.priority,
      recurrence: t.recurrence,
      done: t.done,
      listId: t.list?.id ?? null,
      listName: t.list?.name ?? null,
      parentId: t.parentId,
      overdue: !!due && due < today,
    };
  });
}

// --- Unified agenda ---

export interface Agenda {
  rangeStart: string;
  rangeEnd: string;
  events: EventOccurrence[];
  workouts: WorkoutItem[];
  todos: TodoItem[];
}

/** Everything happening in a date range: events, planned workouts, due tasks. */
export async function getAgenda(
  userId: string,
  rangeStart: string,
  rangeEnd: string,
  opts: { includeOverdueTodos?: boolean; today?: string; includeRestWorkouts?: boolean } = {}
): Promise<Agenda> {
  const [events, workouts, todos] = await Promise.all([
    getEventOccurrences(userId, rangeStart, rangeEnd),
    getPlannedWorkouts(userId, rangeStart, rangeEnd, { includeRest: opts.includeRestWorkouts }),
    getDueTodos(userId, rangeStart, rangeEnd, {
      includeOverdue: opts.includeOverdueTodos,
      today: opts.today,
    }),
  ]);
  return { rangeStart, rangeEnd, events, workouts, todos };
}

/**
 * Compact text rendering of an agenda for Brocco's context / query_schedule.
 * Groups by day; flags timed-event overlaps so the model can spot conflicts.
 */
export function renderAgendaText(agenda: Agenda): string {
  const days = new Map<string, string[]>();
  const push = (date: string, line: string) => {
    if (!days.has(date)) days.set(date, []);
    days.get(date)!.push(line);
  };

  for (const e of agenda.events) {
    const time = e.allDay ? "all-day" : `${formatTimeShort(e.start)}${e.end ? `-${formatTimeShort(e.end)}` : ""}`;
    const loc = e.location ? ` @ ${e.location}` : "";
    const rec = e.recurring ? " (recurring)" : "";
    push(e.date, `[event:${e.category}] ${time} ${e.title}${loc}${rec} (event_id: ${e.eventId})`);
  }
  for (const w of agenda.workouts) {
    const parts = [
      w.targetDistanceKm ? `${w.targetDistanceKm}km` : null,
      w.targetPace,
      w.targetDurationMin ? `${w.targetDurationMin}min` : null,
    ].filter(Boolean).join(", ");
    push(w.date, `[workout:${w.workoutType}] ${w.title}${parts ? ` — ${parts}` : ""} [${w.status}] (workout_id: ${w.workoutId})`);
  }
  for (const t of agenda.todos) {
    if (!t.dueDate) continue;
    const date = t.overdue ? agenda.rangeStart : t.dueDate;
    const flags = [t.priority, t.overdue ? `OVERDUE since ${t.dueDate}` : null].filter(Boolean).join(", ");
    push(date, `[task] ${t.title}${t.dueTime ? ` at ${t.dueTime}` : ""}${flags ? ` (${flags})` : ""} (task_id: ${t.todoId})`);
  }

  if (days.size === 0) return "Nothing scheduled in this range.";

  const sortedDates = Array.from(days.keys()).sort();
  const blocks = sortedDates.map((date) => {
    const lines = days.get(date)!;
    return `${formatDateShort(date)} (${date}):\n${lines.map((l) => `  - ${l}`).join("\n")}`;
  });
  return blocks.join("\n");
}

/** Upcoming birthdays (events with category=birthday) within the next N days. */
export async function getUpcomingBirthdays(
  userId: string,
  today: string,
  daysAhead = 14
): Promise<Array<{ title: string; date: string; daysUntil: number; notes: string | null }>> {
  const end = wallDateString(addDays(parseWall(today), daysAhead));
  const occurrences = await getEventOccurrences(userId, today, end);
  return occurrences
    .filter((o) => o.category === "birthday")
    .map((o) => ({
      title: o.title,
      date: o.date,
      daysUntil: Math.round((parseWall(o.date).getTime() - parseWall(today).getTime()) / 86400000),
      notes: o.notes,
    }));
}
