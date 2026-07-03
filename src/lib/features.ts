/**
 * Life-planner feature toggles. A user who only wants the running coach can
 * disable calendar/tasks/notes/journal/kitchen in Settings — navigation, the
 * Today screen, the briefing, and Brocco's tools all adapt, restoring the
 * classic coach-only experience. Stored in user_profiles.features (jsonb);
 * null or missing keys mean enabled, so existing users see no change.
 */

export interface Features {
  calendar: boolean;
  tasks: boolean;
  notes: boolean;
  journal: boolean;
  kitchen: boolean;
}

export const ALL_FEATURES: Features = {
  calendar: true,
  tasks: true,
  notes: true,
  journal: true,
  kitchen: true,
};

export function resolveFeatures(raw: unknown): Features {
  if (!raw || typeof raw !== "object") return { ...ALL_FEATURES };
  const r = raw as Record<string, unknown>;
  return {
    calendar: r.calendar !== false,
    tasks: r.tasks !== false,
    notes: r.notes !== false,
    journal: r.journal !== false,
    kitchen: r.kitchen !== false,
  };
}

export function anyLifeFeature(f: Features): boolean {
  return f.calendar || f.tasks || f.notes || f.journal || f.kitchen;
}
