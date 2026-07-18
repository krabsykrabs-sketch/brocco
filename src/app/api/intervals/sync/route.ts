import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { syncWorkoutsToIntervals } from "@/lib/intervals-icu";

/** POST /api/intervals/sync — manual "sync now" from Settings. */
export async function POST() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await syncWorkoutsToIntervals(session.userId);
  if (!result.synced) {
    return NextResponse.json(
      { error: result.error === "not_connected" ? "Watch sync isn't connected" : "Sync failed — try again" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, ...result });
}
