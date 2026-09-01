"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { ALL_FEATURES, resolveFeatures, type Features } from "@/lib/features";
import { DEFAULT_LANG, detectLang, resolveLang, isLang, type Lang } from "@/lib/i18n";
import { translator, type DictKey } from "@/lib/dict";

/**
 * Client-side source of truth for the feature toggles. Cached in
 * localStorage so navigation doesn't flicker between the default and the
 * user's actual configuration on each load; refreshed from the server on
 * mount and whenever Settings saves a change (FEATURES_CHANGED_EVENT).
 */

const STORAGE_KEY = "brocco_features";
export const FEATURES_CHANGED_EVENT = "brocco:features-changed";

const FeaturesContext = createContext<Features>(ALL_FEATURES);
const LangContext = createContext<Lang>(DEFAULT_LANG);

const LANG_KEY = "brocco_lang";

function loadCachedLang(): Lang {
  try {
    const raw = localStorage.getItem(LANG_KEY);
    // No stored choice yet: guess from the browser, which is what a German
    // speaker expects on first open. The server value overrides on arrival.
    return raw ? resolveLang(raw) : detectLang();
  } catch {
    return DEFAULT_LANG;
  }
}

function loadCached(): Features {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? resolveFeatures(JSON.parse(raw)) : { ...ALL_FEATURES };
  } catch {
    return { ...ALL_FEATURES };
  }
}

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  // Server render uses defaults; the cached value applies after hydration
  const [features, setFeatures] = useState<Features>(ALL_FEATURES);
  // Server render is always the default language; the real one applies after
  // hydration, which keeps the markup deterministic.
  const [lang, setLang] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    setFeatures(loadCached());
    setLang(loadCachedLang());

    let cancelled = false;
    function refresh() {
      fetch("/api/features")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d?.features) return;
          const resolved = resolveFeatures(d.features);
          setFeatures(resolved);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(resolved)); } catch { /* full/blocked */ }
          // A stored choice wins; null means the user never picked one, so the
          // browser guess stands and nothing is cached over it.
          if (isLang(d.language)) {
            setLang(d.language);
            try { localStorage.setItem(LANG_KEY, d.language); } catch { /* full/blocked */ }
          }
        })
        .catch(() => {});
    }

    refresh();
    window.addEventListener(FEATURES_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(FEATURES_CHANGED_EVENT, refresh);
    };
  }, []);

  return (
    <FeaturesContext.Provider value={features}>
      <LangContext.Provider value={lang}>{children}</LangContext.Provider>
    </FeaturesContext.Provider>
  );
}

export function useFeatures(): Features {
  return useContext(FeaturesContext);
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/** UI string lookup in the active language. `const t = useT()` then `t("nav.today")`. */
export function useT(): (key: DictKey) => string {
  const lang = useContext(LangContext);
  return translator(lang);
}
