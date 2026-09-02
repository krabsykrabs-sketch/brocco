"use client";

import { useT, useLang } from "@/app/features-provider";
import { fmtDate, type Lang } from "@/lib/i18n";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DesktopNavLinks } from "@/app/nav";
import { ChatMarkdown } from "./markdown";
import { useLiveSpeech } from "@/lib/live-speech";

interface Message {
  id: string;
  role: "user" | "assistant";
  displayText: string | null;
  toolNotifications?: ToolNotification[];
}

interface ToolNotification {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

interface SessionItem {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

function formatTime(iso: string, lang: Lang): string {
  return fmtDate(iso, lang, { day: "numeric", month: "short" });
}

function ToolNotificationBadge({ notification }: { notification: ToolNotification }) {
  const icons: Record<string, string> = {
    health_logged: "\u2764\ufe0f",
    activity_logged: "\ud83c\udfc3",
    plan_adjusted: "\ud83d\udd27",
    plan_created: "\ud83d\udcdd",
    plan_modified: "\ud83d\udd27",
    plan_adjusted_partial: "\u26a0\ufe0f",
    plan_modified_partial: "\u26a0\ufe0f",
  };

  // Partial applications must not read as a clean success \u2014 a green tick on a
  // change that only half landed is what made silent failures invisible.
  const partial = notification.type.endsWith("_partial");

  return (
    <div
      className={`flex items-center gap-2 border-2 rounded-lg px-3 py-1.5 text-xs font-bold mb-1 ${
        partial
          ? "bg-clay-soft border-clay text-clay"
          : "bg-sprout border-ink text-ink"
      }`}
    >
      <span>{icons[notification.type] || "\u2705"}</span>
      <span>{notification.message}</span>
    </div>
  );
}

function parseStatus(text: string): { cleanText: string; statusType: string | null; statusText: string | null } {
  const match = text.match(/\[STATUS:(question|done|info)\](.*?)\[\/STATUS\]/);
  if (!match) return { cleanText: text, statusType: null, statusText: null };
  return {
    cleanText: text.replace(match[0], "").trim(),
    statusType: match[1],
    statusText: match[2],
  };
}

const statusStyles: Record<string, { bg: string; icon: string }> = {
  question: { bg: "bg-[#faeed8] border-2 border-sun text-ink", icon: "\uD83D\uDFE1" },
  done: { bg: "bg-sprout border-2 border-ink text-ink", icon: "\uD83D\uDFE2" },
  info: { bg: "bg-[#e3eefa] border-2 border-ink text-ink", icon: "\uD83D\uDD35" },
};

function StatusStrip({ type, text }: { type: string; text: string }) {
  const style = statusStyles[type] || statusStyles.info;
  return (
    <div className={`${style.bg} rounded-lg px-3 py-1.5 mt-2 flex items-center gap-2`}>
      <span className="text-xs flex-shrink-0">{style.icon}</span>
      <span className="text-xs font-bold">{text}</span>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] bg-sprout border-2 border-ink rounded-2xl rounded-br-md px-4 py-2.5">
          <p className="text-sm text-ink whitespace-pre-wrap">{msg.displayText}</p>
        </div>
      </div>
    );
  }

  const { cleanText, statusType, statusText } = msg.displayText
    ? parseStatus(msg.displayText)
    : { cleanText: null, statusType: null, statusText: null };

  // Placeholder assistant rows with no content (left behind when a stream
  // died mid-request) render as bare avatars — hide them entirely.
  if (!cleanText && (!msg.toolNotifications || msg.toolNotifications.length === 0)) {
    return null;
  }

