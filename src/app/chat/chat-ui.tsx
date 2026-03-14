"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Message {
  id: string;
  role: "user" | "assistant";
  displayText: string | null;
  toolNotifications?: ToolNotification[];
  pendingChange?: PendingChange;
}

interface ToolNotification {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

interface PendingChange {
  id: string;
  summary: string;
  status: "pending" | "approved" | "rejected" | "expired";
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
    plan_change_proposed: "\ud83d\udcdd",
  };

  return (
    <div className="flex items-center gap-2 bg-green-900/30 border border-green-800/40 rounded-lg px-3 py-1.5 text-xs text-green-300 mb-1">
      <span>{icons[notification.type] || "\u2705"}</span>
      <span>{notification.message}</span>
    </div>
  );
}

function PendingChangeCard({
  change,
  onAction,
}: {
  change: PendingChange;
  onAction: (id: string, action: "approve" | "reject") => void;
}) {
  if (change.status !== "pending") {
    const statusColors: Record<string, string> = {
      approved: "text-green-400",
      rejected: "text-red-400",
      expired: "text-gray-500",
    };
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm mb-2">
        <p className="text-gray-300">{change.summary}</p>
        <p className={`text-xs mt-1 ${statusColors[change.status] || "text-gray-500"}`}>
          {change.status.charAt(0).toUpperCase() + change.status.slice(1)}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 border border-yellow-700/50 rounded-lg px-3 py-2.5 mb-2">
      <p className="text-sm text-gray-200 mb-2">{change.summary}</p>
      <div className="flex gap-2">
        <button
          onClick={() => onAction(change.id, "approve")}
          className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded-md transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => onAction(change.id, "reject")}
          className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md transition-colors"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onPlanAction,
}: {
  msg: Message;
  onPlanAction: (id: string, action: "approve" | "reject") => void;
}) {
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
        {msg.pendingChange && (
          <PendingChangeCard change={msg.pendingChange} onAction={onPlanAction} />
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
}: {
  sessionId: string | null;
  initialMessages: Message[];
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    return data.id;
  }

  async function handlePlanAction(changeId: string, action: "approve" | "reject") {
    try {
      const res = await fetch("/api/plan/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: changeId, action }),
      });
      if (res.ok) {
        // Update the message in state
        setMessages((prev) =>
          prev.map((m) => {
            if (m.pendingChange?.id === changeId) {
              return {
                ...m,
                pendingChange: {
                  ...m.pendingChange,
                  status: action === "approve" ? "approved" : "rejected",
                },
              };
            }
            return m;
          })
        );
      }
    } catch {
      // ignore
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
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
      let pendingChange: PendingChange | undefined;

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
              const notif = data.tool as ToolNotification;
              notifications.push(notif);
              setStreamingNotifications([...notifications]);

              // Check for pending plan change
              if (notif.type === "plan_change_proposed" && notif.data?.pendingChangeId) {
                pendingChange = {
                  id: notif.data.pendingChangeId as string,
                  summary: notif.data.summary as string,
                  status: "pending",
                };
              }
            }
            if (data.done) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: "assistant",
                  displayText: accumulated || null,
                  toolNotifications: notifications.length > 0 ? notifications : undefined,
                  pendingChange,
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
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
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
            <span className="font-semibold">Brocco</span>
          </div>
        </div>
        <Link
          href="/"
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Dashboard
        </Link>
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
            <p className="text-gray-400 text-lg font-medium">Hey! I&apos;m Brocco.</p>
            <p className="text-gray-500 text-sm mt-1">
              Ask me about your training, races, or how your week went.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onPlanAction={handlePlanAction} />
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Brocco..."
            rows={1}
            className="flex-1 px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none text-sm"
            style={{ maxHeight: "120px" }}
            disabled={sending}
          />
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
