import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { buildCoachContext, buildSystemPrompt } from "@/lib/coach-context";
import { toolsForFeatures, handleToolCall } from "@/lib/tools";
import { groundStatusMarker, buildAssistantContent } from "@/app/api/chat/route";
import { resolveFeatures } from "@/lib/features";
import { nowInTimezone } from "@/lib/schedule";
import { COACH_MODEL } from "@/lib/models";

const anthropic = new Anthropic();

interface ScreenContext {
  name?: string; // today | calendar | tasks | plan | ...
  view?: string; // day | week | month | list name...
  rangeStart?: string;
  rangeEnd?: string;
  selectedItem?: { type: string; id: string; title?: string; date?: string };
}

/**
 * POST /api/capture — voice-first quick capture.
 * Body: { text, screen? }
 * Returns { result: "done", toast, mutations, say? } or { result: "clarify", question }.
 * The exchange is persisted into today's general chat session so the
 * conversation record stays complete.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.userId;

  let body: { text?: string; screen?: ScreenContext };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  // --- Get or create today's general chat session ---
  // "Today" in the USER's timezone: derive the instant of their local
  // midnight from the wall-clock elapsed time, so a morning capture in
  // Sydney doesn't land in yesterday's session on a UTC server.
  const profileTz = await prisma.userProfile.findUnique({
    where: { userId },
    select: { timezone: true, features: true },
  });
  const tools = toolsForFeatures(resolveFeatures(profileTz?.features));
  const localNow = nowInTimezone(profileTz?.timezone || "Europe/Berlin");
  const [hh, mm] = localNow.slice(11, 16).split(":").map(Number);
  const localDayStart = new Date(Date.now() - (hh * 60 + mm) * 60 * 1000);

  let chatSession = await prisma.chatSession.findFirst({
    where: {
      userId,
      type: "general",
      createdAt: { gte: localDayStart },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!chatSession) {
    chatSession = await prisma.chatSession.create({
      data: { userId, title: "New conversation" },
      select: { id: true },
    });
  }
  const sessionId = chatSession.id;

  // --- Build prompt ---
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const context = await buildCoachContext(userId);
  const { staticPart, dynamicPart } = await buildSystemPrompt(userId, user?.name || "Runner", context, "capture");
  // Same cache split as the chat route — captures share the user's cached
  // static prefix across the day's interactions; the volatile context rides
  // as a trailing system message.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: staticPart, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];

  const screenBlock = buildScreenBlock(body.screen);
  const modelText = screenBlock ? `${text}\n\n${screenBlock}` : text;

  // --- Persist user message (model sees screen context; UI shows the transcript) ---
  await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "user",
      content: [{ type: "text", text: modelText }],
      displayText: `🎤 ${text}`,
    },
  });

  // --- History: recent messages from today's session (clarify continuity) ---
  const history = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { role: true, content: true },
  });
  const rawMessages = history
    .reverse()
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const raw = m.content;
      let t = "";
      if (typeof raw === "string") t = raw;
      else if (Array.isArray(raw)) {
        t = (raw as Array<Record<string, unknown>>)
          .filter((b) => b && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("");
      }
      return { role: m.role as "user" | "assistant", content: t || "…" };
    });

  // The Anthropic API requires user-first, strictly alternating roles. A
  // truncated take-N window can start mid-conversation on an assistant
  // message, and a previously failed capture can leave two user messages in
  // a row — repair by dropping leading assistants and merging consecutive
  // same-role messages.
  const messages: Anthropic.MessageParam[] = [];
  for (const m of rawMessages) {
    if (messages.length === 0 && m.role === "assistant") continue;
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n${m.content}`;
    } else {
      messages.push({ ...m });
    }
  }
  // Cache marker on the shared prefix's end, volatile context after it —
  // mirrors the chat route (see there for why). MessageParam's role type
  // lags the API's mid-conversation system support, hence the cast.
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && typeof lastMsg.content === "string") {
    lastMsg.content = [
      { type: "text", text: lastMsg.content, cache_control: { type: "ephemeral" } },
    ];
  }
  messages.push({ role: "system", content: dynamicPart } as unknown as Anthropic.MessageParam);

  // --- Tool loop (non-streaming, small budget — captures must be snappy) ---
  const notifications: Array<{ type: string; message: string; data?: Record<string, unknown> }> = [];
  const toolLog: string[] = [];
  let appliedMutation = false;
  let finalText = "";
  let currentMessages = [...messages];

  try {
    const MAX_ITERATIONS = 4;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await anthropic.messages.create({
        model: COACH_MODEL,
        // Thinking shares this cap on Opus 5; low effort keeps captures
        // snappy — exactly the terse, act-immediately behavior capture wants.
        max_tokens: 8000,
        output_config: { effort: "low" },
        system: systemBlocks,
        messages: currentMessages,
        tools,
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      const turnText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      finalText = turnText || finalText;

      if (toolUses.length === 0) break;
      if (response.stop_reason === "max_tokens") {
        // Half-formed tool arguments — never execute them.
        finalText = "";
        break;
      }

      // Text accompanying a tool call describes an intent, not the outcome.
      // If this turns out to be the last iteration, returning it as `say`
      // would misreport what actually happened — the toasts are the truth.
      if (i === MAX_ITERATIONS - 1) finalText = "";

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        let result: Awaited<ReturnType<typeof handleToolCall>>;
        try {
          result = await handleToolCall(tu.name, tu.input as Record<string, unknown>, userId);
        } catch (err) {
          console.error(`[capture] tool ${tu.name} threw:`, err);
          result = { success: false, error: "The tool crashed on that input." };
        }
        toolLog.push(
          result.success
            ? `${tu.name} → OK: ${result.notification?.message ?? "applied"}`
            : `${tu.name} → FAILED: ${result.error ?? "unknown error"}`
        );
        if (result.notification) {
          appliedMutation = true;
          notifications.push(result.notification);
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result.data || { error: result.error }),
        });
      }
      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ];
    }
  } catch (err) {
    console.error("Capture error:", err);
    return NextResponse.json({ error: "Capture failed — try again or use the chat." }, { status: 502 });
  }

  // --- Persist assistant side ---
  // Capture uses the same system prompt as chat, so the model can still emit a
  // [STATUS:done] here despite being told not to — and this row is rendered by
  // the normal chat UI later, green strip and all. Ground it the same way.
  const groundedFinal = groundStatusMarker(finalText, appliedMutation);
  const persistText =
    [notifications.map((n) => `✓ ${n.message}`).join("\n"), groundedFinal].filter(Boolean).join("\n") ||
    "(no response)";
  await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "assistant",
      // Same tool-activity record as the chat route, so a later chat turn in
      // this session knows what the capture actually did.
      content: buildAssistantContent(groundedFinal || persistText, toolLog),
      displayText: groundStatusMarker(persistText, appliedMutation),
    },
  });
  await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });

  // --- Shape the response ---
  if (notifications.length > 0) {
    const mutations = Array.from(
      new Set(
        notifications.map((n) => (n.data?.domain as string) || domainFromType(n.type)).filter(Boolean)
      )
    );
    return NextResponse.json({
      result: "done",
      toast: notifications.map((n) => n.message),
      say: finalText || null,
      mutations,
    });
  }

  // No tool call → Brocco is asking something or answering a question
  return NextResponse.json({
    result: "clarify",
    question: finalText || "Sorry, I didn't catch that — try again?",
  });
}

function buildScreenBlock(screen?: ScreenContext): string {
  if (!screen || !screen.name) return "";
  const lines = [`SCREEN CONTEXT: The user is looking at the ${screen.name} screen.`];
  if (screen.view) lines.push(`View: ${screen.view}.`);
  if (screen.rangeStart && screen.rangeEnd) lines.push(`Visible date range: ${screen.rangeStart} to ${screen.rangeEnd}.`);
  if (screen.selectedItem) {
    const s = screen.selectedItem;
    lines.push(`Selected item: ${s.type} "${s.title || s.id}"${s.date ? ` on ${s.date}` : ""} (id: ${s.id}).`);
  }
  return lines.join(" ");
}

function domainFromType(type: string): string | null {
  if (type.startsWith("event_")) return "calendar";
  if (type.startsWith("task_") || type.startsWith("list_")) return "tasks";
  if (type.startsWith("note_")) return "notes";
  if (type.startsWith("plan_")) return "plan";
  if (type === "health_logged") return "health";
  if (type === "activity_logged") return "activities";
  return null;
}
