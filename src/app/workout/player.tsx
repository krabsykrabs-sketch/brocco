"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { flattenSegments, type WorkoutDefinition, type Segment } from "@/lib/guided-workout";
import { emitToast } from "@/lib/toast";
import { emitDataChanged } from "@/lib/capture-context";
import { artPathFor } from "@/lib/exercise-art";
import { useT, useLang } from "@/app/features-provider";
import { localeFor } from "@/lib/i18n";

/**
 * Full-screen workout player. Deadline-based timing (endTime vs Date.now())
 * so a backgrounded tab doesn't drift; Web-Audio beeps at 3-2-1 and on
 * transitions; SpeechSynthesis announces each segment; screen wake-lock keeps
 * the phone on mid-plank. Rep-based segments show a big Done button instead
 * of a countdown.
 */

const EST_SEC_PER_REP = 3;

interface PlayerProps {
  title: string;
  definition: WorkoutDefinition;
  /** Saved workout id — enables "log to training" on finish; null for presets */
  workoutId: string | null;
  onExit: () => void;
}

function segEstSec(s: Segment): number {
  return s.seconds ?? (s.reps ? s.reps * EST_SEC_PER_REP : 30);
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.max(0, Math.ceil(sec % 60));
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}`;
}

/* Page ground tint per phase — cream family, still glanceable mid-exercise */
const KIND_BG: Record<Segment["kind"], string> = {
  prep: "bg-[#faeed8]",
  warmup: "bg-[#faeed8]",
  work: "bg-cream",
  rest: "bg-[#e3eefa]",
  cooldown: "bg-ghost",
};

/* Progress fill inside the active exercise sticker */
const KIND_FILL: Record<Segment["kind"], string> = {
  prep: "bg-sun/40",
  warmup: "bg-sun/40",
  work: "bg-brocco",
  rest: "bg-sky/40",
  cooldown: "bg-ghost",
};

export default function WorkoutPlayer({ title, definition, workoutId, onExit }: PlayerProps) {
  const t = useT();
  const lang = useLang();
  // Segment labels ("Get ready", "Rest", "Round 2/3") come out of the
  // engine already in the app language; exercise names are the definition's.
  const segments = useMemo(() => flattenSegments(definition, lang), [definition, lang]);
  const totalEstSec = useMemo(() => segments.reduce((s, seg) => s + segEstSec(seg), 0), [segments]);

  const [idx, setIdx] = useState(0);
  const [remaining, setRemaining] = useState(segments[0]?.seconds ?? 0);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [quitPrompt, setQuitPrompt] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const [showPlan, setShowPlan] = useState(false);
  // Auto-log state: sessions log themselves on finish; undo removes it all.
  const [logState, setLogState] = useState<"logging" | "logged" | "failed" | "undone">("logging");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const loggedRef = useRef(false);

  const endTimeRef = useRef<number>(0);
  const pausedRemainingRef = useRef<number>(0);
  const lastBeepSecRef = useRef<number>(-1);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const soundOnRef = useRef(true);
  const voiceOnRef = useRef(true);
  soundOnRef.current = soundOn;
  voiceOnRef.current = voiceOn;

  const seg = segments[idx];
  const isTimed = seg?.seconds != null;
  const segLabel = seg?.label ?? "";
  // A picture of the position beats a sentence you have to read mid-effort.
  const artSrc = seg?.kind === "work" ? artPathFor(seg.label, seg.art) : null;

  // Restore audio prefs
  useEffect(() => {
    setSoundOn(localStorage.getItem("brocco_wo_sound") !== "off");
    setVoiceOn(localStorage.getItem("brocco_wo_voice") !== "off");
  }, []);

  // --- Audio ---
  const beep = useCallback((freq: number, durMs: number, volume = 0.4) => {
    if (!soundOnRef.current) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.value = volume;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durMs / 1000);
      osc.stop(ctx.currentTime + durMs / 1000);
    } catch {
      /* audio unavailable */
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (!voiceOnRef.current || typeof speechSynthesis === "undefined") return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.lang = localeFor(lang);
      speechSynthesis.speak(u);
    } catch {
      /* speech unavailable */
    }
  }, [lang]);

  const announceSegment = useCallback(
    (s: Segment) => {
      if (s.kind === "work") {
        speak(s.reps != null ? `${s.label}, ${s.reps} ${t("common.reps")}` : `${s.label}, ${s.seconds}`);
      } else if (s.kind === "rest") {
        speak(s.nextUp ? `${t("player.rest")}. ${t("player.next")}: ${s.nextUp}` : t("player.rest"));
      } else if (s.kind === "warmup") {
        speak(t("workout.warmUp"));
      } else if (s.kind === "cooldown") {
        speak(t("workout.coolDown"));
      }
    },
    [speak, t]
  );

  // --- Wake lock ---
  useEffect(() => {
    let released = false;
    async function acquire() {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
        if (nav.wakeLock && !released) {
          wakeLockRef.current = await nav.wakeLock.request("screen");
        }
      } catch {
        /* not supported / denied — non-fatal */
      }
    }
    acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVis);
      wakeLockRef.current?.release().catch(() => {});
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  // Gyms are loud and phones are muted — a buzz survives both.
  const buzz = useCallback((pattern: number | number[]) => {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  }, []);

  // --- Segment transitions ---
  const goTo = useCallback(
    (newIdx: number, announce = true) => {
      if (newIdx >= segments.length) {
        setFinished(true);
        beep(1320, 600);
        buzz([120, 60, 120]);
        speak(t("player.complete"));
        return;
      }
      const s = segments[newIdx];
      setIdx(newIdx);
      lastBeepSecRef.current = -1;
      if (s.seconds != null) {
        endTimeRef.current = Date.now() + s.seconds * 1000;
        setRemaining(s.seconds);
      }
      if (announce) {
        beep(1320, 250);
        buzz(60);
        announceSegment(s);
      }
    },
    [segments, beep, buzz, speak, announceSegment, t]
  );

  // Kick off the first segment's clock + announcement
  useEffect(() => {
    endTimeRef.current = Date.now() + (segments[0]?.seconds ?? 0) * 1000;
    speak(`${title}. ${t("player.getReady")}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Ticker (timed segments only) ---
  useEffect(() => {
    if (paused || finished || !isTimed) return;
    const t = setInterval(() => {
      const rem = (endTimeRef.current - Date.now()) / 1000;
      if (rem <= 0) {
        goTo(idx + 1);
        return;
      }
      setRemaining(rem);
      const whole = Math.ceil(rem);
      if (whole <= 3 && whole >= 1 && lastBeepSecRef.current !== whole) {
        lastBeepSecRef.current = whole;
        beep(880, 120, 0.3);
      }
    }, 200);
    return () => clearInterval(t);
  }, [paused, finished, isTimed, idx, goTo, beep]);

  function togglePause() {
    if (finished) return;
    if (!paused) {
      pausedRemainingRef.current = endTimeRef.current - Date.now();
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      setPaused(true);
    } else {
      endTimeRef.current = Date.now() + Math.max(pausedRemainingRef.current, 0);
      setPaused(false);
    }
  }

  // Auto-log the finished session (activity + history row). The philosophy
  // matches capture: it just happens, and Undo is right there.
  useEffect(() => {
    if (!finished || loggedRef.current) return;
    loggedRef.current = true;
    const durationMin = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 60000));
    fetch("/api/guided-workouts/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workoutId, title, durationMin, completed: true, startedAtMs: startedAtRef.current }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const d = await r.json();
        setSessionId(d.sessionId || null);
        setLogState("logged");
        emitDataChanged(["activities"]);
      })
      .catch(() => setLogState("failed"));
  }, [finished, workoutId, title]);

  async function undoLog() {
    if (!sessionId) return;
    const res = await fetch(`/api/guided-workouts/sessions/${sessionId}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      setLogState("undone");
      emitDataChanged(["activities"]);
    } else {
      emitToast({ text: t("player.undoFailed"), kind: "error" });
    }
  }

  // Quitting mid-workout records the bail for history (no activity is
  // logged) — but only once something was actually done.
  function handleQuit() {
    const done = segments.slice(0, idx).filter((s) => s.kind === "work").length;
    if (done > 0 && !loggedRef.current) {
      loggedRef.current = true;
      const durationMin = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 60000));
      fetch("/api/guided-workouts/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId,
          title,
          durationMin,
          completed: false,
          bailedAtExercise: done,
          startedAtMs: startedAtRef.current,
        }),
        keepalive: true,
      }).catch(() => {});
    }
    onExit();
  }

  // Overall progress by estimated time
  const elapsedEst = segments.slice(0, idx).reduce((s, sg) => s + segEstSec(sg), 0) + (isTimed && seg ? seg.seconds! - remaining : 0);
  const progressPct = Math.min(100, (elapsedEst / Math.max(totalEstSec, 1)) * 100);
  // Fill of the active exercise sticker (timed segments only)
  const segPct = isTimed && seg?.seconds ? Math.min(100, ((seg.seconds - remaining) / seg.seconds) * 100) : 0;
  const workSegs = segments.filter((s) => s.kind === "work").length;
  const workDone = segments.slice(0, idx).filter((s) => s.kind === "work").length;

  if (finished) {
    const totalMin = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 60000));
    return (
      <div className="fixed inset-0 z-[90] bg-cream flex flex-col items-center justify-center px-6 text-center">
        <p className="text-6xl mb-4">🥦</p>
        <h2 className="text-2xl font-extrabold text-ink mb-1">{t("player.complete")}</h2>
        <p className="text-sm text-moss font-semibold mb-6">
          {title} · {totalMin} {t("common.min")} · {workSegs} {t("workout.exercisesPlural")}
        </p>
        <div className="mb-8 min-h-[1.5rem]">
          {logState === "logging" && <p className="text-xs text-sage font-bold">{t("player.logging")}</p>}
          {logState === "logged" && (
            <p className="text-xs font-bold">
              <span className="text-leaf">{t("player.logged")}</span>
              <button onClick={undoLog} className="text-sage underline ml-2">{t("common.undo")}</button>
            </p>
          )}
          {logState === "failed" && (
            <p className="text-xs text-clay font-bold">{t("player.logFailed")}</p>
          )}
          {logState === "undone" && <p className="text-xs text-sage font-bold">{t("player.notLogged")}</p>}
        </div>
        <div className="w-full max-w-xs">
          <button onClick={onExit} className="btn-brocco w-full py-3">
            {t("common.done")}
          </button>
        </div>
      </div>
    );
  }

  if (!seg) return null;

  return (
    <div className={`fixed inset-0 z-[90] ${KIND_BG[seg.kind]} flex flex-col transition-colors duration-500`} data-testid="workout-player">
      {/* Top bar: progress + exit */}
      <div className="safe-top px-4 pt-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2.5 bg-ghost border-2 border-ink rounded-full overflow-hidden">
            <div className="h-full bg-brocco rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <button
            onClick={() => setShowPlan(true)}
            className="text-moss hover:text-ink text-lg leading-none px-1"
            aria-label={t("player.showPlan")}
          >
            &#9776;
          </button>
          <button
            onClick={() => { setQuitPrompt(true); if (!paused) togglePause(); }}
            className="text-moss hover:text-ink text-2xl leading-none px-1"
            aria-label={t("player.exitWorkout")}
          >
            &times;
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[11px] text-sage font-bold truncate">{title}</p>
          <p className="text-[11px] text-sage font-bold flex-shrink-0 tabular-nums">
            {seg.kind === "work" ? `${t("player.exerciseOf")} ${workDone + 1}/${workSegs}` : `${workDone}/${workSegs}`}
          </p>
        </div>
      </div>

      {/* Center: the big display — active exercise sticker with progress fill */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center min-h-0">
        <div className="sticker-lg relative overflow-hidden w-full max-w-sm px-6 py-8">
          <div
            className={`absolute inset-y-0 left-0 ${KIND_FILL[seg.kind]} transition-all`}
            style={{ width: `${segPct}%` }}
          />
          <div className="relative flex flex-col items-center">
            {seg.context && <p className="label-xs mb-2">{seg.context}</p>}
            <h1 className="text-3xl md:text-4xl font-extrabold text-ink mb-1">
              {segLabel}
            </h1>
            {artSrc && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={artSrc} alt="" className="w-28 h-28 md:w-36 md:h-36 object-contain mt-1" />
            )}
            {seg.note && <p className="text-sm text-moss font-semibold mb-4 max-w-xs">{seg.note}</p>}

            {isTimed ? (
              <>
                <p className="font-mono font-extrabold tabular-nums leading-none my-6 text-ink" style={{ fontSize: "clamp(4rem, 20vw, 7rem)" }}>
                  {fmt(remaining)}
                </p>
                {seg.kind === "rest" && (
                  <button
                    onClick={() => { endTimeRef.current += 15000; setRemaining((r) => r + 15); }}
                    className="btn-quiet px-4 py-1.5 text-xs mb-1"
                  >
                    {t("player.addRest")}
                  </button>
                )}
              </>
            ) : (
              <div className="my-6 flex flex-col items-center gap-5">
                <p className="font-extrabold leading-none text-ink" style={{ fontSize: "clamp(4rem, 18vw, 6rem)" }}>
                  {seg.reps} <span className="text-3xl text-moss">{t("common.reps")}</span>
                </p>
                <button
                  onClick={() => goTo(idx + 1)}
                  className="btn-brocco px-10 py-4 text-lg"
                >
                  {t("common.done")} ✓
                </button>
              </div>
            )}
          </div>
        </div>

        {seg.nextUp && seg.nextUp !== seg.label && (
          <p className="text-sm text-sage font-bold mt-4">
            {t("player.next")}: <span className="text-ink">{seg.nextUp}</span>
          </p>
        )}
      </div>

      {/* Bottom controls */}
      <div className="safe-bottom px-6 pb-6">
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => goTo(Math.max(0, idx - 1))}
            className="sticker-press w-12 h-12 flex items-center justify-center bg-card border-2 border-ink text-ink rounded-full shadow-[2px_2px_0_var(--color-shade)]"
            aria-label={t("player.previous")}
          >
            ⏮
          </button>
          {isTimed && (
            <button
              onClick={togglePause}
              className="sticker-press w-16 h-16 flex items-center justify-center bg-brocco border-2 border-ink text-ink text-2xl rounded-full shadow-[3px_3px_0_var(--color-shade)]"
              aria-label={paused ? t("player.resume") : t("player.pause")}
            >
              {paused ? "▶" : "⏸"}
            </button>
          )}
          <button
            onClick={() => goTo(idx + 1)}
            className="sticker-press w-12 h-12 flex items-center justify-center bg-card border-2 border-ink text-ink rounded-full shadow-[2px_2px_0_var(--color-shade)]"
            aria-label={t("player.skip")}
          >
            ⏭
          </button>
        </div>
        <div className="flex items-center justify-center gap-5 mt-4">
          <button
            onClick={() => { const v = !soundOn; setSoundOn(v); localStorage.setItem("brocco_wo_sound", v ? "on" : "off"); }}
            className={`text-xs font-bold ${soundOn ? "text-ink" : "text-ghost-ink line-through"}`}
          >
            {t("player.beeps")}
          </button>
          <button
            onClick={() => { const v = !voiceOn; setVoiceOn(v); localStorage.setItem("brocco_wo_voice", v ? "on" : "off"); if (!v && typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }}
            className={`text-xs font-bold ${voiceOn ? "text-ink" : "text-ghost-ink line-through"}`}
          >
            {t("player.voice")}
          </button>
        </div>
      </div>

      {/* Session plan drawer — what's done, what's live, what's coming */}
      {showPlan && (
        <div className="absolute inset-0 z-10 bg-ink/40" onClick={() => setShowPlan(false)}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto bg-paper border-t-2 border-ink rounded-t-2xl px-4 pt-4 pb-6 safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="label-xs">{t("player.sessionPlan")}</p>
                <button onClick={() => setShowPlan(false)} className="text-moss hover:text-ink text-xl leading-none" aria-label={t("common.close")}>
                  &times;
                </button>
              </div>
              <div className="space-y-0.5">
                {segments.map((s, i) => {
                  if (s.kind === "prep" || s.kind === "rest") return null;
                  return (
                    <button
                      key={i}
                      onClick={() => { setShowPlan(false); goTo(i); }}
                      className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg ${
                        i === idx ? "bg-sprout border-2 border-ink" : i < idx ? "opacity-40" : "hover:bg-ghost"
                      }`}
                    >
                      <span className="text-xs font-bold text-ink flex-1 min-w-0 truncate">
                        {i < idx ? "✓ " : ""}{s.label}
                        {s.context ? <span className="text-sage font-semibold"> · {s.context}</span> : null}
                      </span>
                      <span className="text-[10px] text-sage font-bold tabular-nums flex-shrink-0">
                        {s.seconds != null ? fmt(s.seconds) : `${s.reps} ${t("common.reps")}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quit confirmation */}
      {quitPrompt && (
        <div className="absolute inset-0 z-10 bg-ink/40 flex items-center justify-center px-6">
          <div className="bg-paper border-2 border-ink rounded-2xl shadow-[4px_4px_0_var(--color-shade)] p-5 w-full max-w-xs text-center">
            <p className="text-ink font-bold mb-4">{t("player.quitTitle")}</p>
            <div className="space-y-2">
              <button
                onClick={() => { setQuitPrompt(false); if (paused) togglePause(); }}
                className="btn-brocco w-full py-2.5 text-sm"
              >
                {t("player.keepGoing")}
              </button>
              <button
                onClick={handleQuit}
                className="btn-quiet w-full py-2.5 text-sm"
              >
                {t("player.quit")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
