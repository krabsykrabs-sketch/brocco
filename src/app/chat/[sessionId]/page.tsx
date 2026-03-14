import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import ChatUI from "../chat-ui";

export default async function ChatSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const session = await getSession();
  if (!session.userId) {
    redirect("/login");
  }

  const { sessionId } = await params;

  const chatSession = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: session.userId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          displayText: true,
        },
      },
    },
  });

  if (!chatSession) {
    redirect("/chat");
  }

  const messages = chatSession.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      displayText: m.displayText,
    }));

  return <ChatUI sessionId={sessionId} initialMessages={messages} />;
}
