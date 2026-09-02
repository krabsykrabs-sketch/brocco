"use client";

import { useState } from "react";
import { useT } from "@/app/features-provider";
import { emitToast } from "@/lib/toast";
import { emitDataChanged } from "@/lib/capture-context";

/**
 * Done / Skipped for a planned session the app cannot detect by itself.
 * Self-contained: posts the answer and broadcasts a data change, so it can
 * sit inside any row (even a Link — clicks never bubble out) and every
 * screen refetches on its own.
 */
export function ResolveButtons({ workoutId, compact = false }: { workoutId: string; compact?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState<"done" | "skipped" | null>(null);

  async function resolve(outcome: "done" | "skipped") {
    setBusy(outcome);
    try {
      const res = await fetch(`/api/workouts/${workoutId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      if (!res.ok) throw new Error();
      emitToast({
        text: outcome === "done" ? t("confirm.markedDone") : t("confirm.markedSkipped"),
        kind: outcome === "done" ? "success" : "info",
      });
      emitDataChanged(["activities", "plan"]);
    } catch {
      emitToast({ text: t("common.somethingWrong"), kind: "error" });
    } finally {
      setBusy(null);
    }
  }

  const size = compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";
  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <button onClick={() => resolve("done")} disabled={busy !== null} className={`btn-brocco ${size} disabled:opacity-50`}>
        ✓ {busy === "done" ? "…" : t("confirm.done")}
      </button>
      <button onClick={() => resolve("skipped")} disabled={busy !== null} className={`btn-quiet ${size} disabled:opacity-50`}>
        {busy === "skipped" ? "…" : t("confirm.skipped")}
      </button>
    </div>
  );
}
