"use client";

import { useRef, useCallback, useEffect, useState } from "react";

/**
 * Live speech feedback for dictation, Claude-app style: while the mic
 * records, the Web Speech API streams interim words so the user sees
 * text appear as they talk. It is display-only feedback — Whisper still
 * transcribes the recorded audio as the source of truth on stop — but
 * doubles as a fallback transcript when Whisper returns nothing.
 *
 * Chrome + Safari (incl. iOS) expose webkitSpeechRecognition; Firefox
 * has nothing, in which case `supported` is false and callers show a
 * "Listening…" hint instead.
 */

// Minimal typings — lib.dom has no SpeechRecognition yet.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | null;
}

export function useLiveSpeech(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);
  const finalRef = useRef("");
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    setSupported(!!getRecognitionCtor());
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || activeRef.current) return;
    activeRef.current = true;
    finalRef.current = "";

    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      onTextRef.current((finalRef.current + interim).trim());
    };
    // Recognition self-terminates on pauses — restart while still active.
    rec.onend = () => {
      if (activeRef.current) {
        try { rec.start(); } catch { /* already restarting */ }
      }
    };
    rec.onerror = () => { /* onend handles restart; fatal errors just stop feedback */ };

    try { rec.start(); } catch { activeRef.current = false; }
  }, []);

  /** Stops listening and returns the accumulated live transcript. */
  const stop = useCallback((): string => {
    activeRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* not started */ }
    recognitionRef.current = null;
    return finalRef.current.trim();
  }, []);

  useEffect(() => () => { activeRef.current = false; try { recognitionRef.current?.stop(); } catch { /* unmount */ } }, []);

  return { supported, start, stop };
}
