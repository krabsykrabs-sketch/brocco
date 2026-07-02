/* Dev-only: verify anchor-based recurrence fixes (clamp recovery, count, exdates, fast-forward). */
import { expandEvent, occurrenceAt, parseWall } from "../src/lib/schedule";
import type { Event } from "@prisma/client";

function fakeEvent(overrides: Partial<Event>): Event {
  return {
    id: "e1", userId: "u1", title: "Test", location: null, notes: null, category: "other",
    startAt: parseWall("2026-01-31T10:00"), endAt: null, allDay: false,
    recurrence: "monthly", recurrenceInterval: 1, recurrenceUntil: null, recurrenceCount: null,
    exdates: [], reminderMinutes: null, createdAt: new Date(0), updatedAt: new Date(0),
    ...overrides,
  } as Event;
}

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}\n    expected ${e}\n    got      ${a}`); failures++; }
}

// 1. Monthly on the 31st: clamps in short months but RECOVERS to the 31st
const monthly31 = fakeEvent({});
expect(
  "monthly 31st: Feb clamps to 28, Mar recovers to 31",
  expandEvent(monthly31, "2026-02-01", "2026-04-30").map((o) => o.date),
  ["2026-02-28", "2026-03-31", "2026-04-30"] // April has 30 days -> clamps to 30
);

// 2. Yearly Feb 29 birthday: clamps in non-leap years, recovers on leap years
const leapBirthday = fakeEvent({
  startAt: parseWall("2024-02-29T00:00"), allDay: true, recurrence: "yearly", category: "birthday",
});
expect(
  "yearly Feb 29: 2026 clamps to Feb 28, 2028 recovers to Feb 29",
  [
    expandEvent(leapBirthday, "2026-02-01", "2026-03-01").map((o) => o.date),
    expandEvent(leapBirthday, "2028-02-01", "2028-03-01").map((o) => o.date),
  ],
  [["2026-02-28"], ["2028-02-29"]]
);

// 3. recurrenceCount: exdates consume an index (RRULE semantics)
const counted = fakeEvent({
  startAt: parseWall("2026-06-01T09:00"), recurrence: "daily", recurrenceCount: 3,
  exdates: ["2026-06-02"],
});
expect(
  "count=3 with exdate on #2: occurrences are #1 and #3 only",
  expandEvent(counted, "2026-06-01", "2026-06-30").map((o) => o.date),
  ["2026-06-01", "2026-06-03"]
);

// 4. Fast-forward: daily event anchored 10 years back still appears (old code starved at 2000 steps)
const ancientDaily = fakeEvent({ startAt: parseWall("2016-07-01T08:00"), recurrence: "daily" });
expect(
  "10-year-old daily event still expands into a current week",
  expandEvent(ancientDaily, "2026-07-06", "2026-07-08").map((o) => o.date),
  ["2026-07-06", "2026-07-07", "2026-07-08"]
);

// 5. interval > 1 with count, range starting mid-series
const biweekly = fakeEvent({
  startAt: parseWall("2026-06-01T18:00"), recurrence: "weekly", recurrenceInterval: 2, recurrenceCount: 4,
});
expect(
  "biweekly count=4: series ends July 13, nothing after",
  expandEvent(biweekly, "2026-06-20", "2026-08-31").map((o) => o.date),
  ["2026-06-29", "2026-07-13"]
);

// 6. Multi-day non-recurring event: one occurrence per day, continuations flagged
const trip = fakeEvent({
  startAt: parseWall("2026-07-10T14:00"), endAt: parseWall("2026-07-12T11:00"),
  recurrence: "none", allDay: false,
});
expect(
  "3-day trip: appears Fri/Sat/Sun, days 2-3 are continuations",
  expandEvent(trip, "2026-07-06", "2026-07-19").map((o) => `${o.date}:${o.continuation}`),
  ["2026-07-10:false", "2026-07-11:true", "2026-07-12:true"]
);
expect(
  "3-day trip queried mid-span: only overlapping days, still continuations",
  expandEvent(trip, "2026-07-11", "2026-07-11").map((o) => `${o.date}:${o.continuation}`),
  ["2026-07-11:true"]
);

// 7. occurrenceAt sanity for todos (anchor-based regeneration)
expect(
  "todo anchor Jan-31 monthly: occurrence 1=Feb 28, 2=Mar 31",
  [1, 2].map((n) => occurrenceAt(parseWall("2026-01-31"), "monthly", 1, n).toISOString().slice(0, 10)),
  ["2026-02-28", "2026-03-31"]
);

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log("\nAll recurrence checks passed.");
