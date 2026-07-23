"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "../nav";
import { categoryMeta, EVENT_CATEGORY_META, getWorkoutTypeColor } from "@/lib/categories";
import { useScreenContext, useDataChanged } from "@/lib/capture-context";
import { isCompatibleType } from "@/lib/activity-types";

// --- Types ---

interface EventOccurrence {
  eventId: string; occurrenceKey: string; date: string; start: string; end: string | null;
  title: string; location: string | null; notes: string | null; category: string;
  allDay: boolean; recurring: boolean; continuation: boolean;
}
interface WorkoutItem {
  workoutId: string; date: string; title: string; workoutType: string; activityType: string;
  targetDistanceKm: number | null; targetPace: string | null; status: string;
}
interface ActivityItem {
  activityId: string; date: string; name: string; activityType: string;
  distanceKm: number | null; durationMin: number | null; avgPacePerKm: string | null; source: string;
}
type ViewMode = "day" | "week" | "month";

// --- Planned ↔ done reconciliation (same rule as the plan tab) ---

type WorkoutState = "done" | "missed" | "today" | "future";

interface ReconciledDay {
  rows: { workout: WorkoutItem; matched: ActivityItem | null; state: WorkoutState }[];
  extras: ActivityItem[];
}

function reconcileDay(workouts: WorkoutItem[], activities: ActivityItem[], today: string): ReconciledDay {
  const used = new Set<string>();
  const rows = workouts.map((w) => {
    const matched =
      activities.find((a) => !used.has(a.activityId) && isCompatibleType(w.activityType, a.activityType)) || null;
    if (matched) used.add(matched.activityId);
    const done = !!matched || w.status === "completed";
    const state: WorkoutState = done ? "done" : w.date < today ? "missed" : w.date === today ? "today" : "future";
    return { workout: w, matched, state };
  });
  return { rows, extras: activities.filter((a) => !used.has(a.activityId)) };
}

function activityDetail(a: ActivityItem): string {
  if (a.distanceKm) {
    return `${a.distanceKm.toFixed(1)} km${a.avgPacePerKm ? ` · ${a.avgPacePerKm.replace("/km", "")}` : ""}`;
  }
  if (a.durationMin) return `${Math.round(a.durationMin)} min`;
  return "";
}

// --- Local date helpers (all on yyyy-MM-dd strings, week starts Monday) ---

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toDate(s: string): Date { return new Date(`${s}T00:00:00`); }
function toStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDaysStr(s: string, n: number): string {
  const d = toDate(s); d.setDate(d.getDate() + n); return toStr(d);
}
function startOfWeekStr(s: string): string {
  const d = toDate(s);
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (dow - 1));
  return toStr(d);
}
function startOfMonthStr(s: string): string { return s.slice(0, 8) + "01"; }
function addMonthsStr(s: string, n: number): string {
  const d = toDate(startOfMonthStr(s)); d.setMonth(d.getMonth() + n); return toStr(d);
}
function fmt(s: string, opts: Intl.DateTimeFormatOptions): string {
  return toDate(s).toLocaleDateString("en-GB", opts);
}

// --- Swipe pager (same animation pattern as the plan page) ---

