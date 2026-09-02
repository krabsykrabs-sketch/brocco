/**
 * Language support: English, German, Spanish.
 *
 * Two halves have to agree. The UI reads strings from `dict.ts` through the
 * `useT()` hook; Brocco is told the language in its system prompt so
 * everything it writes — chat, briefings, workout names, form cues — comes
 * back in the same language the buttons are in.
 */

export const LANGUAGES = ["en", "de", "es"] as const;
export type Lang = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
};

/** What Brocco is told to write in. */
export const LANGUAGE_FULL: Record<Lang, string> = {
  en: "English",
  de: "German (Deutsch)",
  es: "Spanish (Español)",
};

export const DEFAULT_LANG: Lang = "en";

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGUAGES as readonly string[]).includes(v);
}

export function resolveLang(v: unknown): Lang {
  return isLang(v) ? v : DEFAULT_LANG;
}

/**
 * First-run guess from the browser, so a German speaker gets German without
 * visiting Settings. Only ever a default — an explicit choice always wins.
 */
export function detectLang(): Lang {
  if (typeof navigator === "undefined") return DEFAULT_LANG;
  for (const tag of navigator.languages || [navigator.language]) {
    const base = (tag || "").slice(0, 2).toLowerCase();
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}

/**
 * Server-side counterpart of `detectLang()`: first supported language in an
 * Accept-Language header, in the order the browser listed them.
 */
export function langFromAcceptLanguage(header: string | null | undefined): Lang {
  if (!header) return DEFAULT_LANG;
  for (const part of header.split(",")) {
    const base = part.trim().split(";")[0].slice(0, 2).toLowerCase();
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}

// --- Locale-aware formatting -------------------------------------------------
//
// Dates, numbers and plurals follow the app language, not the browser's. A
// German user with an English phone still gets "Mittwoch, 2. September" and
// "12,3 km" once they've picked Deutsch.

const LOCALES: Record<Lang, string> = { en: "en-GB", de: "de-DE", es: "es-ES" };

/** BCP-47 locale for Intl formatting and speech synthesis. */
export function localeFor(lang: Lang): string {
  return LOCALES[lang];
}

/** Locale per language for SpeechSynthesis; same table as `localeFor`. */
export const SPEECH_LOCALE: Record<Lang, string> = LOCALES;

export type DateInput = Date | string | number;

/**
 * A bare "yyyy-MM-dd" is treated as local midnight (a plain `new Date()` of
 * it would be UTC and slip a day west of Greenwich); anything else is
 * whatever `Date` makes of it.
 */
function toDate(d: DateInput): Date {
  if (d instanceof Date) return d;
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(`${d}T00:00:00`);
  return new Date(d);
}

export function fmtDate(
  date: DateInput,
  lang: Lang,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string {
  return toDate(date).toLocaleDateString(localeFor(lang), opts);
}

export function fmtTime(date: DateInput, lang: Lang): string {
  return toDate(date).toLocaleTimeString(localeFor(lang), { hour: "2-digit", minute: "2-digit" });
}

/**
 * `digits` is the number of decimals shown (like `toFixed`); pass a smaller
 * `minDigits` to drop trailing zeros ("1.5 km" rather than "1.50 km").
 */
export function fmtNumber(n: number, lang: Lang, digits = 0, minDigits = digits): string {
  return n.toLocaleString(localeFor(lang), {
    minimumFractionDigits: Math.min(minDigits, digits),
    maximumFractionDigits: digits,
  });
}

const pluralRules: Partial<Record<Lang, Intl.PluralRules>> = {};

/**
 * English, German and Spanish all get by with one/many for the UI's needs
 * ("1 week" / "2 weeks", "1 Woche" / "2 Wochen", "1 día" / "2 días").
 */
export function plural(lang: Lang, n: number, one: string, many: string): string {
  const rules = (pluralRules[lang] ??= new Intl.PluralRules(localeFor(lang)));
  return rules.select(n) === "one" ? one : many;
}

/**
 * Narrow weekday labels for a Monday-first grid ("M T W T F S S" in English,
 * "L M X J V S D" in Spanish). 2024-01-01 was a Monday.
 */
export function weekdayInitials(lang: Lang): string[] {
  const f = new Intl.DateTimeFormat(localeFor(lang), { weekday: "narrow" });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2024, 0, 1 + i)));
}
