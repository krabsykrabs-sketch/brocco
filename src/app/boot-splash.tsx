"use client";

import { useState, useEffect } from "react";

/**
 * Branded boot splash: the full-body runner shown the moment the app opens,
 * fading out once the app has hydrated. Server-rendered visible so it paints
 * before any JS runs — that's what makes it a real loading screen rather
 * than a post-load flourish. Shows once per browser session (PWA launch or
 * first tab load); SPA navigations never remount the root layout, so it
 * doesn't reappear while using the app.
 */
export function BootSplash() {
  const [phase, setPhase] = useState<"visible" | "hiding" | "gone">("visible");

  useEffect(() => {
    if (sessionStorage.getItem("brocco_booted")) {
      // Reload mid-session: skip the ceremony immediately
      setPhase("gone");
      return;
    }
    sessionStorage.setItem("brocco_booted", "1");
    const hide = setTimeout(() => setPhase("hiding"), 900);
    const gone = setTimeout(() => setPhase("gone"), 1450);
    return () => {
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      className={`fixed inset-0 z-[200] bg-gray-950 flex flex-col items-center justify-center transition-opacity duration-500 ${
        phase === "hiding" ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/brocco-runner.png" alt="" className="h-44 boot-splash-run" />
      <p className="mt-6 text-2xl font-bold text-white">brocco.run</p>
      <p className="text-xs text-gray-500 mt-1">Run like a broccoli.</p>
    </div>
  );
}
