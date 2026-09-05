"use client";

import { useEffect, useState } from "react";
import { useT } from "@/app/features-provider";

/** Confirm before a session leaves history for good. */
export default function DeleteActivitySheet({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={busy ? undefined : onClose} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={t("activity.deleteTitle")}
        className="relative w-full md:max-w-md bg-paper border-2 border-ink rounded-t-2xl md:rounded-2xl md:shadow-[4px_4px_0_var(--color-shade)] px-4 pt-4 pb-4 safe-bottom"
      >
        <h2 className="text-sm font-extrabold text-ink mb-1">{t("activity.deleteTitle")}</h2>
        <p className="text-sm text-moss font-semibold mb-4">{t("activity.deleteBody")}</p>
        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className="btn-quiet px-4 py-2.5 text-sm">{t("common.cancel")}</button>
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="btn-danger flex-1 py-2.5 text-sm disabled:opacity-50"
          >
            {busy ? t("activity.deleting") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
