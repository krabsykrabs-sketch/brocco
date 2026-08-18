/**
 * Catches fabricated distances before they reach the athlete.
 *
 * The opener and briefing are handed a data block and asked to narrate it. The
 * failure this exists for: Brocco was given "Running this week: 12.2km of 22km
 * planned" and wrote "You hit 22.3km against 22km planned" — a number invented
 * to make the story land, not read off the data. Nothing checked it, because
 * everything else we verify goes through a tool and this is plain prose.
 *
 * The rule is deliberately narrow and mechanical: a distance in the output must
 * appear in the input. Not "be plausible", not "be close" — present. Anything
 * the coach genuinely needs to say is already in the data block, and if it
 * isn't, the honest move is to say nothing rather than estimate.
 */

// A distance, not a pace. The lookbehind keeps "5:34/km" and "6:15-6:45/km"
// out — their digits are preceded by a colon or hyphen, and "/" blocks the
// optional space — while "12.2km", "12.2 km" and "22km" all match.
const KM_PATTERN = /(?<![\d.:\-])(\d+(?:[.,]\d+)?)\s?km\b/gi;

export function extractKm(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(KM_PATTERN)) {
    const n = Number(m[1].replace(",", "."));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * True when `figure` is backed by `allowed`.
 *
 * Tolerance is 0.15 rather than something generous on purpose: the bug being
 * caught was 22.3 against a supplied 22, a gap of 0.3. Anything looser lets it
 * through. Whole numbers are additionally allowed to be a rounding of a
 * supplied decimal, so "12km" is fine when the data said 12.2.
 */
function isSupported(figure: number, allowed: number[]): boolean {
  return allowed.some(
    (a) =>
      Math.abs(figure - a) <= 0.15 ||
      (Number.isInteger(figure) && Math.round(a) === figure)
  );
}

/**
 * Distances asserted in `output` that aren't present in `source`.
 *
 * `extraAllowed` covers figures a coach may legitimately derive rather than
 * quote — most usefully the shortfall between planned and actual, which is a
 * subtraction of two supplied numbers and reads naturally as "9.8km to go".
 */
export function unsupportedKm(
  output: string,
  source: string,
  extraAllowed: number[] = []
): number[] {
  const allowed = [...extractKm(source), ...extraAllowed.filter((n) => Number.isFinite(n))];
  const bad = extractKm(output).filter((f) => !isSupported(f, allowed));
  return [...new Set(bad)];
}

/**
 * Runs `generate`, and if the result asserts a distance its source doesn't
 * support, tells the model exactly which figure was wrong and gives it one more
 * attempt. A second failure returns `null` so the caller can fall back to
 * something deterministic — better a plain templated line than a confident
 * wrong number.
 */
export async function generateNumberChecked(
  source: string,
  extraAllowed: number[],
  label: string,
  generate: (correction: string | null) => Promise<string>
): Promise<string | null> {
  const first = await generate(null);
  let bad = unsupportedKm(first, source, extraAllowed);
  if (bad.length === 0) return first;

  console.warn(`[${label}] fabricated distance(s) ${bad.join(", ")}km — retrying`);
  const correction =
    `Your previous draft stated ${bad.map((b) => `${b}km`).join(", ")}, which does not appear in the data above. ` +
    `Do not calculate or estimate distances. Use only the figures given, exactly as written, or omit the number entirely.`;

  const second = await generate(correction);
  bad = unsupportedKm(second, source, extraAllowed);
  if (bad.length === 0) return second;

  console.warn(`[${label}] still fabricating ${bad.join(", ")}km after retry — falling back`);
  return null;
}
