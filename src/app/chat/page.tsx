"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import ChatUI from "./chat-ui";

function ChatPageContent() {
  const searchParams = useSearchParams();
  // ?msg= auto-SENDS on arrival; ?draft= only pre-fills the composer, for
  // handoffs where the user still has something to add ("adjust this
  // workout: … here's what I want changed:").
  const msg = searchParams.get("msg") || undefined;
  const draft = searchParams.get("draft") || undefined;

  return <ChatUI sessionId={null} initialMessages={[]} autoMessage={msg} draftMessage={draft} />;
}

export default function NewChatPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><span className="inline-block w-6 h-6 border-2 border-ink/20 border-t-ink rounded-full animate-spin" /></div>}>
      <ChatPageContent />
    </Suspense>
  );
}
