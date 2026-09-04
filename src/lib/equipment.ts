/**
 * Training equipment the athlete owns.
 *
 * Without it a coach has to guess, and both guesses are wrong: assume a full
 * gym and half the prescriptions are unusable, assume nothing and you never
 * offer the kettlebell sitting in their hallway.
 */

import type { DictKey } from "@/lib/dict";

export const MAX_EQUIPMENT = 30;

/**
 * Suggestions offered in the UI, keyed by the English name that gets SAVED
 * (Brocco reads the list in the prompt, so the stored value stays English)
 * mapped to the dictionary key that gets SHOWN. Not a whitelist — anything
 * can be typed.
 */
export const COMMON_EQUIPMENT_KEYS: Record<string, DictKey> = {
  "Resistance bands": "equipment.resistanceBands",
  "Balance board": "equipment.balanceBoard",
  "Kettlebell": "equipment.kettlebell",
  "Dumbbells": "equipment.dumbbells",
  "Barbell + plates": "equipment.barbellPlates",
  "Pull-up bar": "equipment.pullUpBar",
  "Foam roller": "equipment.foamRoller",
  "Yoga mat": "equipment.yogaMat",
  "Skipping rope": "equipment.skippingRope",
  "Box / step": "equipment.boxStep",
  "Medicine ball": "equipment.medicineBall",
  "TRX / suspension trainer": "equipment.trx",
  "Turbo trainer": "equipment.turboTrainer",
  "Treadmill": "equipment.treadmill",
  "Massage gun": "equipment.massageGun",
  "Gym membership": "equipment.gymMembership",
};

/** The suggestion list in stored (English) form. */
export const COMMON_EQUIPMENT = Object.keys(COMMON_EQUIPMENT_KEYS);

/**
 * Chip label for an equipment item: a suggestion is shown translated, the
 * athlete's own free text as typed. `t` is the app's translator (useT()).
 */
export function equipmentLabel(item: string, t: (key: DictKey) => string): string {
  const key = COMMON_EQUIPMENT_KEYS[item]
    ?? Object.entries(COMMON_EQUIPMENT_KEYS).find(([k]) => k.toLowerCase() === item.toLowerCase())?.[1];
  return key ? t(key) : item;
}

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
