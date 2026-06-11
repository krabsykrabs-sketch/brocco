import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { buildCoachContext, buildSystemPrompt } from "@/lib/coach-context";
import { toolDefinitions, handleToolCall } from "@/lib/tools";
import { startOfDay, endOfDay } from "date-fns";

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
  const now = new Date();
  let chatSession = await prisma.chatSession.findFirst({
    where: {
      userId,
      type: "general",
      createdAt: { gte: startOfDay(now), lte: endOfDay(now) },
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
  const systemPrompt = await buildSystemPrompt(userId, user?.name || "Runner", context, "capture");

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
  const messages: Anthropic.MessageParam[] = history
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

  // --- Tool loop (non-streaming, small budget — captures must be snappy) ---
  const notifications: Array<{ type: string; message: string; data?: Record<string, unknown> }> = [];
  let finalText = "";
  let currentMessages = [...messages];

  try {
    for (let i = 0; i < 4; i++) {
      const response = await anthropic.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 2000,
        system: systemPrompt,
        messages: currentMessages,
        tools: toolDefinitions,
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

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const result = await handleToolCall(tu.name, tu.input as Record<string, unknown>, userId);
        if (result.notification) notifications.push(result.notification);
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
  const persistText =
    [notifications.map((n) => `✓ ${n.message}`).join("\n"), finalText].filter(Boolean).join("\n") ||
    "(no response)";
  await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "assistant",
      content: [{ type: "text", text: finalText || persistText }],
      displayText: persistText,
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
