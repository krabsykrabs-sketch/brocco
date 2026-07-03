"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PageHeader } from "../nav";
import { emitToast } from "@/lib/toast";
import { MOOD_EMOJI, MOOD_LABELS, MOOD_TAGS } from "@/lib/journal";

/**
 * Private mood + diary timeline. The composer follows the Daylio insight:
 * a mood check-in must never require typing — emoji tap, optional tag taps,
 * save. The mic records a voice entry, transcribed into the text box for a
 * quick review before saving (a diary entry shouldn't auto-commit a
 * mis-transcription).
 */

interface Entry {
  id: string;
  day: string;
  mood: number | null;
  tags: string[];
  text: string | null;
  createdAt: string;
}

const MOODS = [1, 2, 3, 4, 5] as const;

function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T00:00:00Z`);
  const t = new Date(`${today}T00:00:00Z`);
  if (t.getTime() - d.getTime() === 86400000) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function Composer({ onSaved }: { onSaved: () => void }) {
  const [mood, setMood] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setMicSupported(typeof window !== "undefined" && !!window.MediaRecorder);
  }, []);

  // Release the mic if the user navigates away mid-recording
  useEffect(() => {
    return () => {
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        r.stream.getTracks().forEach((t) => t.stop());
        try { r.stop(); } catch { /* already stopped */ }
      }
    };
  }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4",
      });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (chunksRef.current.length === 0) return;
        setTranscribing(true);
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          const form = new FormData();
          form.append("audio", blob, `journal.${recorder.mimeType.includes("webm") ? "webm" : "mp4"}`);
          const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
          if (!res.ok) throw new Error("transcribe failed");
          const { text: spoken } = await res.json();
          if (spoken && spoken.trim()) {
            setText((prev) => (prev ? `${prev} ${spoken.trim()}` : spoken.trim()));
          } else {
            emitToast({ text: "Didn't catch that — try again.", kind: "error" });
          }
        } catch {
          emitToast({ text: "Transcription failed — try again.", kind: "error" });
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      setRecording(true);
    } catch {
      emitToast({ text: "Microphone access denied.", kind: "error" });
    }
  }

  function stopRecording() {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
  }

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  async function handleSave() {
    if (mood == null && !text.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood, tags, text: text.trim() || null }),
      });
      if (!res.ok) {
        emitToast({ text: "Couldn't save — try again.", kind: "error" });
        return;
      }
      setMood(null);
      setTags([]);
      setText("");
      onSaved();
      emitToast({ text: mood ? `Logged ${MOOD_EMOJI[mood]}` : "Journal entry saved", kind: "success" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4" data-testid="journal-composer">
      <p className="text-sm font-medium text-gray-300 mb-3">How are you feeling?</p>
      <div className="flex justify-between gap-1 mb-3">
        {MOODS.map((m) => (
          <button
            key={m}
            onClick={() => setMood(mood === m ? null : m)}
            aria-label={MOOD_LABELS[m]}
            className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl transition-all ${
              mood === m ? "bg-green-600/20 ring-1 ring-green-500 scale-105" : "hover:bg-gray-800"
            } ${mood != null && mood !== m ? "opacity-40" : ""}`}
          >
            <span className="text-2xl">{MOOD_EMOJI[m]}</span>
            <span className={`text-[10px] ${mood === m ? "text-green-400" : "text-gray-500"}`}>{MOOD_LABELS[m]}</span>
          </button>
        ))}
      </div>
      {mood != null && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {MOOD_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                tags.includes(tag)
                  ? "bg-green-600/30 text-green-300 ring-1 ring-green-600"
                  : "bg-gray-800 text-gray-400 hover:text-gray-200"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={transcribing ? "Transcribing…" : "Anything on your mind? (optional)"}
          rows={text || recording ? 4 : 2}
          className="w-full px-3 py-2 pr-11 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500 resize-none"
        />
        {micSupported && (
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={transcribing}
            aria-label={recording ? "Stop recording" : "Record voice entry"}
            className={`absolute right-2 top-2 w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
              recording ? "bg-red-600 animate-pulse" : "bg-gray-800 hover:bg-gray-700"
            } disabled:opacity-40`}
          >
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3z" />
              <path d="M17 11a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z" />
            </svg>
          </button>
        )}
      </div>
      <button
        onClick={handleSave}
        disabled={saving || transcribing || (mood == null && !text.trim())}
        className="mt-2 w-full py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function EntryRow({ entry, onChanged }: { entry: Entry; onChanged: () => void }) {
  async function handleDelete() {
    const res = await fetch(`/api/journal/${entry.id}`, { method: "DELETE" });
    if (!res.ok) {
      emitToast({ text: "Couldn't delete — try again.", kind: "error" });
      return;
    }
    onChanged();
    const snapshot = { mood: entry.mood, tags: entry.tags, text: entry.text };
    emitToast({
      text: "Entry deleted",
      kind: "info",
      action: {
        label: "Undo",
        run: async () => {
          await fetch("/api/journal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(snapshot),
          });
          onChanged();
        },
      },
    });
  }

  const time = new Date(entry.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="group bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
      <div className="flex items-start gap-3">
        {entry.mood && <span className="text-xl leading-6">{MOOD_EMOJI[entry.mood]}</span>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {entry.mood && <span className="text-xs font-medium text-gray-300">{MOOD_LABELS[entry.mood]}</span>}
            <span className="text-[10px] text-gray-600">{time}</span>
            {entry.tags.map((t) => (
              <span key={t} className="px-1.5 py-0.5 bg-gray-800 rounded-full text-[10px] text-gray-400">{t}</span>
            ))}
          </div>
          {entry.text && <p className="mt-1 text-sm text-gray-200 whitespace-pre-wrap break-words">{entry.text}</p>}
        </div>
        <button
          onClick={handleDelete}
          aria-label="Delete entry"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-600 hover:text-red-400 transition-all text-sm px-1"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

export default function JournalView() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [today, setToday] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchEntries = useCallback(() => {
    fetch("/api/journal?limit=30")
      .then((r) => r.json())
      .then((d) => {
        setEntries(d.entries || []);
        setToday(d.today || "");
        setHasMore(!!d.hasMore);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  async function loadMore() {
    const last = entries[entries.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/journal?limit=30&before=${encodeURIComponent(last.createdAt)}`);
      const d = await res.json();
      setEntries((prev) => [...prev, ...(d.entries || [])]);
      setHasMore(!!d.hasMore);
    } catch {
      // keep existing list
    } finally {
      setLoadingMore(false);
    }
  }

  // Group by day, preserving newest-first order
  const groups: { day: string; entries: Entry[] }[] = [];
  for (const e of entries) {
    const g = groups[groups.length - 1];
    if (g && g.day === e.day) g.entries.push(e);
    else groups.push({ day: e.day, entries: [e] });
  }

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4">
      <PageHeader title="Journal" />
      <div className="mt-4 space-y-4 pb-8">
        <Composer onSaved={fetchEntries} />
        {loading ? (
          <p className="text-center text-sm text-gray-600 py-8">Loading…</p>
        ) : groups.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-3xl mb-2">📓</p>
            <p className="text-sm text-gray-400">Your private journal is empty.</p>
            <p className="text-xs text-gray-600 mt-1">
              Check in with a mood above, or hold the mic and talk about your day — only you can see this.
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.day}>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {dayLabel(g.day, today)}
              </h2>
              <div className="space-y-2">
                {g.entries.map((e) => (
                  <EntryRow key={e.id} entry={e} onChanged={fetchEntries} />
                ))}
              </div>
            </section>
          ))
        )}
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full py-2.5 bg-gray-900 border border-gray-800 hover:border-gray-700 text-gray-400 text-sm rounded-xl transition-colors disabled:opacity-40"
          >
            {loadingMore ? "Loading…" : "Load older entries"}
          </button>
        )}
      </div>
    </main>
  );
}
