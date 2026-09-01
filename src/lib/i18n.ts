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
