"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function ToolNotificationBadge({ notification }: { notification: ToolNotification }) {
  const icons: Record<string, string> = {
    health_logged: "\u2764\ufe0f",
    activity_logged: "\ud83c\udfc3",
    plan_adjusted: "\ud83d\udd27",
    plan_created: "\ud83d\udcdd",
    plan_modified: "\ud83d\udd27",
  };

  return (
    <div className="flex items-center gap-2 bg-green-900/30 border border-green-800/40 rounded-lg px-3 py-1.5 text-xs text-green-300 mb-1">
      <span>{icons[notification.type] || "\u2705"}</span>
      <span>{notification.message}</span>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] bg-gray-800 rounded-2xl rounded-br-md px-4 py-2.5">
          <p className="text-sm text-gray-100 whitespace-pre-wrap">{msg.displayText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 mb-3 items-start">
      <div className="w-7 h-7 rounded-full bg-green-900/50 flex items-center justify-center flex-shrink-0 mt-0.5 text-sm">
        &#x1F966;
      </div>
      <div className="max-w-[85%] space-y-1">
        {msg.toolNotifications?.map((n, i) => (
          <ToolNotificationBadge key={i} notification={n} />
        ))}
        {msg.displayText && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl rounded-bl-md px-4 py-2.5">
            <p className="text-sm text-gray-200 whitespace-pre-wrap">{msg.displayText}</p>
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
}: {
  sessions: SessionItem[];
  currentId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  return (
    <>
      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      )}
      {/* Panel */}
      <div
        className={`fixed top-0 left-0 h-full w-72 bg-gray-950 border-r border-gray-800 z-50 transform transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="font-semibold text-sm">Conversations</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">
            &times;
          </button>
        </div>
        <div className="p-2 border-b border-gray-800">
          <button
            onClick={() => { router.push("/chat"); onClose(); }}
            className="w-full text-left px-3 py-2 text-sm bg-green-900/30 text-green-400 rounded-lg hover:bg-green-900/50 transition-colors"
          >
            + New conversation
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100%-110px)]">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => { router.push(`/chat/${s.id}`); onClose(); }}
              className={`w-full text-left px-4 py-3 border-b border-gray-900 hover:bg-gray-900 transition-colors ${
                s.id === currentId ? "bg-gray-900" : ""
              }`}
            >
              <p className="text-sm text-gray-200 truncate">{s.title}</p>
              <p className="text-xs text-gray-600 mt-0.5">{formatTime(s.updatedAt)}</p>
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
  startPlanCreation,
}: {
  sessionId: string | null;
  initialMessages: Message[];
  startPlanCreation?: boolean;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingNotifications, setStreamingNotifications] = useState<ToolNotification[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Detect MediaRecorder support
  useEffect(() => {
    setMicSupported(typeof window !== "undefined" && !!window.MediaRecorder);
  }, []);

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

        const chunks = audioChunksRef.current;
        if (chunks.length === 0) return;

        const blob = new Blob(chunks, { type: recorder.mimeType });
        setTranscribing(true);

        try {
          const form = new FormData();
          form.append("audio", blob, `recording.${recorder.mimeType.includes("webm") ? "webm" : "mp4"}`);

          const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
          if (res.ok) {
            const { text } = await res.json();
            if (text) {
              const newValue = input ? input + " " + text : text;
              setInput(newValue);
              if (inputRef.current) {
                inputRef.current.style.height = "auto";
                inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + "px";
              }
            }
          }
        } catch {
          // Transcription failed silently
        } finally {
          setTranscribing(false);
          inputRef.current?.focus();
        }
      };

      recorder.start();
      setRecording(true);
    } catch {
      // Mic permission denied or unavailable
    }
  }

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  // Load sessions for sidebar
  useEffect(() => {
    fetch("/api/chat/sessions")
      .then((r) => r.json())
      .then((data) => setSessions(data.sessions || []))
      .catch(() => {});
  }, [sessionId]);

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;

    const res = await fetch("/api/chat/sessions", { method: "POST" });
    const data = await res.json();
    setSessionId(data.id);
    window.history.replaceState(null, "", `/chat/${data.id}`);
    // Opener is already fetched in the effect below
    return data.id;
  }

  // Auto-send Brocco opener for new general sessions
  // Or start plan creation if startPlanCreation is set
  useEffect(() => {
    if (initialSessionId || initialMessages.length > 0) return;

    let cancelled = false;
    async function initSession() {
      try {
        if (startPlanCreation) {
          // Create a plan_creation session and send first message
          const res = await fetch("/api/plan/new-plan-session", { method: "POST" });
          const data = await res.json();
          if (cancelled) return;
          setSessionId(data.id);
          window.history.replaceState(null, "", `/chat/${data.id}`);

          // Send the first message to kick off the plan interview
          const chatRes = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "I'd like to build a training plan.", sessionId: data.id }),
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
            displayText: "I'd like to build a training plan.",
          }]);

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split("\n")) {
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
                  setMessages(prev => [...prev, {
                    id: `assistant-${Date.now()}`,
                    role: "assistant",
                    displayText: accumulated || null,
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
          const res = await fetch("/api/chat/sessions", { method: "POST" });
          const data = await res.json();
          if (cancelled) return;
          setSessionId(data.id);
          window.history.replaceState(null, "", `/chat/${data.id}`);

          if (data.reused) {
            // Load existing messages from today's session
            const sessRes = await fetch(`/api/chat/sessions/${data.id}`);
            if (cancelled) return;
            if (sessRes.ok) {
              const sessData = await sessRes.json();
              if (sessData.messages?.length > 0) {
                setMessages(
                  sessData.messages
                    .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
                    .map((m: { id: string; role: string; displayText: string | null }) => ({
                      id: m.id,
                      role: m.role as "user" | "assistant",
                      displayText: m.displayText,
                    }))
                );
                return;
              }
            }
          }

          // New session — request contextual opener
          const openerRes = await fetch("/api/chat/opener", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: data.id }),
          });
          if (cancelled) return;
          if (openerRes.ok) {
            const { opener } = await openerRes.json();
            setMessages([{
              id: `opener-${Date.now()}`,
              role: "assistant",
              displayText: opener,
            }]);
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

    // Add user message optimistically
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

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
              setMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: "assistant",
                  displayText: accumulated || null,
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0 bg-gray-950/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-400 hover:text-white text-lg"
            title="Conversations"
          >
            &#9776;
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xl">&#x1F966;</span>
            <span className="font-bold text-lg">brocco.run</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <Link href="/" className="hover:text-white transition-colors">Dashboard</Link>
          <Link href="/plan" className="hover:text-white transition-colors">Plan</Link>
          <Link href="/history" className="hover:text-white transition-colors">History</Link>
          <Link href="/settings" className="hover:text-white transition-colors">Settings</Link>
        </div>
      </header>

      {/* Sidebar */}
      <SessionSidebar
        sessions={sessions}
        currentId={sessionId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !streamingText && (
          <div className="text-center py-16">
            <p className="text-5xl mb-4">&#x1F966;</p>
            <span className="inline-block w-6 h-6 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {/* Streaming indicator */}
        {(streamingText || streamingNotifications.length > 0) && (
          <div className="flex gap-2 mb-3 items-start">
            <div className="w-7 h-7 rounded-full bg-green-900/50 flex items-center justify-center flex-shrink-0 mt-0.5 text-sm">
              &#x1F966;
            </div>
            <div className="max-w-[85%] space-y-1">
              {streamingNotifications.map((n, i) => (
                <ToolNotificationBadge key={i} notification={n} />
              ))}
              {streamingText && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl rounded-bl-md px-4 py-2.5">
                  <p className="text-sm text-gray-200 whitespace-pre-wrap">{streamingText}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-800 flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-expand: reset height then set to scrollHeight
              const el = e.target;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 160) + "px";
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask Brocco..."
            rows={1}
            className="flex-1 px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none text-sm"
            style={{ height: "auto", maxHeight: "160px", overflow: "auto" }}
            disabled={sending}
          />
          {micSupported && (
            <button
              onClick={toggleRecording}
              disabled={sending || transcribing}
              className={`p-2.5 rounded-xl transition-colors flex-shrink-0 ${
                recording
                  ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
                  : transcribing
                  ? "bg-yellow-600/50 text-yellow-300"
                  : "bg-gray-800 hover:bg-gray-700 text-gray-400"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              title={recording ? "Stop recording" : transcribing ? "Transcribing..." : "Voice input"}
            >
              {transcribing ? (
                <span className="inline-block w-5 h-5 border-2 border-yellow-300/30 border-t-yellow-300 rounded-full animate-spin" />
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
            className="px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-colors flex-shrink-0"
          >
            {sending ? (
              <span className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
