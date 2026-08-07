/**
 * Training equipment the athlete owns.
 *
 * Without it a coach has to guess, and both guesses are wrong: assume a full
 * gym and half the prescriptions are unusable, assume nothing and you never
 * offer the kettlebell sitting in their hallway.
 */

export const MAX_EQUIPMENT = 30;

/** Suggestions offered in the UI. Not a whitelist — anything can be typed. */
export const COMMON_EQUIPMENT = [
  "Resistance bands",
  "Balance board",
  "Kettlebell",
  "Dumbbells",
  "Barbell + plates",
  "Pull-up bar",
  "Foam roller",
  "Yoga mat",
  "Skipping rope",
  "Box / step",
  "Medicine ball",
  "TRX / suspension trainer",
  "Turbo trainer",
  "Treadmill",
  "Massage gun",
  "Gym membership",
];

/**
 * Trims, drops blanks, removes case-insensitive duplicates and caps the list.
 * Order is preserved so the athlete's own phrasing survives a round trip.
 */
export function normalizeEquipment(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const item = raw.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= MAX_EQUIPMENT) break;
  }
  return out;
}
