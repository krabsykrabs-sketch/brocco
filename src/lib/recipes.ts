/**
 * Shared recipe validation + serialization — used by the API routes, the
 * photo-scan extraction, and Brocco's manage_recipe tool.
 */

export interface RecipeInput {
  title: string;
  ingredients: string[];
  steps: string[];
  tags: string[];
  servings: number | null;
  timeMin: number | null;
  notes: string | null;
}

const LIMITS = {
  title: 120,
  ingredients: 60,
  ingredientLen: 200,
  steps: 40,
  stepLen: 1000,
  tags: 10,
  tagLen: 30,
  notes: 2000,
  servingsMax: 100,
  timeMinMax: 1440,
};

/**
 * Validation failures are CODES (plus the limit that was crossed) — the API
 * routes translate them for the kitchen screen with `api.validation.recipe.*`,
 * while the model-facing tool renders them in English via
 * `describeRecipeValidation`.
 */
export type RecipeValidationCode =
  | "titleRequired"
  | "ingredientsRequired"
  | "stepsRequired"
  | "servingsRange"
  | "timeMinRange";

export interface RecipeValidationError {
  ok: false;
  code: RecipeValidationCode;
  vars: { min?: number; max?: number };
}

const RECIPE_VALIDATION_EN: Record<RecipeValidationCode, string> = {
  titleRequired: "title is required (max {max} chars)",
  ingredientsRequired: "ingredients must be a non-empty array of strings",
  stepsRequired: "steps must be a non-empty array of strings",
  servingsRange: "servings must be an integer {min}-{max}",
  timeMinRange: "timeMin must be {min}-{max}",
};

/** English rendering for the model (tool errors) and server logs. */
export function describeRecipeValidation(err: RecipeValidationError): string {
  return RECIPE_VALIDATION_EN[err.code].replace(/\{(\w+)\}/g, (m, k: string) =>
    k in err.vars ? String(err.vars[k as keyof typeof err.vars]) : m
  );
}

export function validateRecipeInput(
  raw: Record<string, unknown>
): { ok: true; recipe: RecipeInput } | RecipeValidationError {
  const title = String(raw.title || "").trim();
  if (!title || title.length > LIMITS.title) {
    return { ok: false, code: "titleRequired", vars: { max: LIMITS.title } };
  }

  if (!Array.isArray(raw.ingredients) || raw.ingredients.length === 0) {
    return { ok: false, code: "ingredientsRequired", vars: {} };
  }
  const ingredients = raw.ingredients
    .map((i) => String(i).trim())
    .filter(Boolean)
    .slice(0, LIMITS.ingredients)
    .map((i) => i.slice(0, LIMITS.ingredientLen));
  if (ingredients.length === 0) return { ok: false, code: "ingredientsRequired", vars: {} };

  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    return { ok: false, code: "stepsRequired", vars: {} };
  }
  const steps = raw.steps
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, LIMITS.steps)
    .map((s) => s.slice(0, LIMITS.stepLen));
  if (steps.length === 0) return { ok: false, code: "stepsRequired", vars: {} };

  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, LIMITS.tags).map((t) => t.slice(0, LIMITS.tagLen))
    : [];

  const servings = raw.servings == null ? null : Number(raw.servings);
  if (servings != null && (!Number.isInteger(servings) || servings < 1 || servings > LIMITS.servingsMax)) {
    return { ok: false, code: "servingsRange", vars: { min: 1, max: LIMITS.servingsMax } };
  }
  const timeMin = raw.timeMin == null ? null : Number(raw.timeMin);
  if (timeMin != null && (!Number.isFinite(timeMin) || timeMin < 1 || timeMin > LIMITS.timeMinMax)) {
    return { ok: false, code: "timeMinRange", vars: { min: 1, max: LIMITS.timeMinMax } };
  }

  const notes = raw.notes != null ? String(raw.notes).trim().slice(0, LIMITS.notes) || null : null;

  return {
    ok: true,
    recipe: { title, ingredients, steps, tags, servings, timeMin: timeMin != null ? Math.round(timeMin) : null, notes },
  };
}

/**
 * Pantry staples — ingredients the user always has in stock, stored on
 * UserProfile.pantryStaples and assumed available in every recipe suggestion.
 * Normalize: trim, cap length, dedupe case-insensitively, keep user casing.
 */
export function normalizeStaples(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = String(item).trim().slice(0, 60);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 100) break;
  }
  return out;
}

/**
 * Word-wise recipe matcher: every word of the query must appear somewhere in
 * the title, tags, or ingredients. "eggs tomatoes feta" finds shakshuka;
 * a single substring match would find nothing.
 */
export function recipeMatches(
  r: { title: string; tags: string[]; ingredients: unknown },
  query: string
): boolean {
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [r.title, ...r.tags, ...(((r.ingredients as string[]) || []))].join(" ").toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function serializeRecipe(r: {
  id: string;
  title: string;
  ingredients: unknown;
  steps: unknown;
  tags: string[];
  servings: number | null;
  timeMin: number | null;
  source: string;
  notes: string | null;
  timesCooked: number;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    title: r.title,
    ingredients: (r.ingredients as string[]) || [],
    steps: (r.steps as string[]) || [],
    tags: r.tags,
    servings: r.servings,
    timeMin: r.timeMin,
    source: r.source,
    notes: r.notes,
    timesCooked: r.timesCooked,
    updatedAt: r.updatedAt.toISOString(),
  };
}
