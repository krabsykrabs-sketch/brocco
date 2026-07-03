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

export function validateRecipeInput(
  raw: Record<string, unknown>
): { ok: true; recipe: RecipeInput } | { ok: false; error: string } {
  const title = String(raw.title || "").trim();
  if (!title || title.length > LIMITS.title) {
    return { ok: false, error: `title is required (max ${LIMITS.title} chars)` };
  }

  if (!Array.isArray(raw.ingredients) || raw.ingredients.length === 0) {
    return { ok: false, error: "ingredients must be a non-empty array of strings" };
  }
  const ingredients = raw.ingredients
    .map((i) => String(i).trim())
    .filter(Boolean)
    .slice(0, LIMITS.ingredients)
    .map((i) => i.slice(0, LIMITS.ingredientLen));
  if (ingredients.length === 0) return { ok: false, error: "ingredients must be a non-empty array of strings" };

  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    return { ok: false, error: "steps must be a non-empty array of strings" };
  }
  const steps = raw.steps
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, LIMITS.steps)
    .map((s) => s.slice(0, LIMITS.stepLen));
  if (steps.length === 0) return { ok: false, error: "steps must be a non-empty array of strings" };

  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, LIMITS.tags).map((t) => t.slice(0, LIMITS.tagLen))
    : [];

  const servings = raw.servings == null ? null : Number(raw.servings);
  if (servings != null && (!Number.isInteger(servings) || servings < 1 || servings > LIMITS.servingsMax)) {
    return { ok: false, error: "servings must be an integer 1-100" };
  }
  const timeMin = raw.timeMin == null ? null : Number(raw.timeMin);
  if (timeMin != null && (!Number.isFinite(timeMin) || timeMin < 1 || timeMin > LIMITS.timeMinMax)) {
    return { ok: false, error: "timeMin must be 1-1440" };
  }

  const notes = raw.notes != null ? String(raw.notes).trim().slice(0, LIMITS.notes) || null : null;

  return {
    ok: true,
    recipe: { title, ingredients, steps, tags, servings, timeMin: timeMin != null ? Math.round(timeMin) : null, notes },
  };
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
