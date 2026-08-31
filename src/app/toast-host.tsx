"use client";

import { useState, useEffect, useCallback } from "react";
import { TOAST_EVENT, type AppToast } from "@/lib/toast";

/**
 * The app-wide toast surface. This used to live inside QuickCapture, which
 * was unmounted from the layout when the floating mic retired — silently
 * taking every emitToast() call (delete-undo, reminders, error feedback)
 * with it. Standalone host, mounted once in the root layout.
 */

interface Toast {
  id: number;
  text: string;
  kind: "success" | "info" | "error";
  action?: { label: string; run: () => void | Promise<void> };
}

let toastId = 0;

export default function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((text: string, kind: Toast["kind"] = "success", action?: Toast["action"]) => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-3), { id, text, kind, action }]);
    // Toasts with an action (undo) stay longer — the user needs time to react
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), action ? 7000 : 4500);
  }, []);

  useEffect(() => {
    function onToast(e: Event) {
      const t = (e as CustomEvent).detail as AppToast;
      if (t?.text) pushToast(t.text, t.kind || "success", t.action);
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, [pushToast]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed left-4 right-4 md:left-auto md:right-6 md:w-96 z-[95] flex flex-col items-stretch gap-1.5 pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 8.5rem)" }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-3.5 py-2.5 rounded-xl text-sm font-semibold border-2 border-ink shadow-[2px_2px_0_var(--color-shade)] animate-[fadeIn_0.15s_ease-out] flex items-center gap-3 ${
            t.kind === "success"
              ? "bg-sprout text-ink"
              : t.kind === "error"
              ? "bg-clay-soft text-clay"
              : "bg-paper text-ink"
          }`}
        >
          <span className="flex-1">{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                setToasts((prev) => prev.filter((x) => x.id !== t.id));
                t.action!.run();
              }}
              className="pointer-events-auto flex-shrink-0 text-xs font-semibold uppercase tracking-wide underline underline-offset-2 hover:opacity-80"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
