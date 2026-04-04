"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import ChatUI from "./chat-ui";

function ChatPageContent() {
  const searchParams = useSearchParams();
  const msg = searchParams.get("msg") || undefined;

  return <ChatUI sessionId={null} initialMessages={[]} autoMessage={msg} />;
}

export default function NewChatPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><span className="inline-block w-6 h-6 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" /></div>}>
      <ChatPageContent />
    </Suspense>
  );
}
