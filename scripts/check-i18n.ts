/**
 * Every dictionary key must be PRESENT in all three languages (a translation
 * may legitimately equal the English — "Strava", "Hyrox" — but it must be
 * written down, so a gap is always a deliberate omission, never an oversight).
 * Run: npx tsx scripts/check-i18n.ts — exits 1 listing the gaps. Wired into CI.
 */
import { EN, DICTS } from "../src/lib/dict";

const keys = Object.keys(EN);
let missing = 0;
for (const lang of ["de", "es"] as const) {
  const d = DICTS[lang] as Record<string, string | undefined>;
  for (const k of keys) {
    if (typeof d[k] !== "string" || d[k].trim() === "") {
      console.log(`${lang}: missing "${k}"`);
      missing++;
    }
  }
}
console.log(missing ? `\n${missing} gap(s) across ${keys.length} keys` : `OK — ${keys.length} keys in en/de/es`);
process.exit(missing ? 1 : 0);
