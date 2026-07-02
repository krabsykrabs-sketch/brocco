"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { emitDataChanged } from "@/lib/capture-context";

const STORAGE_KEY = "brocco_strava_sync_date";
const HIDDEN_ON = ["/login", "/signup", "/legal"];

/**
 * Fires once per app load, throttled to once per local calendar day.
 * The server (/api/strava/auto-sync) is the authoritative gate — this
 * localStorage check just skips the round-trip on repeat opens same day.
 * Silent by design: no loading state, no error UI. Renders nothing.
 */
export function StravaAutoSync() {
  const pathname = usePathname();

  useEffect(() => {
    if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return;

    const todayStr = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(STORAGE_KEY) === todayStr) return;

    let cancelled = false;
    fetch("/api/strava/auto-sync")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        localStorage.setItem(STORAGE_KEY, todayStr);
        if (data.ok && data.newCount > 0) {
          emitDataChanged(["activities", "plan", "calendar"]);
        }
      })
      .catch(() => {
        // Silent — this is a background convenience sync, not user-initiated
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
