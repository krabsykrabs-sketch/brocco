import { requireFeature } from "@/lib/feature-guard";
import ChatUI from "@/app/chat/chat-ui";

export default async function KitchenChatPage() {
  await requireFeature("kitchen");
  return <ChatUI sessionId={null} initialMessages={[]} mode="kitchen" />;
}
