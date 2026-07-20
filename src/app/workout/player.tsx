"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { flattenSegments, type WorkoutDefinition, type Segment } from "@/lib/guided-workout";
import { emitToast } from "@/lib/toast";

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
  const segments = useMemo(() => flattenSegments(definition), [definition]);
  const totalEstSec = useMemo(() => segments.reduce((s, seg) => s + segEstSec(seg), 0), [segments]);

  const [idx, setIdx] = useState(0);
  const [remaining, setRemaining] = useState(segments[0]?.seconds ?? 0);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [quitPrompt, setQuitPrompt] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const [logging, setLogging] = useState(false);

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
      u.lang = "en-GB";
      speechSynthesis.speak(u);
    } catch {
      /* speech unavailable */
    }
  }, []);

  const announceSegment = useCallback(
    (s: Segment) => {
      if (s.kind === "work") {
        speak(s.reps != null ? `${s.label}, ${s.reps} reps` : `${s.label}, ${s.seconds} seconds`);
      } else if (s.kind === "rest") {
        speak(s.nextUp ? `Rest. Next up: ${s.nextUp}` : "Rest");
      } else if (s.kind === "warmup") {
        speak("Warm up");
      } else if (s.kind === "cooldown") {
        speak("Cool down. Nice work");
      }
    },
    [speak]
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

  // --- Segment transitions ---
  const goTo = useCallback(
    (newIdx: number, announce = true) => {
      if (newIdx >= segments.length) {
        setFinished(true);
        beep(1320, 600);
        speak("Workout complete. Well done!");
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
        announceSegment(s);
      }
    },
    [segments, beep, speak, announceSegment]
  );

  // Kick off the first segment's clock + announcement
  useEffect(() => {
    endTimeRef.current = Date.now() + (segments[0]?.seconds ?? 0) * 1000;
    speak(`Starting ${title}. Get ready`);
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

  async function handleFinish(log: boolean) {
    const durationMin = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 60000));
    if (!log) {
      onExit();
      return;
    }
    setLogging(true);
    try {
      const res = workoutId
        ? await fetch(`/api/guided-workouts/${workoutId}/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ durationMin }),
          })
        : await fetch("/api/guided-workouts/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, durationMin }),
          });
      if (!res.ok) throw new Error();
      emitToast({ text: `Logged: ${title} (${durationMin} min) 💪`, kind: "success" });
    } catch {
      emitToast({ text: "Couldn't log the workout — it still counts in your heart.", kind: "error" });
    } finally {
      setLogging(false);
      onExit();
    }
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
        <h2 className="text-2xl font-extrabold text-ink mb-1">Workout complete!</h2>
        <p className="text-sm text-moss font-semibold mb-8">
          {title} · {totalMin} min · {workSegs} exercises
        </p>
        <div className="w-full max-w-xs space-y-2">
          <button
            onClick={() => handleFinish(true)}
            disabled={logging}
            className="btn-brocco w-full py-3"
          >
            {logging ? "Logging…" : "Log to training ✓"}
          </button>
          <button
            onClick={() => handleFinish(false)}
            disabled={logging}
            className="btn-quiet w-full py-3 text-sm"
          >
            Finish without logging
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
            onClick={() => { setQuitPrompt(true); if (!paused) togglePause(); }}
            className="text-moss hover:text-ink text-2xl leading-none px-1"
            aria-label="Exit workout"
          >
            &times;
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[11px] text-sage font-bold truncate">{title}</p>
          <p className="text-[11px] text-sage font-bold flex-shrink-0 tabular-nums">
            {seg.kind === "work" ? `Exercise ${workDone + 1}/${workSegs}` : `${workDone}/${workSegs} done`}
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
              {seg.label}
            </h1>
            {seg.note && <p className="text-sm text-moss font-semibold mb-4 max-w-xs">{seg.note}</p>}

            {isTimed ? (
              <p className="font-mono font-extrabold tabular-nums leading-none my-6 text-ink" style={{ fontSize: "clamp(4rem, 20vw, 7rem)" }}>
                {fmt(remaining)}
              </p>
            ) : (
              <div className="my-6 flex flex-col items-center gap-5">
                <p className="font-extrabold leading-none text-ink" style={{ fontSize: "clamp(4rem, 18vw, 6rem)" }}>
                  {seg.reps} <span className="text-3xl text-moss">reps</span>
                </p>
                <button
                  onClick={() => goTo(idx + 1)}
                  className="btn-brocco px-10 py-4 text-lg"
                >
                  Done ✓
                </button>
              </div>
            )}
          </div>
        </div>

        {seg.nextUp && seg.nextUp !== seg.label && (
          <p className="text-sm text-sage font-bold mt-4">
            Next: <span className="text-ink">{seg.nextUp}</span>
          </p>
        )}
      </div>

      {/* Bottom controls */}
      <div className="safe-bottom px-6 pb-6">
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => goTo(Math.max(0, idx - 1))}
            className="sticker-press w-12 h-12 flex items-center justify-center bg-card border-2 border-ink text-ink rounded-full shadow-[2px_2px_0_var(--color-shade)]"
            aria-label="Previous"
          >
            ⏮
          </button>
          {isTimed && (
            <button
              onClick={togglePause}
              className="sticker-press w-16 h-16 flex items-center justify-center bg-brocco border-2 border-ink text-ink text-2xl rounded-full shadow-[3px_3px_0_var(--color-shade)]"
              aria-label={paused ? "Resume" : "Pause"}
            >
              {paused ? "▶" : "⏸"}
            </button>
          )}
          <button
            onClick={() => goTo(idx + 1)}
            className="sticker-press w-12 h-12 flex items-center justify-center bg-card border-2 border-ink text-ink rounded-full shadow-[2px_2px_0_var(--color-shade)]"
            aria-label="Skip"
          >
            ⏭
          </button>
        </div>
        <div className="flex items-center justify-center gap-5 mt-4">
          <button
            onClick={() => { const v = !soundOn; setSoundOn(v); localStorage.setItem("brocco_wo_sound", v ? "on" : "off"); }}
            className={`text-xs font-bold ${soundOn ? "text-ink" : "text-ghost-ink line-through"}`}
          >
            🔔 Beeps
          </button>
          <button
            onClick={() => { const v = !voiceOn; setVoiceOn(v); localStorage.setItem("brocco_wo_voice", v ? "on" : "off"); if (!v && typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }}
            className={`text-xs font-bold ${voiceOn ? "text-ink" : "text-ghost-ink line-through"}`}
          >
            🗣 Voice
          </button>
        </div>
      </div>

      {/* Quit confirmation */}
      {quitPrompt && (
        <div className="absolute inset-0 z-10 bg-ink/40 flex items-center justify-center px-6">
          <div className="bg-paper border-2 border-ink rounded-2xl shadow-[4px_4px_0_var(--color-shade)] p-5 w-full max-w-xs text-center">
            <p className="text-ink font-bold mb-4">Quit this workout?</p>
            <div className="space-y-2">
              <button
                onClick={() => { setQuitPrompt(false); if (paused) togglePause(); }}
                className="btn-brocco w-full py-2.5 text-sm"
              >
                Keep going 💪
              </button>
              <button
                onClick={onExit}
                className="btn-quiet w-full py-2.5 text-sm"
              >
                Quit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
