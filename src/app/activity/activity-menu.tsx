"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/app/features-provider";

/**
 * The "⋯" in the detail header: Edit and Delete. Closes on Escape, on a tap
 * outside, and after picking an item.
 */
export default function ActivityMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("activity.moreActions")}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-9 h-9 flex items-center justify-center bg-card border-2 border-ink rounded-xl text-ink text-lg font-extrabold leading-none shadow-[2px_2px_0_var(--color-shade)] sticker-press"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 z-30 min-w-[10rem] bg-paper border-2 border-ink rounded-xl shadow-[3px_3px_0_var(--color-shade)] overflow-hidden"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onEdit(); }}
            className="w-full text-left px-4 py-2.5 text-sm font-bold text-ink hover:bg-ghost"
          >
            ✏️ {t("common.edit")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onDelete(); }}
            className="w-full text-left px-4 py-2.5 text-sm font-bold text-clay hover:bg-clay-soft border-t-2 border-shade"
          >
            🗑 {t("common.delete")}
          </button>
        </div>
      )}
    </div>
  );
}
