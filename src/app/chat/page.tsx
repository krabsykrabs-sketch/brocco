"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import ChatUI from "./chat-ui";

function ChatPageContent() {
  const searchParams = useSearchParams();
  const startPlan = searchParams.get("startPlan") === "1";

  return <ChatUI sessionId={null} initialMessages={[]} startPlanCreation={startPlan} />;
}

export default function NewChatPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><span className="inline-block w-6 h-6 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" /></div>}>
      <ChatPageContent />
    </Suspense>
  );
}
