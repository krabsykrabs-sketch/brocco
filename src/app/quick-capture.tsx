"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { getScreenContext, emitDataChanged } from "@/lib/capture-context";
import { TOAST_EVENT, type AppToast } from "@/lib/toast";
import { useFeatures } from "./features-provider";
import { anyLifeFeature } from "@/lib/features";

/**
 * Floating mic — the primary input method of the whole app.
 * Tap → record → tap → transcribe → Brocco executes → toast confirmation.
 * Ambiguous requests open a small clarify overlay (answer by voice or text).
 */

// No FAB on auth/legal pages; chat has its own mic.
const HIDDEN_ON = ["/login", "/signup", "/legal", "/chat", "/forgot-password", "/reset-password"];

interface Toast {
  id: number;
  text: string;
  kind: "success" | "info" | "error";
  action?: { label: string; run: () => void | Promise<void> };
}

type Phase = "idle" | "recording" | "transcribing" | "thinking";

let toastId = 0;

export function QuickCapture() {
  const pathname = usePathname();
  const features = useFeatures();
  const [phase, setPhase] = useState<Phase>("idle");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [clarify, setClarify] = useState<string | null>(null);
  const [clarifyInput, setClarifyInput] = useState("");
  const [micSupported, setMicSupported] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const discardedRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  useEffect(() => {
    setMicSupported(typeof window !== "undefined" && !!window.MediaRecorder);
  }, []);

  // If the user navigates away (e.g. to /chat, where the FAB unmounts) while
  // recording, stop the recorder and release the mic — otherwise the browser
  // keeps the recording indicator on with no visible way to stop it.
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stream.getTracks().forEach((t) => t.stop());
        try { recorder.stop(); } catch { /* already stopped */ }
      }
    };
  }, []);

  const pushToast = useCallback(
    (text: string, kind: Toast["kind"] = "success", action?: Toast["action"]) => {
      const id = ++toastId;
      setToasts((prev) => [...prev.slice(-3), { id, text, kind, action }]);
      // Toasts with an action (undo) stay longer — the user needs time to react
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), action ? 7000 : 4500);
    },
    []
  );

  // App-wide toast bus: other components (task/note deletes with undo, etc.)
  // push onto this surface via emitToast().
  useEffect(() => {
    function onToast(e: Event) {
      const t = (e as CustomEvent).detail as AppToast;
      if (t?.text) pushToast(t.text, t.kind || "success", t.action);
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, [pushToast]);

  const sendCapture = useCallback(
    async (text: string) => {
      setPhase("thinking");
      setTranscript(text);
      try {
        const res = await fetch("/api/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, screen: getScreenContext() || undefined }),
        });
        if (!res.ok) {
          pushToast("That didn't work — try again or use the chat.", "error");
          return;
        }
        const data = await res.json();
        if (data.result === "done") {
          setClarify(null);
          for (const t of (data.toast as string[]) || []) pushToast(`✓ ${t}`, "success");
          if (data.say) pushToast(data.say, "info");
          if (data.mutations?.length) emitDataChanged(data.mutations);
        } else if (data.result === "clarify") {
          setClarify(data.question);
        }
      } catch {
        pushToast("Connection problem — try again.", "error");
      } finally {
        setPhase("idle");
        setTranscript(null);
      }
    },
    [pushToast]
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4",
      });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (discardedRef.current) {
          discardedRef.current = false;
          setPhase("idle");
          return;
        }
        const chunks = audioChunksRef.current;
        if (chunks.length === 0) {
          setPhase("idle");
          return;
        }
        setPhase("transcribing");
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          const form = new FormData();
          form.append("audio", blob, `capture.${recorder.mimeType.includes("webm") ? "webm" : "mp4"}`);
          const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
          if (!res.ok) throw new Error("transcribe failed");
          const { text } = await res.json();
          if (!text || !text.trim()) {
            pushToast("Didn't catch that — try again.", "error");
            setPhase("idle");
            return;
          }
          await sendCapture(text.trim());
        } catch {
          pushToast("Transcription failed — try again.", "error");
          setPhase("idle");
        }
      };

      recorder.start();
      setPhase("recording");
    } catch {
      pushToast("Microphone unavailable. Check permissions.", "error");
    }
  }, [pushToast, sendCapture]);

  const handleMicTap = useCallback(() => {
    if (phaseRef.current === "recording") {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (phaseRef.current !== "idle") return;
    discardedRef.current = false;
    startRecording();
  }, [startRecording]);

  const handleDiscard = useCallback(() => {
    if (phaseRef.current !== "recording") return;
    discardedRef.current = true;
    mediaRecorderRef.current?.stop();
  }, []);

  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;

  const busy = phase === "transcribing" || phase === "thinking";
  // With all life features disabled the floating mic disappears (classic
  // coach experience — voice stays available inside the chat). The toast
  // surface stays mounted: undo toasts and reminders render through it.
  const micEnabled = anyLifeFeature(features);

  return (
    <>
      {/* Toasts */}
      <div className="fixed left-4 right-4 md:left-auto md:right-6 md:w-96 z-[70] flex flex-col items-stretch gap-1.5 pointer-events-none"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 8.5rem)" }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-3.5 py-2.5 rounded-xl text-sm font-semibold border-2 border-ink shadow-[2px_2px_0_var(--color-shade)] animate-[fadeIn_0.15s_ease-out] flex items-center gap-3 ${
              t.kind === "success"
                ? "bg-sprout text-ink"
                : t.kind === "error"
                ? "bg-clay-soft text-clay"
                : "bg-paper text-ink"
            }`}
          >
            <span className="flex-1">{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                  t.action!.run();
                }}
                className="pointer-events-auto flex-shrink-0 text-xs font-semibold uppercase tracking-wide underline underline-offset-2 hover:opacity-80"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Clarify overlay */}
      {clarify && (
        <div className="fixed left-4 right-4 md:left-auto md:right-6 md:w-96 z-[70] sticker-lg p-3.5"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 8.5rem)" }}>
          <div className="flex items-start gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-64.png" alt="" className="w-6 h-6 mt-0.5 rounded-full border-2 border-ink" />
            <p className="text-sm text-ink font-semibold flex-1">{clarify}</p>
            <button onClick={() => { setClarify(null); setClarifyInput(""); }} className="text-moss hover:text-ink text-lg leading-none">&times;</button>
          </div>
          <div className="flex gap-2 mt-3">
            <input
              value={clarifyInput}
              onChange={(e) => setClarifyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && clarifyInput.trim()) {
                  sendCapture(clarifyInput.trim());
                  setClarifyInput("");
                }
              }}
              placeholder="Answer, or use the mic…"
              className="field flex-1"
              disabled={busy}
            />
            <button
              onClick={() => {
                if (clarifyInput.trim()) {
                  sendCapture(clarifyInput.trim());
                  setClarifyInput("");
                }
              }}
              disabled={busy || !clarifyInput.trim()}
              className="btn-brocco px-3 py-2 text-sm"
            >
              ↵
            </button>
          </div>
        </div>
      )}

      {/* Transcript chip while Brocco processes — shows what Whisper heard,
          so a mis-transcription is immediately visible instead of surfacing
          as a mysteriously wrong toast */}
      {micEnabled && phase === "thinking" && transcript && (
        <div
          className="fixed z-[60] right-4 md:right-6 max-w-[70vw] md:max-w-sm sticker px-3 py-2"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 8.5rem)" }}
        >
          <p className="label-xs mb-0.5">Heard</p>
          <p className="text-xs text-ink italic font-semibold">&ldquo;{transcript}&rdquo;</p>
        </div>
      )}

      {/* Discard button while recording */}
      {micEnabled && phase === "recording" && (
        <button
          onClick={handleDiscard}
          aria-label="Discard recording"
          className="fixed z-[60] w-10 h-10 rounded-full bg-card border-2 border-ink shadow-[2px_2px_0_var(--color-shade)] hover:bg-ghost flex items-center justify-center transition-colors"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)", right: "calc(1rem + 4.25rem)" }}
        >
          <span className="text-ink text-lg leading-none">&times;</span>
        </button>
      )}

      {/* FAB */}
      {micSupported && micEnabled && (
        <button
          onClick={handleMicTap}
          disabled={busy}
          aria-label={phase === "recording" ? "Stop recording and send" : "Speak to Brocco"}
          className={`fixed z-[60] right-4 md:right-6 w-14 h-14 rounded-full border-2 border-ink shadow-[3px_3px_0_var(--color-shade)] flex items-center justify-center transition-all ${
            phase === "recording"
              ? "bg-clay scale-110 animate-pulse"
              : busy
              ? "bg-ghost"
              : "bg-brocco active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          }`}
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.5rem)" }}
        >
          {busy ? (
            <span className="inline-block w-6 h-6 border-2 border-ink/20 border-t-ink rounded-full animate-spin" />
          ) : phase === "recording" ? (
            <span className="w-5 h-5 bg-white rounded-sm" />
          ) : (
            <svg className="w-6 h-6 text-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m-4 0h8M12 3a3 3 0 00-3 3v4a3 3 0 006 0V6a3 3 0 00-3-3z" />
            </svg>
          )}
        </button>
      )}
    </>
  );
}
