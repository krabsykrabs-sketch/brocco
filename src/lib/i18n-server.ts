import { prisma } from "@/lib/db";
import { translator, type DictKey } from "@/lib/dict";
import { DEFAULT_LANG, isLang, langFromAcceptLanguage, resolveLang, type Lang } from "@/lib/i18n";

/**
 * Server-side translation. Routes and background jobs produce a few strings
 * the user sees verbatim — error messages the client displays, persisted
 * fallback prose, push notifications, sync-health lines — and those must
 * come out in the language the user chose in Settings, not in English.
 *
 * `{name}` placeholders in a dictionary string are filled from `vars`.
 * Nothing here is for model prompts — those stay English on purpose.
 */

export type Vars = Record<string, string | number>;
export type ServerT = (key: DictKey, vars?: Vars) => string;

export function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

export function serverTranslator(lang: Lang): ServerT {
  const t = translator(lang);
  return (key, vars) => fill(t(key), vars);
}

/**
 * The user's chosen language. Never throws — a failing lookup (or a DB that
 * is the very thing that just failed) must not turn an error response into
 * a crash; English is the fallback.
 */
export async function userLang(userId: string): Promise<Lang> {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { language: true },
    });
    return resolveLang(profile?.language);
  } catch {
    return DEFAULT_LANG;
  }
}

export async function userTranslator(userId: string): Promise<ServerT> {
  return serverTranslator(await userLang(userId));
}

/**
 * For routes with no signed-in user (login, signup, password reset): an
 * explicit `x-lang` header wins (the client knows what the user picked,
 * even before login), otherwise the browser's Accept-Language.
 */
export function requestLang(request: Request): Lang {
  const explicit = request.headers.get("x-lang");
  if (isLang(explicit)) return explicit;
  return langFromAcceptLanguage(request.headers.get("accept-language"));
}

export function requestTranslator(request: Request): ServerT {
  return serverTranslator(requestLang(request));
}
