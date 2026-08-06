import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { buildCoachContext, buildSystemPrompt } from "@/lib/coach-context";
import { toolsForFeatures, handleToolCall } from "@/lib/tools";
import { resolveFeatures } from "@/lib/features";
import { ensureFreshStravaData } from "@/lib/strava-fresh";

const anthropic = new Anthropic();

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, sessionId } = await request.json();

  if (!message || !sessionId) {
    return new Response(JSON.stringify({ error: "message and sessionId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify session ownership
  const chatSession = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: session.userId },
    select: { id: true, title: true, type: true, userId: true },
  });

  if (!chatSession) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const model = "claude-opus-4-6";

  // Pull anything new from Strava before building context (no-op if synced
  // in the last 15 min) — the coach must never claim a workout didn't
  // happen just because the once-a-day sync hasn't run since it did.
  await ensureFreshStravaData(session.userId);

  // Build context and system prompt
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { name: true },
  });
  const userName = user?.name || "Runner";

  const context = await buildCoachContext(session.userId);
  const systemPrompt = await buildSystemPrompt(
    session.userId,
    userName,
    context,
    chatSession.type === "kitchen" ? "kitchen" : "chat"
  );

  const profileFlags = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { features: true },
  });
  const tools = toolsForFeatures(resolveFeatures(profileFlags?.features));

  // Store user message
  await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "user",
      content: [{ type: "text", text: message }],
      displayText: message,
      contextSnapshot: context as unknown as object,
    },
  });

  // Load conversation history — the LAST 40 messages for this session.
  // (orderBy asc + take would return the FIRST 40, silently cutting off the
  // newest messages — including the one just sent — once a long-running
  // daily session grows past 40.)
  const historyDesc = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { role: true, content: true },
  });
  const history = historyDesc.reverse();

  // Build messages array for Anthropic
  const messages: Anthropic.MessageParam[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      // content is stored as JSON — could be an array of blocks, a string, or null
      const raw = m.content;
      let text = "";
      if (typeof raw === "string") {
        text = raw;
      } else if (Array.isArray(raw)) {
        text = (raw as Array<Record<string, unknown>>)
          .filter((b) => b && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("");
      }
      return {
        role: m.role as "user" | "assistant",
        content: text || "",
      };
    });

  // Stream the response with tool use support
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Large tool calls (generate_plan can output 70+ workouts as one JSON
      // blob) make Claude go silent on the wire for a minute or more while
      // it generates the arguments — no text streams during that time. A
      // silent connection reads as dead to the reverse proxy in front of
      // this app, which then drops it (surfaces to the client as a network
      // error, not an app error). A periodic SSE comment line keeps bytes
      // flowing without the client ever seeing it — chat-ui.tsx only acts
      // on lines starting with "data: ".
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          // Controller already closed (client disconnected) — nothing to do
        }
      }, 15000);

      try {
        // Create placeholder assistant message before tool loop
        // so tools like generate_plan/modify_plan can link to it
        const assistantMsg = await prisma.chatMessage.create({
          data: {
            sessionId,
            role: "assistant",
            content: [{ type: "text", text: "" }],
            displayText: "",
          },
        });

        const result = await runWithTools(
          systemPrompt,
          messages,
          session.userId,
          sessionId,
          assistantMsg.id,
          controller,
          encoder,
          model,
          tools
        );

        // Update assistant message with final text
        await prisma.chatMessage.update({
          where: { id: assistantMsg.id },
          data: {
            content: buildAssistantContent(result.fullText, result.toolLog),
            displayText: result.fullText,
          },
        });

        // Auto-generate title after first exchange
        const messageCount = await prisma.chatMessage.count({ where: { sessionId } });
        if (messageCount === 2 && chatSession.title === "New conversation") {
          generateTitle(sessionId, message, result.fullText).catch(() => {});
        }

        // Update session timestamp
        await prisma.chatSession.update({
          where: { id: sessionId },
          data: { updatedAt: new Date() },
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        controller.close();
      } catch (err) {
        console.error("Chat stream error:", err);
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: errorMsg })}\n\n`)
          );
          controller.close();
        } catch {
          // Controller already closed (client disconnected) — nothing to do
        }
      } finally {
        clearInterval(heartbeat);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

interface ToolUseResult {
  fullText: string;
  // One line per tool call with its real outcome. Persisted alongside the
  // assistant's text (see buildAssistantContent) so later turns in the same
  // conversation know which tools ran and whether they actually succeeded.
  toolLog: string[];
}

// Chat history is replayed as text only, so a tool call and its result would
// otherwise vanish the moment the turn ends — leaving the coach to re-assert
// that it made a change it has no record of making (or failing to make).
// This block is stored in `content` but never in `displayText`, so the model
// sees it on replay and the user never does.
function buildAssistantContent(fullText: string, toolLog: string[]) {
  const blocks: Array<{ type: "text"; text: string }> = [{ type: "text", text: fullText }];
  if (toolLog.length > 0) {
    blocks.push({
      type: "text",
      text:
        `\n\n[tool activity — internal record, never shown to the user]\n` +
        toolLog.join("\n") +
        `\nIf a tool FAILED, the change did not happen. Tell the user plainly instead of repeating the claim.`,
    });
  }
  return blocks;
}

async function runWithTools(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  userId: string,
  sessionId: string,
  chatMessageId: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  model: string,
  tools: Anthropic.Tool[],
  maxIterations = 5
): Promise<ToolUseResult> {
  let fullText = "";
  const toolLog: string[] = [];
  let currentMessages = [...messages];

  // High max_tokens needed because generate_plan can output 70+ workouts
  // as JSON in a single tool call (~12k+ tokens). Any session can trigger plan creation.
  const maxTokens = 32000;

  for (let i = 0; i < maxIterations; i++) {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: currentMessages,
      tools,
    });

    // Stream text chunks to client as they arrive
    stream.on("text", (text) => {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
      );
    });

    const response = await stream.finalMessage();

    // Detect truncation — if response was cut off, the tool call may be incomplete
    if (response.stop_reason === "max_tokens") {
      console.warn(`[chat] Response truncated (max_tokens=${maxTokens}, session=${sessionId})`);
    }

    // Process response content blocks
    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let textInThisTurn = "";

    for (const block of response.content) {
      if (block.type === "text") {
        textInThisTurn += block.text;
      } else if (block.type === "tool_use") {
        toolUseBlocks.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    fullText += textInThisTurn;

    // If no tool use, we're done
    if (toolUseBlocks.length === 0) {
      break;
    }

    // Execute tools and build tool results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      // Log generate_plan input for debugging
      if (toolUse.name === "generate_plan") {
        const inp = toolUse.input;
        const workouts = (inp.workouts as unknown[]) || [];
        const phases = (inp.phases as unknown[]) || [];
        console.log(`[generate_plan] plan="${inp.plan_name}", phases=${phases.length}, workouts=${workouts.length}`);
        if (workouts.length === 0) {
          console.warn(`[generate_plan] WARNING: workouts array is empty! Full input keys: ${Object.keys(inp).join(", ")}`);
        }
      }

      const result = await handleToolCall(
        toolUse.name,
        toolUse.input,
        userId,
        chatMessageId
      );

      toolLog.push(
        result.success
          ? `${toolUse.name} → OK: ${result.notification?.message ?? "applied"}`
          : `${toolUse.name} → FAILED: ${result.error ?? "unknown error"}`
      );

      if (!result.success) {
        console.warn(
          `[chat] tool ${toolUse.name} failed (session=${sessionId}): ${result.error}`
        );
      }

      if (result.notification) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ tool: result.notification })}\n\n`
          )
        );
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result.data || { error: result.error }),
      });
    }

    // Add assistant response + tool results to messages for next iteration
    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: response.content },
      { role: "user", content: toolResults },
    ];

    // If Claude signaled end_turn alongside tool use, run one more iteration
    // so it can produce a final text response after seeing tool results
    if (response.stop_reason === "end_turn") {
      // Execute one final turn to let Claude respond to tool results, then stop
      const finalStream = anthropic.messages.stream({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: currentMessages,
        tools,
      });

      finalStream.on("text", (text) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
        );
      });

      const finalResponse = await finalStream.finalMessage();

      for (const block of finalResponse.content) {
        if (block.type === "text") {
          fullText += block.text;
        }
      }
      break;
    }
  }

  return { fullText, toolLog };
}

async function generateTitle(sessionId: string, userMessage: string, assistantResponse: string) {
  try {
    const response = await anthropic.messages
      .stream({
        model: "claude-opus-4-6",
        max_tokens: 30,
        messages: [
          {
            role: "user",
            content: `Summarize this conversation in 3-5 words for a sidebar title. No quotes, no punctuation. Just the title.\n\nUser: ${userMessage}\nAssistant: ${assistantResponse.slice(0, 200)}`,
          },
        ],
      })
      .finalMessage();

    const title =
      response.content[0].type === "text"
        ? response.content[0].text.trim().slice(0, 60)
        : "Chat";

    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { title },
    });
  } catch {
    // Non-critical, ignore
  }
}
