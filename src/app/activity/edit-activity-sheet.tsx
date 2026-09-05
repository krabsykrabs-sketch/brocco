"use client";

import { useEffect, useState } from "react";
import { useT } from "@/app/features-provider";
import { emitToast } from "@/lib/toast";
import { emitDataChanged } from "@/lib/capture-context";
import RpePills from "./rpe-pills";
import { EDITABLE_ACTIVITY_TYPES } from "./activity-type-options";

export interface EditableActivity {
  id: string;
  name: string;
  activityType: string;
  distanceKm: number | null;
  durationMin: number;
  perceivedEffort: number | null;
  notes: string | null;
}

/**
 * Bottom sheet for correcting a logged session. Sends only the fields the
 * user actually changed; the API answers with the fresh row and the page
 * swaps it in — no refetch round-trip.
 */
export default function EditActivitySheet<T extends EditableActivity>({
  activity,
  onClose,
  onSaved,
}: {
  activity: T;
  onClose: () => void;
  onSaved: (updated: T) => void;
}) {
  const t = useT();
  const [name, setName] = useState(activity.name);
  const [type, setType] = useState(activity.activityType);
  const initialDistance = activity.distanceKm != null ? String(activity.distanceKm) : "";
  const initialDuration = String(Math.round(activity.durationMin));
  const [distance, setDistance] = useState(initialDistance);
  const [duration, setDuration] = useState(initialDuration);
  const [rpe, setRpe] = useState<number | null>(activity.perceivedEffort);
  const [notes, setNotes] = useState(activity.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The current type may be one we don't offer (an exotic Strava sport) —
  // keep it selectable so saving never silently changes it.
  const typeOptions = EDITABLE_ACTIVITY_TYPES.includes(activity.activityType)
    ? EDITABLE_ACTIVITY_TYPES
    : [activity.activityType, ...EDITABLE_ACTIVITY_TYPES];

  async function handleSave() {
    const patch: Record<string, unknown> = {};
    if (name.trim() !== activity.name) patch.name = name.trim();
    if (type !== activity.activityType) patch.activityType = type;
    // Only fields the user actually touched go out — a 45.37-minute session
    // must not get rounded to 45 just because the name was corrected.
    if (distance.trim() !== initialDistance) {
      patch.distanceKm = distance.trim() === "" ? null : Number(distance.replace(",", "."));
    }
    if (duration.trim() !== initialDuration) patch.durationMin = Number(duration.replace(",", "."));
    if (rpe !== activity.perceivedEffort) patch.perceivedEffort = rpe;
    if ((notes.trim() || null) !== (activity.notes || null)) patch.notes = notes.trim() || null;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/activities/${activity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t("activity.saveFailed"));
        return;
      }
      emitToast({ text: t("common.saved"), kind: "success" });
      emitDataChanged(["activities"]);
      onSaved(data.activity as T);
      onClose();
    } catch {
      setError(t("activity.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("activity.editSession")}
        className="relative w-full md:max-w-lg bg-paper border-2 border-ink rounded-t-2xl md:rounded-2xl md:shadow-[4px_4px_0_var(--color-shade)] max-h-[92vh] flex flex-col safe-bottom"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h2 className="text-sm font-extrabold text-ink">{t("activity.editSession")}</h2>
          <button onClick={onClose} className="text-moss hover:text-ink text-xl leading-none" aria-label={t("common.close")}>&times;</button>
        </div>

        <div className="px-4 pb-4 overflow-y-auto space-y-3">
          <div>
            <label className="label-xs block mb-1" htmlFor="act-name">{t("activity.nameLabel")}</label>
            <input id="act-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="field" />
          </div>

          <div>
            <label className="label-xs block mb-1" htmlFor="act-type">{t("activity.typeLabel")}</label>
            <select id="act-type" value={type} onChange={(e) => setType(e.target.value)} className="field">
              {typeOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label-xs block mb-1" htmlFor="act-dist">{t("activity.distanceKmLabel")}</label>
              <input
                id="act-dist"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                max={500}
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label className="label-xs block mb-1" htmlFor="act-dur">{t("activity.durationMinLabel")}</label>
              <input
                id="act-dur"
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="field"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="label-xs">{t("activity.rpeLabel")}</span>
              {rpe != null && (
                <button type="button" onClick={() => setRpe(null)} className="text-[11px] text-sage font-bold underline">
                  {t("activity.rpeClear")}
                </button>
              )}
            </div>
            <RpePills value={rpe} onChange={setRpe} />
          </div>

          <div>
            <label className="label-xs block mb-1" htmlFor="act-notes">{t("activity.notesLabel")}</label>
            <textarea
              id="act-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={t("activity.notesPlaceholder")}
              className="field"
            />
          </div>

          {error && <p className="text-xs text-clay font-semibold">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="btn-quiet px-4 py-2.5 text-sm">{t("common.cancel")}</button>
            <button onClick={handleSave} disabled={saving || !name.trim()} className="btn-brocco flex-1 py-2.5 text-sm">
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
