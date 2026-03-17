import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { buildCoachContext, buildSystemPrompt, buildOnboardingSystemPrompt, buildPlanCreationSystemPrompt } from "@/lib/coach-context";
import { toolDefinitions, handleToolCall } from "@/lib/tools";

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

  // Build context and system prompt
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { name: true },
  });
  const userName = user?.name || "Runner";

  let systemPrompt: string;
  let context: string;
  if (chatSession.type === "onboarding") {
    systemPrompt = await buildOnboardingSystemPrompt(session.userId, userName);
    context = "";
  } else if (chatSession.type === "plan_creation") {
    systemPrompt = await buildPlanCreationSystemPrompt(session.userId, userName);
    context = "";
  } else {
    context = await buildCoachContext(session.userId);
    systemPrompt = buildSystemPrompt(userName, context);
  }

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

  // Load conversation history (last 40 messages for this session)
  const history = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    take: 40,
    select: { role: true, content: true },
  });

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
          model
        );

        // Update assistant message with final text
        await prisma.chatMessage.update({
          where: { id: assistantMsg.id },
          data: {
            content: [{ type: "text", text: result.fullText }],
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
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: errorMsg })}\n\n`)
        );
        controller.close();
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
  maxIterations = 5
): Promise<ToolUseResult> {
  let fullText = "";
  let currentMessages = [...messages];

  for (let i = 0; i < maxIterations; i++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: currentMessages,
      tools: toolDefinitions,
    });

    // Process response content blocks
    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let textInThisTurn = "";

    for (const block of response.content) {
      if (block.type === "text") {
        textInThisTurn += block.text;
        // Stream each text block to client
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: block.text })}\n\n`)
        );
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
      const result = await handleToolCall(
        toolUse.name,
        toolUse.input,
        userId,
        chatMessageId
      );

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
      const finalResponse = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: currentMessages,
        tools: toolDefinitions,
      });

      for (const block of finalResponse.content) {
        if (block.type === "text") {
          fullText += block.text;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: block.text })}\n\n`)
          );
        }
      }
      break;
    }
  }

  return { fullText };
}

async function generateTitle(sessionId: string, userMessage: string, assistantResponse: string) {
  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 30,
      messages: [
        {
          role: "user",
          content: `Summarize this conversation in 3-5 words for a sidebar title. No quotes, no punctuation. Just the title.\n\nUser: ${userMessage}\nAssistant: ${assistantResponse.slice(0, 200)}`,
        },
      ],
    });

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
