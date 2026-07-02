/**
 * Life-planner feature toggles. A user who only wants the running coach can
 * disable calendar/tasks/notes in Settings — navigation, the Today screen,
 * the briefing, and Brocco's tools all adapt, restoring the classic
 * coach-only experience. Stored in user_profiles.features (jsonb); null or
 * missing keys mean enabled, so existing users see no change.
 */

export interface Features {
  calendar: boolean;
  tasks: boolean;
  notes: boolean;
}

export const ALL_FEATURES: Features = { calendar: true, tasks: true, notes: true };

export function resolveFeatures(raw: unknown): Features {
  if (!raw || typeof raw !== "object") return { ...ALL_FEATURES };
  const r = raw as Record<string, unknown>;
  return {
    calendar: r.calendar !== false,
    tasks: r.tasks !== false,
    notes: r.notes !== false,
  };
}

export function anyLifeFeature(f: Features): boolean {
  return f.calendar || f.tasks || f.notes;
}
