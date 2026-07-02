"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { emitToast } from "@/lib/toast";
import { useDataChanged } from "@/lib/capture-context";
import { useFeatures } from "./features-provider";

/**
 * In-app reminder surfacing: while the app is open, events with a reminder
 * offset fire a toast when their reminder window starts. This is the
 * spec-scoped "in-app reminder surfacing" — PWA push (reminders while the
 * app is closed) is a separate future feature.
 *
 * Times: event.start is the user's wall-clock time and the device clock IS
 * the user's clock, so plain string comparison against the local
 * "yyyy-MM-ddTHH:mm" is correct with no timezone math.
 */

interface Occurrence {
  occurrenceKey: string;
  date: string;
  start: string;
  title: string;
  allDay: boolean;
  continuation: boolean;
  reminderMinutes: number | null;
}

const HIDDEN_ON = ["/login", "/signup", "/legal"];
const STORAGE_KEY = "brocco_fired_reminders";
const REFETCH_MS = 5 * 60 * 1000;
const CHECK_MS = 30 * 1000;

function localNowString(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function minusMinutes(wall: string, minutes: number): string {
  const d = new Date(`${wall}:00`);
  d.setMinutes(d.getMinutes() - minutes);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function loadFired(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function markFired(key: string, date: string) {
  const fired = loadFired();
  fired[key] = date;
  // Prune entries older than yesterday so the map doesn't grow forever
  const today = localNowString().slice(0, 10);
  for (const [k, v] of Object.entries(fired)) {
    if (v < today) delete fired[k];
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fired));
}

export function ReminderWatcher() {
  const pathname = usePathname();
  const features = useFeatures();
  const eventsRef = useRef<Occurrence[]>([]);
  // Reminders come from calendar events — off when the calendar feature is off
  const enabled = features.calendar && !HIDDEN_ON.some((p) => pathname.startsWith(p));

  // Fetch today's events periodically (and when a capture changes the calendar)
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function fetchToday() {
      try {
        const today = localNowString().slice(0, 10);
        const res = await fetch(`/api/events?from=${today}&to=${today}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        eventsRef.current = (data.events || []) as Occurrence[];
      } catch {
        // Silent — reminders are best-effort while the app is open
      }
    }

    fetchToday();
    const interval = setInterval(fetchToday, REFETCH_MS);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useDataChanged(["calendar"], () => {
    if (!enabled) return;
    const today = localNowString().slice(0, 10);
    fetch(`/api/events?from=${today}&to=${today}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) eventsRef.current = d.events || []; })
      .catch(() => {});
  });

  // Check the reminder windows every 30s
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const now = localNowString();
      const fired = loadFired();
      for (const e of eventsRef.current) {
        if (e.reminderMinutes == null || e.allDay || e.continuation) continue;
        if (fired[e.occurrenceKey]) continue;
        const remindAt = minusMinutes(e.start, e.reminderMinutes);
        if (now >= remindAt && now < e.start) {
          const startTime = e.start.slice(11, 16);
          const minsLeft = Math.max(1, Math.round((new Date(`${e.start}:00`).getTime() - Date.now()) / 60000));
          emitToast({ text: `⏰ ${e.title} at ${startTime} (in ${minsLeft} min)`, kind: "info" });
          markFired(e.occurrenceKey, e.date);
        }
      }
    }, CHECK_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  return null;
}
