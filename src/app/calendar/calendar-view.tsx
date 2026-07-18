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
    return `${a.distanceKm.toFixed(1)}km${a.avgPacePerKm ? ` · ${a.avgPacePerKm.replace("/km", "")}` : ""}`;
  }
  if (a.durationMin) return `${Math.round(a.durationMin)}min`;
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
    <button onClick={onTap} className={`w-full flex items-center gap-2.5 border rounded-lg px-2.5 py-1.5 text-left transition-colors hover:brightness-110 ${event.continuation ? "opacity-80" : ""} ${meta.bg}`}>
      <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: meta.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-100 truncate">
          {event.continuation ? "⟶ " : event.category === "birthday" ? "🎂 " : ""}{event.title}
          {event.recurring && <span className="text-gray-600 ml-1">↻</span>}
        </p>
        <p className="text-[10px] text-gray-500 truncate">
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

function WorkoutChip({ workout, matched, state }: { workout: WorkoutItem; matched: ActivityItem | null; state: WorkoutState }) {
  const badge =
    state === "done" ? (
      <span className="text-[10px] font-medium text-green-950 bg-green-400/90 px-1.5 py-0.5 rounded-md flex-shrink-0 whitespace-nowrap">
        ✓ {matched ? activityDetail(matched) || "done" : "done"}
      </span>
    ) : state === "missed" ? (
      <span className="text-[10px] font-medium text-red-300 bg-red-950/70 border border-red-900/60 px-1.5 py-0.5 rounded-md flex-shrink-0 whitespace-nowrap">
        ✗ missed
      </span>
    ) : state === "today" ? (
      <span className="text-[10px] text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded-md flex-shrink-0 whitespace-nowrap">open</span>
    ) : (
      <span className="text-[9px] uppercase font-bold text-gray-600 bg-gray-800 px-1 py-0.5 rounded flex-shrink-0">plan</span>
    );

  return (
    <Link href="/plan" className="w-full flex items-center gap-2.5 bg-gray-900 border border-gray-700/60 rounded-lg px-2.5 py-1.5 hover:border-gray-600 transition-colors">
      <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }} />
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${state === "missed" ? "text-gray-400" : "text-gray-100"}`}>
          {state === "done" ? "✅ " : "🏃 "}{workout.title}
        </p>
        <p className="text-[10px] text-gray-500 truncate">
          {[workout.targetDistanceKm ? `${workout.targetDistanceKm}km` : null, workout.targetPace].filter(Boolean).join(" · ") || "training plan"}
        </p>
      </div>
      {badge}
    </Link>
  );
}

/** A completed activity with no planned workout behind it (spontaneous run, extra ride, ad-hoc session). */
function ActivityChip({ activity }: { activity: ActivityItem }) {
  return (
    <Link href="/history" className="w-full flex items-center gap-2.5 bg-green-950/40 border border-green-900/50 rounded-lg px-2.5 py-1.5 hover:border-green-700/60 transition-colors">
      <div className="w-1 self-stretch rounded-full flex-shrink-0 bg-green-400" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-green-100 truncate">✓ {activity.name}</p>
        <p className="text-[10px] text-green-700 truncate">
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

  const inputCls = "w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500";

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full md:max-w-md bg-gray-900 border border-gray-700 rounded-t-2xl md:rounded-2xl p-4 max-h-[90vh] overflow-y-auto safe-bottom">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">{form.id ? "Edit event" : "New event"}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-2.5">
          <input autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Title" className={inputCls} />

          <div className="flex gap-2">
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} className={inputCls} />
            <label className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0 px-1">
              <input type="checkbox" checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} className="accent-green-600" />
              All-day
            </label>
          </div>

          {!form.allDay && (
            <div className="flex gap-2 items-center">
              <input type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} className={inputCls} />
              <span className="text-gray-600 text-xs">to</span>
              <input type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} className={inputCls} />
            </div>
          )}

          <div className="flex gap-2 items-center">
            <span className="text-xs text-gray-500 flex-shrink-0 w-14">Ends on</span>
            <input
              type="date"
              value={form.endDate}
              min={form.date}
              onChange={(e) => set({ endDate: e.target.value })}
              className={inputCls}
              title="Leave empty for a single-day event"
            />
            {form.endDate && form.endDate !== form.date && (
              <button onClick={() => set({ endDate: "" })} className="text-xs text-gray-500 hover:text-gray-300 flex-shrink-0">clear</button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {Object.entries(EVENT_CATEGORY_META).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => set({ category: key })}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  form.category === key ? "border-transparent text-gray-950 font-semibold" : "border-gray-700 text-gray-400 hover:border-gray-500"
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
            className="w-full py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors"
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
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full md:max-w-md bg-gray-900 border border-gray-700 rounded-t-2xl md:rounded-2xl p-4 safe-bottom">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-1.5 self-stretch rounded-full" style={{ backgroundColor: meta.color }} />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-white">{occurrence.category === "birthday" ? "🎂 " : ""}{occurrence.title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {fmt(occurrence.date, { weekday: "long", day: "numeric", month: "long" })}
              {!occurrence.allDay && ` · ${occurrence.start.slice(11, 16)}${occurrence.end ? `–${occurrence.end.slice(11, 16)}` : ""}`}
              {occurrence.recurring && " · repeats"}
            </p>
            {occurrence.location && <p className="text-xs text-gray-500 mt-1">📍 {occurrence.location}</p>}
            {occurrence.notes && <p className="text-xs text-gray-400 mt-2 whitespace-pre-wrap">{occurrence.notes}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="flex gap-2">
          <button onClick={loadForEdit} disabled={busy} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm rounded-lg transition-colors disabled:opacity-50">Edit</button>
          {occurrence.recurring ? (
            <>
              <button onClick={() => handleDelete("occurrence")} disabled={busy} className="flex-1 py-2 bg-red-900/40 hover:bg-red-900/60 text-red-300 text-sm rounded-lg transition-colors disabled:opacity-50">Delete this</button>
              <button onClick={() => handleDelete("series")} disabled={busy} className="flex-1 py-2 bg-red-900/40 hover:bg-red-900/60 text-red-300 text-sm rounded-lg transition-colors disabled:opacity-50">Delete all</button>
            </>
          ) : (
            <button onClick={() => handleDelete("series")} disabled={busy} className="flex-1 py-2 bg-red-900/40 hover:bg-red-900/60 text-red-300 text-sm rounded-lg transition-colors disabled:opacity-50">Delete</button>
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
        <div className="flex items-center gap-3 py-1.5 opacity-50">
          <DayLabel date={date} isToday={isToday} />
          <div className="flex-1 border-b border-dashed border-gray-800/80" />
        </div>
      );
    }
    const { rows, extras } = reconcileDay(data.workouts, data.activities, today);
    return (
      <div className="flex gap-3 py-1.5">
        <DayLabel date={date} isToday={isToday} />
        <div className="flex-1 min-w-0 space-y-1">
          {data.events.map((e) => <EventChip key={e.occurrenceKey} event={e} onTap={() => setDetail(e)} />)}
          {rows.map(({ workout, matched, state }) => (
            <WorkoutChip key={workout.workoutId} workout={workout} matched={matched} state={state} />
          ))}
          {extras.map((a) => <ActivityChip key={a.activityId} activity={a} />)}
          {!compact && isEmpty && <p className="text-xs text-gray-600 py-2">Nothing scheduled.</p>}
        </div>
      </div>
    );
  }

  function DayLabel({ date, isToday }: { date: string; isToday: boolean }) {
    return (
      <button onClick={() => { setAnchor(date); setView("day"); }} className="w-11 flex-shrink-0 text-center pt-0.5">
        <p className={`text-[10px] font-bold uppercase ${isToday ? "text-green-400" : "text-gray-500"}`}>{fmt(date, { weekday: "short" })}</p>
        <p className={`text-lg font-bold leading-tight ${isToday ? "text-green-400" : "text-gray-300"}`}>{toDate(date).getDate()}</p>
      </button>
    );
  }

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-28 md:pb-12 flex flex-col">
      <PageHeader title="Calendar" />

      {/* View switcher + nav */}
      <div className="flex items-center justify-between mt-2 mb-1">
        <div className="flex bg-gray-900 border border-gray-800 rounded-lg p-0.5">
          {(["day", "week", "month"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs rounded-md capitalize transition-colors ${view === v ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {anchor !== today && (
            <button onClick={() => setAnchor(today)} className="px-2 py-1 text-xs text-green-400 hover:text-green-300">Today</button>
          )}
          <button onClick={() => navigate(1)} className="p-1.5 text-gray-400 hover:text-white">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={() => navigate(-1)} className="p-1.5 text-gray-400 hover:text-white">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>

      <p className="text-sm font-semibold text-white mb-2">{headerLabel}</p>

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
          <div className="divide-y divide-gray-800/40">
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
        className="fixed z-[60] w-12 h-12 rounded-full bg-gray-800 border border-gray-700 hover:bg-gray-700 shadow-xl flex items-center justify-center transition-colors"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.75rem)", right: "calc(1rem + 4.25rem)" }}
      >
        <span className="text-2xl text-gray-300 leading-none">+</span>
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
          <div key={i} className="text-center text-[10px] font-bold text-gray-600">{l}</div>
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
                color: state === "done" ? "#4ade80" : state === "missed" ? "#f87171" : getWorkoutTypeColor(workout.workoutType),
              })),
              ...reconciled.extras.map((a) => ({ title: `✓ ${a.name}`, color: "#4ade80" })),
            ];
            const dots = items.slice(0, 4);
            const isToday = date === today;
            return (
              <button
                key={date}
                onClick={() => onDayTap(date)}
                className={`aspect-square md:aspect-[4/5] flex flex-col items-center md:items-stretch justify-start pt-1.5 md:px-1 rounded-lg transition-colors hover:bg-gray-900 overflow-hidden ${!inMonth ? "opacity-30" : ""}`}
              >
                <span className={`text-sm w-7 h-7 flex items-center justify-center rounded-full md:self-center flex-shrink-0 ${isToday ? "bg-green-600 text-white font-bold" : "text-gray-300"}`}>
                  {toDate(date).getDate()}
                </span>
                {/* Mobile: color dots (cells too small for text) */}
                <div className="flex gap-0.5 mt-0.5 md:hidden justify-center">
                  {dots.map((it, i) => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: it.color }} />
                  ))}
                </div>
                {/* Desktop: truncated titles */}
                <div className="hidden md:block w-full space-y-0.5 mt-0.5">
                  {items.slice(0, 2).map((it, i) => (
                    <div key={i} className="flex items-center gap-1 min-w-0">
                      <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: it.color }} />
                      <span className="text-[10px] text-gray-400 truncate text-left">{it.title}</span>
                    </div>
                  ))}
                  {items.length > 2 && (
                    <p className="text-[9px] text-gray-600 text-left pl-2">+{items.length - 2} more</p>
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
