/**
 * Life-planner feature toggles. A user who only wants the running coach can
 * disable calendar/notes/kitchen in Settings — navigation, the Today screen,
 * the briefing, and Brocco's tools all adapt, restoring the classic
 * coach-only experience. Stored in user_profiles.features (jsonb);
 * null or missing keys mean enabled, so existing users see no change.
 *
 * Retired July 2026: `tasks` and `journal` were removed from the app
 * entirely (todos/journal_entries tables remain in the DB, untouched).
 * Stale keys in stored feature JSON are simply ignored here.
 */

export interface Features {
  calendar: boolean;
  notes: boolean;
  kitchen: boolean;
}

export const ALL_FEATURES: Features = {
  calendar: true,
  notes: true,
  kitchen: true,
};

export function resolveFeatures(raw: unknown): Features {
  if (!raw || typeof raw !== "object") return { ...ALL_FEATURES };
  const r = raw as Record<string, unknown>;
  return {
    calendar: r.calendar !== false,
    notes: r.notes !== false,
    kitchen: r.kitchen !== false,
  };
}

export function anyLifeFeature(f: Features): boolean {
  return f.calendar || f.notes || f.kitchen;
}
