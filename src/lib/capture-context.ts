"use client";

import { useEffect } from "react";

/**
 * Lightweight client-side store for "what screen is the user looking at".
 * Pages register their context; the quick-capture mic reads it at capture time
 * and sends it along to /api/capture so Brocco can resolve "move that to 5".
 */

export interface ScreenContext {
  name: string; // today | calendar | tasks | plan | notes | history | ...
  view?: string; // day | week | month | today-list | list:<name> ...
  rangeStart?: string; // yyyy-MM-dd
  rangeEnd?: string;
  selectedItem?: { type: string; id: string; title?: string; date?: string };
}

let current: ScreenContext | null = null;

export function setScreenContext(ctx: ScreenContext | null) {
  current = ctx;
}

export function getScreenContext(): ScreenContext | null {
  return current;
}

/** Register the current screen's context while the component is mounted. */
export function useScreenContext(ctx: ScreenContext, deps: unknown[] = []) {
  useEffect(() => {
    setScreenContext(ctx);
    return () => {
      if (current === ctx) current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Domains whose data changed after a capture — pages listen and refetch. */
export const DATA_CHANGED_EVENT = "brocco:data-changed";

export function emitDataChanged(domains: string[]) {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { domains } }));
}

export function useDataChanged(domains: string[], onChange: () => void) {
  useEffect(() => {
    function handler(e: Event) {
      const changed: string[] = (e as CustomEvent).detail?.domains || [];
      if (changed.some((d) => domains.includes(d))) onChange();
    }
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);
}
