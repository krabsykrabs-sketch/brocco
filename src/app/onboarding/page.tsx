"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ---- Types ----

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

// ---- Step Indicator ----

function StepIndicator({ current }: { current: number }) {
  const labels = ["Strava", "Welcome", "Done"];
  return (
    <div className="flex items-center gap-2 mb-6">
      {labels.map((label, i) => (
        <div key={i} className="flex-1">
          <div
            className={`h-1.5 rounded-full transition-colors ${
              i < current
                ? "bg-green-500"
                : i === current
                ? "bg-green-400"
                : "bg-gray-700"
            }`}
          />
          <p
            className={`text-xs mt-1 text-center ${
              i <= current ? "text-gray-300" : "text-gray-600"
            }`}
          >
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---- Step 0: Strava Connect ----

function StepStrava({
  onSkip,
  onConnected,
  stravaConnected,
}: {
  onSkip: () => void;
  onConnected: () => void;
  stravaConnected: boolean;
}) {
  const [syncing, setSyncing] = useState(false);
  const [showDepthChoice, setShowDepthChoice] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  useEffect(() => {
    if (stravaConnected) {
      setShowDepthChoice(true);
    }
  }, [stravaConnected]);

  async function handleSync(depth: "quick" | "full") {
    setSyncing(true);
    setSyncResult(
      depth === "full"
        ? "Crunching your data... 🥦"
        : "Syncing recent activities..."
    );

    try {
      const res = await fetch("/api/onboarding/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depth }),
      });

      if (!res.ok) throw new Error("Sync failed");

      const data = await res.json();
      setSyncResult(`Imported ${data.newCount} ${data.newCount === 1 ? "activity" : "activities"} (${data.totalChecked} checked)!`);
      setTimeout(() => onConnected(), 1500);
    } catch {
      setSyncResult("Sync failed. You can try again later in Settings.");
      setTimeout(() => onConnected(), 2000);
    } finally {
      setSyncing(false);
    }
  }

  if (syncing || (syncResult && !showDepthChoice)) {
    return (
      <div className="text-center py-12">
        <p className="text-5xl mb-6">🥦</p>
        <p className="text-gray-200 text-lg">{syncResult}</p>
        {syncing && (
          <div className="mt-4 flex justify-center">
            <span className="inline-block w-6 h-6 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
          </div>
        )}
      </div>
    );
  }

  if (showDepthChoice) {
    return (
      <div className="text-center py-8">
        <p className="text-5xl mb-4">🥦</p>
        <h2 className="text-xl font-semibold mb-2">Strava connected!</h2>
        <p className="text-gray-400 text-sm mb-8">
          How far back should I look?
        </p>
        <div className="space-y-3">
          <button
            onClick={() => handleSync("quick")}
            className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
          >
            Quick sync (last 6 months)
          </button>
          <button
            onClick={() => handleSync("full")}
            className="w-full py-3 px-4 border border-gray-700 text-gray-300 hover:bg-gray-800 font-medium rounded-lg transition-colors"
          >
            Full history (everything)
          </button>
          <p className="text-xs text-gray-500">
            Full history takes longer but gives me deeper context about your
            training.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-8">
      <p className="text-5xl mb-4">🥦</p>
      <h2 className="text-2xl font-bold mb-2">Hey, I&apos;m Brocco.</h2>
      <p className="text-gray-400 mb-2 leading-relaxed">
        Your running coach. Before we get started, want to connect your Strava?
        It&apos;ll save us a lot of questions.
      </p>
      <p className="text-gray-500 text-sm mb-8">
        I&apos;ll use your activity data to give you better, more specific
        coaching from day one.
      </p>
      <div className="space-y-3">
        <a
          href="/api/strava/auth?returnTo=/onboarding"
          className="block w-full py-3 px-4 bg-[#FC4C02] hover:bg-[#e04400] text-white font-semibold rounded-lg transition-colors text-center"
        >
          Connect with Strava
        </a>
        <button
          onClick={onSkip}
          className="w-full py-3 px-4 text-gray-400 hover:text-gray-200 font-medium transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ---- Shared Chat Components ----

function ToolNotificationBadge({
  notification,
}: {
  notification: ToolNotification;
}) {
  const icons: Record<string, string> = {
    profile_updated: "✅",
    health_logged: "❤️",
    activity_logged: "🏃",
    plan_created: "📋",
    plan_modified: "🔧",
  };

  return (
    <div className="flex items-center gap-2 bg-green-900/30 border border-green-800/40 rounded-lg px-3 py-1.5 text-xs text-green-300 mb-1">
      <span>{icons[notification.type] || "✅"}</span>
      <span>{notification.message}</span>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] bg-gray-800 rounded-2xl rounded-br-md px-4 py-2.5">
          <p className="text-sm text-gray-100 whitespace-pre-wrap">
            {msg.displayText}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 mb-3 items-start">
      <div className="w-7 h-7 rounded-full bg-green-900/50 flex items-center justify-center flex-shrink-0 mt-0.5 text-sm">
        🥦
      </div>
      <div className="max-w-[85%] space-y-1">
        {msg.toolNotifications?.map((n, i) => (
          <ToolNotificationBadge key={i} notification={n} />
        ))}
        {msg.displayText && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl rounded-bl-md px-4 py-2.5">
            <p className="text-sm text-gray-200 whitespace-pre-wrap">
              {msg.displayText}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Plan Creation Chat (used during onboarding) ----

function PlanCreationChat({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingNotifications, setStreamingNotifications] = useState<
    ToolNotification[]
  >([]);
  const [interviewStarted, setInterviewStarted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  // Create session and send first message
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch("/api/plan/new-plan-session", { method: "POST" });
        const data = await res.json();
        setSessionId(data.id);

        // Check for existing messages (resuming)
        const sessRes = await fetch(`/api/chat/sessions/${data.id}`);
        if (sessRes.ok) {
          const sessData = await sessRes.json();
          if (sessData.messages && sessData.messages.length > 0) {
            setMessages(
              sessData.messages
                .filter(
                  (m: { role: string }) =>
                    m.role === "user" || m.role === "assistant"
                )
                .map(
                  (m: {
                    id: string;
                    role: string;
                    displayText: string | null;
                  }) => ({
                    id: m.id,
                    role: m.role as "user" | "assistant",
                    displayText: m.displayText,
                  })
                )
            );
            setInterviewStarted(true);
            return;
          }
        }

        setInterviewStarted(true);
        await sendMessage(data.id, "I'm ready to build my first training plan!");
      } catch (err) {
        console.error("Failed to init session:", err);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendMessage(sid: string, text: string) {
    setSending(true);
    setStreamingText("");
    setStreamingNotifications([]);

    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      displayText: text,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: sid }),
      });

      if (!res.ok) throw new Error("Chat request failed");

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
          try {
            const data = JSON.parse(line.slice(6));
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
                  toolNotifications:
                    notifications.length > 0 ? notifications : undefined,
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

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !sessionId) return;
    setInput("");
    await sendMessage(sessionId, text);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canFinish = !sending && !streamingText;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">🥦</span>
          <span className="font-semibold">Brocco</span>
          <span className="text-xs text-gray-500 ml-1">Building your plan</span>
        </div>
        <button
          onClick={onComplete}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Skip to dashboard →
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!interviewStarted && (
          <div className="text-center py-12">
            <span className="inline-block w-6 h-6 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
            <p className="text-gray-500 text-sm mt-3">
              Starting conversation...
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
          />
        ))}

        {(streamingText || streamingNotifications.length > 0) && (
          <div className="flex gap-2 mb-3 items-start">
            <div className="w-7 h-7 rounded-full bg-green-900/50 flex items-center justify-center flex-shrink-0 mt-0.5 text-sm">
              🥦
            </div>
            <div className="max-w-[85%] space-y-1">
              {streamingNotifications.map((n, i) => (
                <ToolNotificationBadge key={i} notification={n} />
              ))}
              {streamingText && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl rounded-bl-md px-4 py-2.5">
                  <p className="text-sm text-gray-200 whitespace-pre-wrap">
                    {streamingText}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {sending && !streamingText && !streamingNotifications.length && (
          <div className="flex gap-2 mb-3 items-start">
            <div className="w-7 h-7 rounded-full bg-green-900/50 flex items-center justify-center flex-shrink-0 mt-0.5 text-sm">
              🥦
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl rounded-bl-md px-4 py-2.5">
              <span className="inline-flex gap-1">
                <span
                  className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {canFinish && (
        <div className="px-4 py-2 flex-shrink-0">
          <button
            onClick={onComplete}
            className="w-full py-2.5 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors text-sm"
          >
            Go to dashboard →
          </button>
        </div>
      )}

      <div className="px-4 py-3 border-t border-gray-800 flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Talk to Brocco..."
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
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 12h14M12 5l7 7-7 7"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Main Page ----

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <span className="inline-block w-6 h-6 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
        </main>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/onboarding");
        if (!res.ok) return;
        const data = await res.json();

        if (data.onboardingCompleted) {
          router.push("/");
          return;
        }

        setStravaConnected(data.stravaConnected);

        const stravaParam = searchParams.get("strava");
        if (stravaParam === "connected") {
          setStravaConnected(true);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router, searchParams]);

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);
    try {
      await fetch("/api/onboarding", { method: "POST" });
      router.push("/");
      router.refresh();
    } catch {
      setFinishing(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <span className="inline-block w-6 h-6 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
      </main>
    );
  }

  // Step 2: Plan creation chat (optional, interruptible)
  if (step === 2) {
    return (
      <main className="h-screen flex flex-col max-w-2xl mx-auto">
        <div className="flex-1 flex flex-col min-h-0">
          <PlanCreationChat onComplete={handleFinish} />
        </div>
      </main>
    );
  }

  // Step 1: Welcome screen with choice
  if (step === 1) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm py-12">
          <StepIndicator current={1} />
          <div className="text-center py-8">
            <p className="text-5xl mb-4">🥦</p>
            <h2 className="text-2xl font-bold mb-3">
              Hey, I&apos;m Brocco.
            </h2>
            <p className="text-gray-400 mb-8 leading-relaxed">
              I can build you a training plan, or you can explore first.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => setStep(2)}
                className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
              >
                Build my plan
              </button>
              <button
                onClick={handleFinish}
                disabled={finishing}
                className="w-full py-3 px-4 border border-gray-700 text-gray-300 hover:bg-gray-800 font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {finishing ? "Setting up..." : "Let me look around first"}
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Step 0: Strava connect
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm py-12">
        <StepIndicator current={0} />
        <StepStrava
          stravaConnected={stravaConnected}
          onSkip={() => setStep(1)}
          onConnected={() => setStep(1)}
        />
      </div>
    </main>
  );
}
