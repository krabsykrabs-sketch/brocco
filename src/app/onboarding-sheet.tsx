"use client";

import { useState } from "react";
import { FEATURES_CHANGED_EVENT, useT } from "@/app/features-provider";
import { LANGUAGES, LANGUAGE_NAMES, detectLang, type Lang } from "@/lib/i18n";
import TimezonePicker from "@/app/timezone-picker";

/**
 * First-run sheet on Today: language, main sport, timezone (+ Strava).
 * Without it every new account is an English-speaking Berlin runner until
 * they stumble on Settings. No close button and Escape does nothing — the
 * only ways out are finishing or "Later" on the Strava card, both of which
 * mark onboarding complete so the sheet never comes back.
 */

// Same list as Settings' PRIMARY_SPORTS ("" = running default → null).
const SPORTS: Array<{ value: string; emoji: string; key: string }> = [
  { value: "", emoji: "🏃", key: "sport.running" },
  { value: "climbing", emoji: "🧗", key: "sport.climbing" },
  { value: "cycling", emoji: "🚴", key: "sport.cycling" },
  { value: "swimming", emoji: "🏊", key: "sport.swimming" },
  { value: "triathlon", emoji: "🏅", key: "sport.triathlon" },
  { value: "hyrox", emoji: "🏋️", key: "sport.hyrox" },
];

const STEPS = 3;
const FALLBACK_TZ = "Europe/Berlin";

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}

export default function OnboardingSheet({ onDone }: { onDone: () => void }) {
  const t = useT();
  type K = Parameters<typeof t>[0];
  const [step, setStep] = useState(0);
  const [lang, setLangChoice] = useState<Lang>(() => detectLang());
  const [sport, setSport] = useState("");
  const [timezone, setTimezone] = useState(deviceTimezone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  /** Mirrors Settings' handleLanguageChange so the sheet re-renders in the new language at once. */
  async function chooseLanguage(next: Lang) {
    setLangChoice(next);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: next }),
      });
      if (!res.ok) throw new Error();
      try { localStorage.setItem("brocco_lang", next); } catch { /* full/blocked */ }
      window.dispatchEvent(new Event(FEATURES_CHANGED_EVENT));
    } catch {
      /* keep the optimistic value; the final PUT sends the language again */
    }
  }

  /** The one write that ends onboarding. Returns false when it failed (the sheet stays). */
  async function finish(): Promise<boolean> {
    setSaving(true);
    setError(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone, primarySport: sport, language: lang, onboardingCompleted: true }),
      });
      if (!res.ok) throw new Error();
      return true;
    } catch {
      setError(true);
      setSaving(false);
      return false;
    }
  }

  async function handleFinish() {
    if (await finish()) onDone();
  }

  // Complete onboarding BEFORE leaving for Strava's OAuth page, otherwise the
  // sheet would greet the athlete again the moment they come back.
  async function handleConnectStrava() {
    if (await finish()) window.location.href = "/api/strava/auth?returnTo=/today";
  }

  const titles: K[] = ["onboarding.languageTitle", "onboarding.sportTitle", "onboarding.timezoneTitle"];

  return (
    <div className="fixed inset-0 z-[90] flex items-end md:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="absolute inset-0 bg-ink/40" />
      <div className="relative w-full md:max-w-lg bg-paper border-2 border-ink rounded-t-2xl md:rounded-2xl md:shadow-[4px_4px_0_var(--color-shade)] h-[92vh] md:h-auto md:max-h-[92vh] flex flex-col safe-bottom">
        {/* Header + progress */}
        <div className="px-5 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-3 mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-64.png" alt="" className="w-9 h-9 flex-shrink-0 rounded-full border-2 border-ink" />
            <div className="flex-1 min-w-0">
              <p className="label-xs">{t("onboarding.welcome")}</p>
              <p className="text-xs text-moss font-semibold">{t("onboarding.stepOf").replace("{n}", String(step + 1)).replace("{total}", String(STEPS))}</p>
            </div>
          </div>
          <div className="flex gap-1.5" aria-hidden="true">
            {Array.from({ length: STEPS }, (_, i) => (
              <div key={i} className={`h-2 flex-1 rounded-full border-2 border-ink ${i <= step ? "bg-brocco" : "bg-ghost"}`} />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 pb-4 overflow-y-auto flex-1">
          <h2 id="onboarding-title" className="text-lg font-extrabold text-ink mb-1">{t(titles[step])}</h2>

          {step === 0 && (
            <>
              <p className="text-sm text-moss font-semibold mb-4">{t("onboarding.languageHint")}</p>
              <div className="space-y-2.5">
                {LANGUAGES.map((code) => {
                  const active = code === lang;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => chooseLanguage(code)}
                      aria-pressed={active}
                      className={`sticker sticker-press w-full flex items-center justify-between px-4 py-4 text-left ${active ? "bg-sprout" : ""}`}
                    >
                      <span className="text-base font-extrabold text-ink">{LANGUAGE_NAMES[code]}</span>
                      {active && <span className="text-leaf font-extrabold">✓</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-sm text-moss font-semibold mb-4">{t("onboarding.sportHint")}</p>
              <div className="grid grid-cols-2 gap-2.5">
                {SPORTS.map((s) => {
                  const active = s.value === sport;
                  return (
                    <button
                      key={s.value || "running"}
                      type="button"
                      onClick={() => setSport(s.value)}
                      aria-pressed={active}
                      className={`sticker sticker-press flex flex-col items-center gap-1.5 px-3 py-4 ${active ? "bg-sprout" : ""}`}
                    >
                      <span className="text-3xl leading-none">{s.emoji}</span>
                      <span className="text-sm font-extrabold text-ink">{t(s.key as K)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-moss font-semibold mb-3">{t("onboarding.timezoneHint")}</p>
                <TimezonePicker value={timezone} onChange={setTimezone} />
              </div>

              <div className="sticker px-4 py-3.5 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">🏃</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold text-ink">{t("onboarding.stravaTitle")}</p>
                    <p className="text-xs text-moss font-semibold">{t("onboarding.stravaBody")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleConnectStrava}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#FC4C02] hover:bg-[#e04400] disabled:opacity-60 text-cream font-bold border-2 border-ink rounded-xl shadow-[2px_2px_0_var(--color-shade)] transition-colors text-sm"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
                      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                    </svg>
                    {t("onboarding.stravaConnect")}
                  </button>
                  <button
                    type="button"
                    onClick={handleFinish}
                    disabled={saving}
                    className="text-sm text-leaf font-bold underline underline-offset-2 hover:opacity-70 disabled:opacity-60"
                  >
                    {t("onboarding.later")}
                  </button>
                </div>
              </div>

              {error && <p className="text-sm text-clay font-bold">{t("onboarding.saveFailed")}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pt-3 pb-5 flex gap-2 flex-shrink-0 border-t-2 border-dashed border-shade">
          {step > 0 && (
            <button type="button" onClick={() => setStep((s) => s - 1)} disabled={saving} className="btn-quiet px-4 py-2.5 text-sm">
              {t("onboarding.back")}
            </button>
          )}
          {step < STEPS - 1 ? (
            <button type="button" onClick={() => setStep((s) => s + 1)} className="btn-brocco flex-1 py-2.5 text-sm">
              {t("onboarding.next")}
            </button>
          ) : (
            <button type="button" onClick={handleFinish} disabled={saving} className="btn-brocco flex-1 py-2.5 text-sm">
              {saving ? t("common.saving") : t("onboarding.finish")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