function SwipePager({
  contentKey,
  onSwipe,
  children,
  className,
}: {
  contentKey: string;
  onSwipe: (dir: 1 | -1) => void; // 1 = previous (swipe right), -1 = next (swipe left)
  children: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchDeltaX = useRef(0);
  const directionLocked = useRef<"horizontal" | "vertical" | null>(null);
  const animatingRef = useRef(false);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [phase, setPhase] = useState<"idle" | "exit" | "entering">("idle");
  const pendingKey = useRef(contentKey);

  const slide = useCallback((dir: 1 | -1) => {
    if (animatingRef.current) return;
    animatingRef.current = true;
    const width = containerRef.current?.offsetWidth || 400;
    setSwiping(false);
    setPhase("exit");
    setOffset(dir * width);
    setTimeout(() => {
      onSwipe(dir);
      setPhase("entering");
      setOffset(-dir * width);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPhase("idle");
          setOffset(0);
          setTimeout(() => { animatingRef.current = false; }, 250);
        });
      });
    }, 200);
  }, [onSwipe]);

  useEffect(() => { pendingKey.current = contentKey; }, [contentKey]);

  function onTouchStart(e: React.TouchEvent) {
    if (animatingRef.current) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchDeltaX.current = 0;
    directionLocked.current = null;
    setSwiping(true);
    setPhase("idle");
  }
  function onTouchMove(e: React.TouchEvent) {
    if (animatingRef.current) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!directionLocked.current) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      directionLocked.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    }
    if (directionLocked.current === "vertical") { setSwiping(false); return; }
    touchDeltaX.current = dx;
    setOffset(dx);
  }
  function onTouchEnd() {
    if (animatingRef.current || directionLocked.current === "vertical") {
      setSwiping(false); directionLocked.current = null; setOffset(0); return;
    }
    const width = containerRef.current?.offsetWidth || 400;
    const threshold = width * 0.25;
    if (touchDeltaX.current < -threshold) slide(-1);
    else if (touchDeltaX.current > threshold) slide(1);
    else { setSwiping(false); setOffset(0); }
    directionLocked.current = null;
  }

  const useTransition = !swiping && phase !== "entering";

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden ${className || ""}`}
      style={{ touchAction: "pan-y" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="will-change-transform h-full"
        style={{ transform: `translateX(${offset}px)`, transition: useTransition ? "transform 0.22s ease-out" : "none" }}
      >
        {children}
      </div>
    </div>
  );
}

// --- Event rows ---

function EventChip({ event, onTap }: { event: EventOccurrence; onTap: () => void }) {
  const meta = categoryMeta(event.category);
  const isLastDay = event.end?.slice(0, 10) === event.date;
  return (
    <button onClick={onTap} className={`w-full flex items-center gap-2.5 border-2 rounded-xl px-2.5 py-1.5 text-left shadow-[2px_2px_0_var(--color-shade)] sticker-press ${event.continuation ? "opacity-80" : ""} ${meta.bg}`}>
      <div className="w-1.5 self-stretch rounded-full flex-shrink-0 border border-ink/60" style={{ backgroundColor: meta.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-ink truncate">
          {event.continuation ? "⟶ " : event.category === "birthday" ? "🎂 " : ""}{event.title}
          {event.recurring && <span className="text-sage ml-1">↻</span>}
        </p>
        <p className="text-[10px] text-moss font-semibold truncate tabular-nums">
          {event.continuation
            ? isLastDay && !event.allDay
              ? `until ${event.end!.slice(11, 16)}`
              : "continues"
            : event.allDay
            ? "all day"
            : `${event.start.slice(11, 16)}${event.end ? `–${event.end.slice(11, 16)}` : ""}`}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      </div>
    </button>
  );
}

/**
 * Planned | actual, side by side: the plan in the left cell, the matched
 * activity's real numbers in the right one — instead of a tiny badge.
 */
function WorkoutChip({ workout, matched, state }: { workout: WorkoutItem; matched: ActivityItem | null; state: WorkoutState }) {
  return (
    <Link href={matched ? `/activity/${matched.activityId}` : `/plan?w=${workout.workoutId}`} className={`sticker sticker-press grid grid-cols-2 overflow-hidden ${state === "today" ? "shadow-[3px_3px_0_var(--color-brocco)]" : ""}`}>
      <div className="px-2.5 py-1.5 border-r-2 border-dashed border-shade min-w-0">
        <p className="label-xs">Planned</p>
        <p className={`text-xs font-bold truncate flex items-center gap-1.5 ${state === "missed" ? "text-moss" : "text-ink"}`}>
          <span className="w-2 h-2 rounded-full border border-ink/60 flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }} />
          {workout.title}
        </p>
        <p className="text-[10px] text-moss font-semibold truncate tabular-nums">
          {[workout.targetDistanceKm ? `${workout.targetDistanceKm} km` : null, workout.targetPace].filter(Boolean).join(" · ") || "training plan"}
        </p>
      </div>
      {state === "done" ? (
        <div className="px-2.5 py-1.5 bg-sprout min-w-0">
          <p className="label-xs text-leaf!">✓ Done</p>
          <p className="text-xs font-extrabold text-ink truncate tabular-nums">{matched ? activityDetail(matched) || matched.name : "completed"}</p>
          {matched && <p className="text-[10px] text-leaf font-bold truncate">{matched.source === "strava" ? "strava" : "logged"}</p>}
        </div>
      ) : state === "missed" ? (
        <div className="px-2.5 py-1.5 bg-clay-soft min-w-0">
          <p className="label-xs text-clay!">✗ Missed</p>
          <p className="text-xs font-bold text-clay truncate">not run</p>
        </div>
      ) : (
        <div className="px-2.5 py-1.5 bg-ghost min-w-0">
          <p className="label-xs">Actual</p>
          <p className="text-xs font-bold text-ghost-ink truncate">{state === "today" ? "— today" : "—"}</p>
        </div>
      )}
    </Link>
  );
}

/** A completed activity with no planned workout behind it (spontaneous run, extra ride, ad-hoc session). */
function ActivityChip({ activity }: { activity: ActivityItem }) {
  return (
    <Link href={`/activity/${activity.activityId}`} className="sticker sticker-press grid grid-cols-2 overflow-hidden">
      <div className="px-2.5 py-1.5 border-r-2 border-dashed border-shade bg-ghost min-w-0">
        <p className="label-xs">Unplanned</p>
        <p className="text-xs font-bold text-ghost-ink truncate">— spontaneous</p>
      </div>
      <div className="px-2.5 py-1.5 bg-sprout min-w-0">
        <p className="label-xs text-leaf!">✓ Done</p>
        <p className="text-xs font-extrabold text-ink truncate">{activity.name}</p>
        <p className="text-[10px] text-leaf font-bold truncate tabular-nums">
          {[activityDetail(activity), activity.source === "strava" ? "strava" : "logged"].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
  );
}

// --- Event form (create + edit) ---

interface EventFormData {
  id?: string;
  title: string; date: string; time: string; endDate: string; endTime: string; allDay: boolean;
  category: string; location: string; notes: string;
  recurrence: string; recurrenceInterval: number; recurrenceUntil: string;
  reminderMinutes: string;
}

function emptyForm(date: string): EventFormData {
  return {
    title: "", date, time: "", endDate: "", endTime: "", allDay: false, category: "other",
    location: "", notes: "", recurrence: "none", recurrenceInterval: 1, recurrenceUntil: "", reminderMinutes: "",
  };
}

function EventFormModal({
  form: initial,
  onClose,
  onSaved,
}: {
  form: EventFormData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<EventFormData>) => setForm((f) => ({ ...f, ...patch }));

  async function handleSave() {
    if (!form.title.trim() || !form.date) return;
    setSaving(true);
    const allDay = form.allDay || !form.time;
    // Multi-day support: an end date different from the start date makes the
    // event span days (trip, overnight travel). All-day multi-day events get
    // an end of endDate 23:59 so the expansion covers the whole last day.
    const endDate = form.endDate && form.endDate > form.date ? form.endDate : form.date;
    let end: string | null = null;
    if (allDay) {
      end = endDate !== form.date ? `${endDate}T23:59` : null;
    } else if (form.endTime || endDate !== form.date) {
      end = `${endDate}T${form.endTime || form.time}`;
    }
    const payload = {
      title: form.title.trim(),
      start: allDay ? form.date : `${form.date}T${form.time}`,
      end,
      allDay,
      category: form.category,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
      recurrence: form.recurrence,
      recurrenceInterval: form.recurrenceInterval,
      recurrenceUntil: form.recurrenceUntil || null,
      reminderMinutes: form.reminderMinutes ? Number(form.reminderMinutes) : null,
    };
    const res = form.id
      ? await fetch(`/api/events/${form.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
  }

  const inputCls = "field";

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full md:max-w-md bg-paper border-2 border-ink rounded-t-2xl md:rounded-2xl md:shadow-[4px_4px_0_var(--color-shade)] p-4 max-h-[90vh] overflow-y-auto safe-bottom">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-extrabold text-ink">{form.id ? "Edit event" : "New event"}</h2>
          <button onClick={onClose} className="text-moss hover:text-ink text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-2.5">
          <input autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Title" className={inputCls} />

          <div className="flex gap-2">
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} className={inputCls} />
            <label className="flex items-center gap-1.5 text-xs text-ink font-bold flex-shrink-0 px-1">
              <input type="checkbox" checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} className="accent-[#9ccb2e]" />
              All-day
            </label>
          </div>

          {!form.allDay && (
            <div className="flex gap-2 items-center">
              <input type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} className={inputCls} />
              <span className="text-moss text-xs font-bold">to</span>
              <input type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} className={inputCls} />
            </div>
          )}

          <div className="flex gap-2 items-center">
            <span className="text-xs text-moss font-bold flex-shrink-0 w-14">Ends on</span>
            <input
              type="date"
              value={form.endDate}
              min={form.date}
              onChange={(e) => set({ endDate: e.target.value })}
              className={inputCls}
              title="Leave empty for a single-day event"
            />
            {form.endDate && form.endDate !== form.date && (
              <button onClick={() => set({ endDate: "" })} className="text-xs text-moss font-bold hover:text-ink flex-shrink-0">clear</button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {Object.entries(EVENT_CATEGORY_META).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => set({ category: key })}
                className={`px-2.5 py-1 rounded-full text-xs border-2 transition-colors font-bold ${
                  form.category === key ? "border-ink text-ink" : "border-shade text-moss hover:border-ink"
                }`}
                style={form.category === key ? { backgroundColor: meta.color } : {}}
              >
                {meta.label}
              </button>
            ))}
          </div>

          <input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="Location (optional)" className={inputCls} />
          <textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Notes (optional)" rows={2} className={inputCls} />

          <div className="flex gap-2 items-center">
            <select value={form.recurrence} onChange={(e) => set({ recurrence: e.target.value })} className={inputCls}>
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            {form.recurrence !== "none" && (
              <input
                type="date" value={form.recurrenceUntil} onChange={(e) => set({ recurrenceUntil: e.target.value })}
                className={inputCls} title="Repeat until (optional)"
              />
            )}
          </div>

          <select value={form.reminderMinutes} onChange={(e) => set({ reminderMinutes: e.target.value })} className={inputCls}>
            <option value="">No reminder</option>
            <option value="0">At start</option>
            <option value="15">15 min before</option>
            <option value="60">1 hour before</option>
            <option value="1440">1 day before</option>
          </select>

          <button
            onClick={handleSave}
            disabled={saving || !form.title.trim()}
            className="btn-brocco w-full py-2.5 text-sm"
          >
            {saving ? "Saving..." : form.id ? "Save changes" : "Add event"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Event detail sheet ---

function EventDetailSheet({
  occurrence,
  onClose,
  onEdit,
  onChanged,
}: {
  occurrence: EventOccurrence;
  onClose: () => void;
  onEdit: (form: EventFormData) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const meta = categoryMeta(occurrence.category);

  async function loadForEdit() {
    setBusy(true);
    const res = await fetch(`/api/events/${occurrence.eventId}`);
    setBusy(false);
    if (!res.ok) return;
    const { event } = await res.json();
    onEdit({
      id: event.id,
      title: event.title,
      date: event.start.slice(0, 10),
      time: event.allDay ? "" : event.start.slice(11, 16),
      endDate: event.end && event.end.slice(0, 10) !== event.start.slice(0, 10) ? event.end.slice(0, 10) : "",
      endTime: event.end ? event.end.slice(11, 16) : "",
      allDay: event.allDay,
      category: event.category,
      location: event.location || "",
      notes: event.notes || "",
      recurrence: event.recurrence,
      recurrenceInterval: event.recurrenceInterval || 1,
      recurrenceUntil: event.recurrenceUntil || "",
      reminderMinutes: event.reminderMinutes != null ? String(event.reminderMinutes) : "",
    });
    onClose();
  }

  async function handleDelete(scope: "occurrence" | "series") {
    setBusy(true);
    const url = scope === "occurrence"
      ? `/api/events/${occurrence.eventId}?scope=occurrence&date=${occurrence.date}`
      : `/api/events/${occurrence.eventId}`;
    const res = await fetch(url, { method: "DELETE" });
    setBusy(false);
    if (res.ok) { onChanged(); onClose(); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full md:max-w-md bg-paper border-2 border-ink rounded-t-2xl md:rounded-2xl md:shadow-[4px_4px_0_var(--color-shade)] p-4 safe-bottom">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-1.5 self-stretch rounded-full border border-ink/60" style={{ backgroundColor: meta.color }} />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-extrabold text-ink">{occurrence.category === "birthday" ? "🎂 " : ""}{occurrence.title}</h2>
            <p className="text-xs text-moss font-semibold mt-0.5">
              {fmt(occurrence.date, { weekday: "long", day: "numeric", month: "long" })}
              {!occurrence.allDay && ` · ${occurrence.start.slice(11, 16)}${occurrence.end ? `–${occurrence.end.slice(11, 16)}` : ""}`}
              {occurrence.recurring && " · repeats"}
            </p>
            {occurrence.location && <p className="text-xs text-moss font-semibold mt-1">📍 {occurrence.location}</p>}
            {occurrence.notes && <p className="text-xs text-ink mt-2 whitespace-pre-wrap">{occurrence.notes}</p>}
          </div>
          <button onClick={onClose} className="text-moss hover:text-ink text-xl leading-none">&times;</button>
        </div>
        <div className="flex gap-2">
          <button onClick={loadForEdit} disabled={busy} className="btn-quiet flex-1 py-2 text-sm disabled:opacity-50">Edit</button>
          {occurrence.recurring ? (
            <>
              <button onClick={() => handleDelete("occurrence")} disabled={busy} className="btn-danger flex-1 py-2 text-sm disabled:opacity-50">Delete this</button>
              <button onClick={() => handleDelete("series")} disabled={busy} className="btn-danger flex-1 py-2 text-sm disabled:opacity-50">Delete all</button>
            </>
          ) : (
            <button onClick={() => handleDelete("series")} disabled={busy} className="btn-danger flex-1 py-2 text-sm disabled:opacity-50">Delete</button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main calendar ---

export default function CalendarView() {
  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(todayStr());
  const [events, setEvents] = useState<EventOccurrence[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [formOpen, setFormOpen] = useState<EventFormData | null>(null);
  const [detail, setDetail] = useState<EventOccurrence | null>(null);
  const today = todayStr();

  // Visible range per view
  const [rangeStart, rangeEnd] = useMemo(() => {
    if (view === "day") return [anchor, anchor];
    if (view === "week") {
      const ws = startOfWeekStr(anchor);
      return [ws, addDaysStr(ws, 6)];
    }
    const ms = startOfMonthStr(anchor);
    const gridStart = startOfWeekStr(ms);
    const nextMonth = addMonthsStr(anchor, 1);
    const lastDay = addDaysStr(nextMonth, -1);
    const gridEnd = addDaysStr(startOfWeekStr(lastDay), 6);
    return [gridStart, gridEnd];
  }, [view, anchor]);

  const fetchData = useCallback(() => {
    fetch(`/api/events?from=${rangeStart}&to=${rangeEnd}`)
      .then((r) => r.json())
      .then((d) => { setEvents(d.events || []); setWorkouts(d.workouts || []); setActivities(d.activities || []); })
      .catch(() => {});
  }, [rangeStart, rangeEnd]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useDataChanged(["calendar", "plan", "activities"], fetchData);

  useScreenContext(
    {
      name: "calendar",
      view,
      rangeStart,
      rangeEnd,
      selectedItem: detail ? { type: "event", id: detail.eventId, title: detail.title, date: detail.date } : undefined,
    },
    [view, rangeStart, rangeEnd, detail?.eventId]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, { events: EventOccurrence[]; workouts: WorkoutItem[]; activities: ActivityItem[] }>();
    const get = (d: string) => {
      if (!map.has(d)) map.set(d, { events: [], workouts: [], activities: [] });
      return map.get(d)!;
    };
    for (const e of events) get(e.date).events.push(e);
    for (const w of workouts) get(w.date).workouts.push(w);
    for (const a of activities) get(a.date).activities.push(a);
    for (const v of map.values()) {
      v.events.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
    }
    return map;
  }, [events, workouts, activities]);

  const navigate = useCallback((dir: 1 | -1) => {
    // dir 1 = previous, -1 = next
    setAnchor((a) => {
      if (view === "day") return addDaysStr(a, dir === 1 ? -1 : 1);
      if (view === "week") return addDaysStr(a, dir === 1 ? -7 : 7);
      return addMonthsStr(a, dir === 1 ? -1 : 1);
    });
  }, [view]);

  const headerLabel = useMemo(() => {
    if (view === "day") return fmt(anchor, { weekday: "long", day: "numeric", month: "long" });
    if (view === "week") {
      const ws = startOfWeekStr(anchor);
      const we = addDaysStr(ws, 6);
      return `${fmt(ws, { day: "numeric", month: "short" })} – ${fmt(we, { day: "numeric", month: "short" })}`;
    }
    return fmt(startOfMonthStr(anchor), { month: "long", year: "numeric" });
  }, [view, anchor]);

  // --- Day section (used by day + week views) ---
  function DaySection({ date, compact }: { date: string; compact?: boolean }) {
    const data = byDate.get(date) || { events: [], workouts: [], activities: [] };
    const isToday = date === today;
    const isEmpty = data.events.length === 0 && data.workouts.length === 0 && data.activities.length === 0;
    if (compact && isEmpty) {
      return (
        <div className="flex items-center gap-3 py-1.5 opacity-60">
          <DayLabel date={date} isToday={isToday} />
          <div className="flex-1 border-b-2 border-dotted border-shade" />
        </div>
      );
    }
    const { rows, extras } = reconcileDay(data.workouts, data.activities, today);
    return (
      <div className="flex gap-3 py-1.5">
        <DayLabel date={date} isToday={isToday} />
        <div className="flex-1 min-w-0 space-y-1.5">
          {data.events.map((e) => <EventChip key={e.occurrenceKey} event={e} onTap={() => setDetail(e)} />)}
          {rows.map(({ workout, matched, state }) => (
            <WorkoutChip key={workout.workoutId} workout={workout} matched={matched} state={state} />
          ))}
          {extras.map((a) => <ActivityChip key={a.activityId} activity={a} />)}
          {!compact && isEmpty && <p className="text-xs text-sage font-semibold py-2">Nothing scheduled.</p>}
        </div>
      </div>
    );
  }

  function DayLabel({ date, isToday }: { date: string; isToday: boolean }) {
    return (
      <button onClick={() => { setAnchor(date); setView("day"); }} className="w-11 flex-shrink-0 text-center pt-0.5">
        <p className={`text-[10px] font-extrabold uppercase ${isToday ? "text-leaf" : "text-sage"}`}>{fmt(date, { weekday: "short" })}</p>
        <p className={`text-lg font-extrabold leading-tight tabular-nums ${isToday ? "text-leaf" : "text-ink"}`}>{toDate(date).getDate()}</p>
      </button>
    );
  }

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-28 md:pb-12 flex flex-col">
      <PageHeader title="Calendar" />

      {/* View switcher + nav */}
      <div className="flex items-center justify-between mt-2 mb-1">
        <div className="flex sticker rounded-xl p-0.5">
          {(["day", "week", "month"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs rounded-lg capitalize transition-colors font-bold ${view === v ? "bg-brocco text-ink" : "text-sage hover:text-ink"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {anchor !== today && (
            <button onClick={() => setAnchor(today)} className="px-2 py-1 text-xs text-leaf font-bold hover:opacity-70">Today</button>
          )}
          <button onClick={() => navigate(1)} className="p-1.5 text-moss hover:text-ink">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={() => navigate(-1)} className="p-1.5 text-moss hover:text-ink">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>

      <p className="text-sm font-extrabold text-ink mb-2">{headerLabel}</p>

      {/* Views */}
      <SwipePager contentKey={`${view}:${rangeStart}`} onSwipe={navigate} className="flex-1">
        {view === "month" ? (
          <MonthGrid
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            anchorMonth={anchor.slice(0, 7)}
            today={today}
            byDate={byDate}
            onDayTap={(d) => { setAnchor(d); setView("day"); }}
          />
        ) : view === "week" ? (
          <div className="divide-y-2 divide-shade/40">
            {Array.from({ length: 7 }, (_, i) => addDaysStr(rangeStart, i)).map((d) => (
              <DaySection key={d} date={d} compact />
            ))}
          </div>
        ) : (
          <DaySection date={anchor} />
        )}
      </SwipePager>

      {/* Add-event FAB (left of the mic) */}
      <button
        onClick={() => setFormOpen(emptyForm(view === "day" ? anchor : today))}
        aria-label="Add event"
        className="fixed z-[60] w-12 h-12 rounded-full bg-card border-2 border-ink shadow-[3px_3px_0_var(--color-shade)] hover:bg-ghost active:translate-x-[2px] active:translate-y-[2px] active:shadow-none flex items-center justify-center transition-all"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.75rem)", right: "calc(1rem + 4.25rem)" }}
      >
        <span className="text-2xl text-ink leading-none">+</span>
      </button>

      {formOpen && (
        <EventFormModal form={formOpen} onClose={() => setFormOpen(null)} onSaved={fetchData} />
      )}
      {detail && (
        <EventDetailSheet
          occurrence={detail}
          onClose={() => setDetail(null)}
          onEdit={(f) => setFormOpen(f)}
          onChanged={fetchData}
        />
      )}
    </main>
  );
}

// --- Month grid ---

function MonthGrid({
  rangeStart,
  rangeEnd,
  anchorMonth,
  today,
  byDate,
  onDayTap,
}: {
  rangeStart: string;
  rangeEnd: string;
  anchorMonth: string; // yyyy-MM
  today: string;
  byDate: Map<string, { events: EventOccurrence[]; workouts: WorkoutItem[]; activities: ActivityItem[] }>;
  onDayTap: (date: string) => void;
}) {
  const days: string[] = [];
  let d = rangeStart;
  while (d <= rangeEnd) { days.push(d); d = addDaysStr(d, 1); }
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {["M", "T", "W", "T", "F", "S", "S"].map((l, i) => (
          <div key={i} className="text-center text-[10px] font-extrabold text-sage">{l}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((date) => {
            const inMonth = date.slice(0, 7) === anchorMonth;
            const data = byDate.get(date);
            const reconciled = reconcileDay(data?.workouts || [], data?.activities || [], today);
            const items = [
              ...(data?.events || []).map((e) => ({
                title: `${e.continuation ? "⟶ " : ""}${e.title}`,
                color: categoryMeta(e.category).color,
              })),
              ...reconciled.rows.map(({ workout, state }) => ({
                title: `${state === "done" ? "✓ " : state === "missed" ? "✗ " : ""}${workout.title}`,
                color: state === "done" ? "#9ccb2e" : state === "missed" ? "#d9534c" : getWorkoutTypeColor(workout.workoutType),
              })),
              ...reconciled.extras.map((a) => ({ title: `✓ ${a.name}`, color: "#9ccb2e" })),
            ];
            const dots = items.slice(0, 4);
            const isToday = date === today;
            return (
              <button
                key={date}
                onClick={() => onDayTap(date)}
                className={`aspect-square md:aspect-[4/5] flex flex-col items-center md:items-stretch justify-start pt-1.5 md:px-1 rounded-xl transition-colors hover:bg-ghost overflow-hidden ${!inMonth ? "opacity-30" : ""}`}
              >
                <span className={`text-sm w-7 h-7 flex items-center justify-center rounded-full md:self-center flex-shrink-0 tabular-nums ${isToday ? "bg-brocco border-2 border-ink text-ink font-extrabold" : "text-ink font-bold"}`}>
                  {toDate(date).getDate()}
                </span>
                {/* Mobile: color dots (cells too small for text) */}
                <div className="flex gap-0.5 mt-0.5 md:hidden justify-center">
                  {dots.map((it, i) => (
                    <span key={i} className="w-2 h-2 rounded-full border border-ink/50" style={{ backgroundColor: it.color }} />
                  ))}
                </div>
                {/* Desktop: truncated titles */}
                <div className="hidden md:block w-full space-y-0.5 mt-0.5">
                  {items.slice(0, 2).map((it, i) => (
                    <div key={i} className="flex items-center gap-1 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full border border-ink/50 flex-shrink-0" style={{ backgroundColor: it.color }} />
                      <span className="text-[10px] text-ink font-semibold truncate text-left">{it.title}</span>
                    </div>
                  ))}
                  {items.length > 2 && (
                    <p className="text-[9px] text-sage font-bold text-left pl-2">+{items.length - 2} more</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
