import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { sendPushToUser, pushConfigured } from "@/lib/push";
import { userTranslator } from "@/lib/i18n-server";

/** POST /api/push/test — send a test notification to all of the user's devices. */
export async function POST() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const t = await userTranslator(session.userId);
  if (!pushConfigured()) {
    return NextResponse.json({ error: t("api.push.notConfigured") }, { status: 503 });
  }

  const { sent, pruned } = await sendPushToUser(session.userId, {
    title: t("push.testTitle"),
    body: t("push.testBody"),
    url: "/today",
    tag: "test",
  });

  return NextResponse.json({ ok: true, sent, pruned });
}
