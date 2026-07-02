"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { ALL_FEATURES, resolveFeatures, type Features } from "@/lib/features";

/**
 * Client-side source of truth for the feature toggles. Cached in
 * localStorage so navigation doesn't flicker between the default and the
 * user's actual configuration on each load; refreshed from the server on
 * mount and whenever Settings saves a change (FEATURES_CHANGED_EVENT).
 */

const STORAGE_KEY = "brocco_features";
export const FEATURES_CHANGED_EVENT = "brocco:features-changed";

const FeaturesContext = createContext<Features>(ALL_FEATURES);

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

  useEffect(() => {
    setFeatures(loadCached());

    let cancelled = false;
    function refresh() {
      fetch("/api/features")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d?.features) return;
          const resolved = resolveFeatures(d.features);
          setFeatures(resolved);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(resolved)); } catch { /* full/blocked */ }
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

  return <FeaturesContext.Provider value={features}>{children}</FeaturesContext.Provider>;
}

export function useFeatures(): Features {
  return useContext(FeaturesContext);
}