  return (
    <div className="flex gap-2 mb-3 items-start">
      <div className="w-7 h-7 rounded-full border-2 border-ink flex-shrink-0 mt-0.5 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-64.png" alt="" className="w-full h-full" />
      </div>
      <div className="max-w-[85%] space-y-1">
        {msg.toolNotifications?.map((n, i) => (
          <ToolNotificationBadge key={i} notification={n} />
        ))}
        {cleanText && (
          <div className="bg-card border-2 border-ink rounded-2xl rounded-bl-md shadow-[2px_2px_0_var(--color-shade)] px-4 py-2.5">
            <ChatMarkdown text={cleanText} />
            {statusType && statusText && (
              <StatusStrip type={statusType} text={statusText} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionSidebar({
  sessions,
  currentId,
  open,
  onClose,
  basePath,
  title,
}: {
  sessions: SessionItem[];
  currentId: string | null;
  open: boolean;
  onClose: () => void;
  basePath: string;
  title: string;
}) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();

  return (
    <>
      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 bg-ink/40 z-40" onClick={onClose} />
      )}
      {/* Panel */}
      <div
        className={`fixed top-0 left-0 h-full w-72 bg-paper border-r-2 border-ink z-50 transform transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 border-b-2 border-shade flex items-center justify-between">
          <h2 className="font-extrabold text-sm text-ink">{title}</h2>
          <button onClick={onClose} className="text-moss hover:text-ink text-lg" aria-label={t("common.close")}>
            &times;
          </button>
        </div>
        <div className="p-2 border-b-2 border-shade">
          <button
            onClick={() => { router.push(basePath); onClose(); }}
            className="btn-brocco w-full text-left px-3 py-2 text-sm"
          >
            {t("chat.newConversation")}
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100%-110px)]">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => { router.push(`${basePath}/${s.id}`); onClose(); }}
              className={`w-full text-left px-4 py-3 border-b border-shade hover:bg-ghost transition-colors ${
                s.id === currentId ? "bg-ghost" : ""
              }`}
            >
              <p className="text-sm font-bold text-ink truncate">{s.title}</p>
              <p className="text-xs text-sage mt-0.5">{formatTime(s.updatedAt, lang)}</p>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export default function ChatUI({
  sessionId: initialSessionId,
  initialMessages,
  autoMessage,
  draftMessage,
  mode = "coach",
}: {
  sessionId: string | null;
  initialMessages: Message[];
  autoMessage?: string;
  /** Pre-fills the composer WITHOUT sending — the user finishes the sentence. */
  draftMessage?: string;
  mode?: "coach" | "kitchen";
}) {
  const router = useRouter();
  const kitchen = mode === "kitchen";
  const t = useT();
  const basePath = kitchen ? "/kitchen/chat" : "/chat";
  const sessionsUrl = `/api/chat/sessions${kitchen ? "?type=kitchen" : ""}`;
  const sessionBody = kitchen ? { type: "kitchen" } : {};
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState(draftMessage || "");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingNotifications, setStreamingNotifications] = useState<ToolNotification[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  // Follow the live stream only while the user is at the bottom. Scrolling up
  // to read detaches the auto-follow; scrolling back down re-attaches it.
  const pinnedRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Text in the composer before dictation started — live words append to it.
  const baseInputRef = useRef("");

  // Live word-by-word feedback while recording (Whisper still does the
  // real transcription on stop; this is what makes dictation feel alive).
  const liveSpeech = useLiveSpeech((text) => {
    setInput(baseInputRef.current ? `${baseInputRef.current} ${text}` : text);
  });

  // Detect MediaRecorder support
  useEffect(() => {
    setMicSupported(typeof window !== "undefined" && !!window.MediaRecorder);
  }, []);

  // Auto-grow the composer whenever its value changes — after the DOM has
  // the new value, so scrollHeight is measured on the real content. (The
  // old inline resize measured before React re-rendered: a dictated
  // message stayed one line tall.)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
    // While dictating, keep the newest words in view once the cap is hit
    if (recording) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  async function toggleRecording() {
    if (recording) {
      // Stop recording — MediaRecorder.onstop will handle transcription
      mediaRecorderRef.current?.stop();
      return;
    }

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
        // Stop all tracks to release mic
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const liveText = liveSpeech.stop();

        const chunks = audioChunksRef.current;
        if (chunks.length === 0) return;

        const blob = new Blob(chunks, { type: recorder.mimeType });
        setTranscribing(true);

        try {
          const form = new FormData();
          form.append("audio", blob, `recording.${recorder.mimeType.includes("webm") ? "webm" : "mp4"}`);

          const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
          const base = baseInputRef.current;
          if (res.ok) {
            const { text } = await res.json();
            // Whisper is the source of truth; the live transcript covers
            // for it when it comes back empty or the request fails.
            const finalText = (text as string)?.trim() || liveText;
            if (finalText) setInput(base ? `${base} ${finalText}` : finalText);
          } else if (liveText) {
            setInput(base ? `${base} ${liveText}` : liveText);
          }
        } catch {
          if (liveText) {
            const base = baseInputRef.current;
            setInput(base ? `${base} ${liveText}` : liveText);
          }
        } finally {
          setTranscribing(false);
          inputRef.current?.focus();
        }
      };

      baseInputRef.current = input.trim();
      recorder.start();
      liveSpeech.start();
      setRecording(true);
    } catch {
      // Mic permission denied or unavailable
    }
  }

  // Instant, not smooth: a smooth animation is still mid-flight when the next
  // streaming chunk lands, so the scroll handler reads an away-from-bottom
  // position and would wrongly unpin the auto-follow.
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView();
  }, []);

  useEffect(() => {
    if (pinnedRef.current) scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    // Small threshold so being a hair off the bottom still counts as pinned.
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Load sessions for sidebar
  useEffect(() => {
    fetch(sessionsUrl)
      .then((r) => r.json())
      .then((data) => setSessions(data.sessions || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;

    const res = await fetch("/api/chat/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sessionBody) });
    const data = await res.json();
    setSessionId(data.id);
    window.history.replaceState(null, "", `${basePath}/${data.id}`);
    // Opener is already fetched in the effect below
    return data.id;
  }

  // Auto-send Brocco opener for new general sessions
  // Or auto-send a pre-filled message if autoMessage is set
  useEffect(() => {
    if (initialSessionId || initialMessages.length > 0) return;

    let cancelled = false;
    async function initSession() {
      try {
        if (autoMessage) {
          // Create a new session and auto-send the pre-filled message
          const res = await fetch("/api/chat/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ forceNew: true, ...sessionBody }) });
          const data = await res.json();
          if (cancelled) return;
          setSessionId(data.id);
          window.history.replaceState(null, "", `${basePath}/${data.id}`);

          // Send the pre-filled message
          const chatRes = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: autoMessage, sessionId: data.id }),
          });
          if (cancelled || !chatRes.ok) return;

          const reader = chatRes.body?.getReader();
          if (!reader) return;
          const decoder = new TextDecoder();
          let accumulated = "";
          const notifications: ToolNotification[] = [];

          // Add user message
          setMessages([{
            id: `user-${Date.now()}`,
            role: "user",
            displayText: autoMessage,
          }]);

          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // SSE frames can straddle chunk boundaries. Splitting each chunk in
            // isolation drops any frame that got cut in half — which the `done`
            // frame now can be, since it carries the corrected message text.
            buffer += decoder.decode(value, { stream: true });
            const pending = buffer.split("\n");
            buffer = pending.pop() ?? "";
            for (const line of pending) {
              if (!line.startsWith("data: ")) continue;
              try {
                const d = JSON.parse(line.slice(6));
                if (d.text) {
                  accumulated += d.text;
                  setStreamingText(accumulated);
                }
                if (d.tool) {
                  notifications.push(d.tool as ToolNotification);
                  setStreamingNotifications([...notifications]);
                }
                if (d.done) {
                  // finalText arrives when the server corrected the status
                  // marker (a [STATUS:done] on a turn that changed nothing).
                  const finalText = (d.finalText as string) ?? accumulated;
                  setMessages(prev => [...prev, {
                    id: `assistant-${Date.now()}`,
                    role: "assistant",
                    displayText: finalText || null,
                    toolNotifications: notifications.length > 0 ? notifications : undefined,
                  }]);
                  setStreamingText("");
                  setStreamingNotifications([]);
                }
              } catch { /* skip */ }
            }
          }
        } else {
          // Get or reuse today's session
          const res = await fetch("/api/chat/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sessionBody) });
          const data = await res.json();
          if (cancelled) return;
          setSessionId(data.id);
          window.history.replaceState(null, "", `${basePath}/${data.id}`);

          if (data.reused) {
            // Load existing messages from today's session
            const sessRes = await fetch(`/api/chat/sessions/${data.id}`);
            if (cancelled) return;
            if (sessRes.ok) {
              const sessData = await sessRes.json();
              const existingMsgs = (sessData.messages || [])
                .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
                .map((m: { id: string; role: string; displayText: string | null }) => ({
                  id: m.id,
                  role: m.role as "user" | "assistant",
                  displayText: m.displayText,
                }));
              if (existingMsgs.length > 0) setMessages(existingMsgs);
            }
          }

          // The training-analysis opener belongs to the coach chat only.
          if (kitchen) return;

          // Ask the server for an opener. The server holds the gate (one
          // analysis per day, plus a fresh one when a new workout has landed
          // since the last) and answers { skipped: true } otherwise — no
          // client-side/localStorage trigger tracking, so phone and desktop
          // stay in sync.
          const openerRes = await fetch("/api/chat/opener", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: data.id }),
          });
          if (cancelled) return;
          if (openerRes.ok) {
            const d = await openerRes.json();
            if (d.opener) {
              setMessages((prev) => [
                ...prev,
                { id: `opener-${Date.now()}`, role: "assistant" as const, displayText: d.opener },
              ]);
            }
          }
        }
      } catch {
        // Non-critical, user can still type
      }
    }
    initSession();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    // Stop recording if active
    if (recording) {
      mediaRecorderRef.current?.stop();
    }

    setInput("");
    // Reset textarea height after clearing
    if (inputRef.current) inputRef.current.style.height = "auto";
    setSending(true);
    setStreamingText("");
    setStreamingNotifications([]);

    // Add user message optimistically. Sending always re-pins: your own
    // message (and the reply) should come into view even if you had
    // scrolled up beforehand.
    pinnedRef.current = true;
    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      displayText: text,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const sid = await ensureSession();

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: sid }),
      });

      if (!res.ok) {
        throw new Error("Chat request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let accumulated = "";
      const notifications: ToolNotification[] = [];

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // SSE frames can straddle chunk boundaries. Splitting each chunk in
        // isolation drops any frame that got cut in half — which the `done`
        // frame now can be, since it carries the corrected message text.
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            if (data.text) {
              accumulated += data.text;
              setStreamingText(accumulated);
            }
            if (data.tool) {
              notifications.push(data.tool as ToolNotification);
              setStreamingNotifications([...notifications]);
            }
            if (data.done) {
              // finalText arrives when the server corrected the status marker
              // (a [STATUS:done] on a turn that changed nothing).
              const finalText = (data.finalText as string) ?? accumulated;
              setMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: "assistant",
                  displayText: finalText || null,
                  toolNotifications: notifications.length > 0 ? notifications : undefined,
                },
              ]);
              setStreamingText("");
              setStreamingNotifications([]);
            }
            if (data.error) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `error-${Date.now()}`,
                  role: "assistant",
                  displayText: `Error: ${data.error}`,
                },
              ]);
              setStreamingText("");
              setStreamingNotifications([]);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          displayText: `Something went wrong. ${err instanceof Error ? err.message : ""}`,
        },
      ]);
      setStreamingText("");
      setStreamingNotifications([]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  // Enter inserts a newline (default textarea behavior).
  // Send only via the green send button.

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen max-w-2xl mx-auto">
      {/* Header */}
      <header className="safe-top flex items-center justify-between px-4 pb-2 border-b-2 border-ink/10 flex-shrink-0 bg-cream/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-moss hover:text-ink text-lg"
            title={t("chat.conversations")}
          >
            &#9776;
          </button>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-64.png" alt="Brocco" className="w-6 h-6 rounded-full border-2 border-ink" />
            <span className="font-bold text-sm text-ink md:text-lg md:font-extrabold">{kitchen ? "Brocco's kitchen 🍳" : "brocco.run"}</span>
          </div>
        </div>
        {/* Desktop nav only */}
        <DesktopNavLinks />
      </header>

      {/* Sidebar */}
      <SessionSidebar
        sessions={sessions}
        currentId={sessionId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        basePath={basePath}
        title={kitchen ? t("chat.kitchenChats") : t("chat.conversations")}
      />

      {/* Messages */}
      <div ref={scrollBoxRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !streamingText && (
          <div className="text-center py-16">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-ink" />
            {kitchen ? (
              <>
                <p className="text-sm font-bold text-ink">{t("chat.cooking")}</p>
                <p className="text-xs text-moss font-semibold mt-1 max-w-xs mx-auto">
                  Tell me what&apos;s in your fridge and I&apos;ll suggest something — your saved recipes and pantry staples included.
                </p>
              </>
            ) : (
              <span className="inline-block w-6 h-6 border-2 border-ink/20 border-t-ink rounded-full animate-spin" />
            )}
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {/* Streaming indicator */}
        {(streamingText || streamingNotifications.length > 0) && (
          <div className="flex gap-2 mb-3 items-start">
            <div className="w-7 h-7 rounded-full border-2 border-ink flex-shrink-0 mt-0.5 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/icon-64.png" alt="" className="w-full h-full" />
            </div>
            <div className="max-w-[85%] space-y-1">
              {streamingNotifications.map((n, i) => (
                <ToolNotificationBadge key={i} notification={n} />
              ))}
              {streamingText && (() => {
                const { cleanText, statusType, statusText } = parseStatus(streamingText);
                // Mirror the server's grounding while streaming: a green "done"
                // strip is only honest if a tool actually wrote something, and
                // a tool notification is exactly that signal. Without this the
                // raw [STATUS:done] shows green for the tail of the stream and
                // only flips to blue once the corrected text arrives.
                const shown =
                  statusType === "done" && streamingNotifications.length === 0
                    ? "info"
                    : statusType;
                return (
                  <div className="bg-card border-2 border-ink rounded-2xl rounded-bl-md shadow-[2px_2px_0_var(--color-shade)] px-4 py-2.5">
                    <ChatMarkdown text={cleanText} />
                    {shown && statusText && (
                      <StatusStrip type={shown} text={statusText} />
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="safe-bottom px-4 pt-3 border-t-2 border-ink bg-paper flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={recording ? (liveSpeech.supported ? t("chat.listening") : t("chat.listeningNoLive")) : kitchen ? t("chat.kitchenPlaceholder") : t("chat.placeholder")}
            rows={1}
            readOnly={recording}
            className={`field flex-1 resize-none ${recording ? "border-clay!" : ""}`}
            style={{ height: "auto", maxHeight: "200px", overflow: "auto" }}
            disabled={sending}
          />
          {micSupported && (
            <button
              onClick={toggleRecording}
              disabled={sending || transcribing}
              className={`p-2.5 flex-shrink-0 ${
                recording
                  ? "btn-danger animate-pulse"
                  : transcribing
                  ? "bg-[#faeed8] border-2 border-sun rounded-xl text-ink"
                  : "btn-brocco"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              title={recording ? t("chat.stopRecording") : transcribing ? t("chat.transcribing") : t("chat.voiceInput")}
            >
              {transcribing ? (
                <span className="inline-block w-5 h-5 border-2 border-ink/20 border-t-ink rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m-4 0h8M12 3a3 3 0 00-3 3v4a3 3 0 006 0V6a3 3 0 00-3-3z" />
                </svg>
              )}
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            aria-label={t("chat.send")}
            className="btn-brocco px-4 py-2.5 disabled:cursor-not-allowed flex-shrink-0"
          >
            {sending ? (
              <span className="inline-block w-5 h-5 border-2 border-ink/20 border-t-ink rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
