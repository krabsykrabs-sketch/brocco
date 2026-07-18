import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { testConnection, saveConnection, disconnect, syncWorkoutsToIntervals } from "@/lib/intervals-icu";

/**
 * POST /api/intervals — connect watch sync: verify the intervals.icu
 * credentials, store them (API key encrypted), and push the current plan
 * window right away so the user sees workouts appear.
 * Body: { athleteId, apiKey }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const athleteId = String(body.athleteId || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  if (!athleteId || !apiKey) {
    return NextResponse.json({ error: "athleteId and apiKey required" }, { status: 400 });
  }

  const test = await testConnection(athleteId, apiKey);
  if (!test.ok) {
    return NextResponse.json({ error: test.error }, { status: 400 });
  }

  await saveConnection(session.userId, athleteId, apiKey);
  const sync = await syncWorkoutsToIntervals(session.userId);

  return NextResponse.json({
    ok: true,
    athleteName: test.name || null,
    initialSync: sync,
  });
}

/** DELETE /api/intervals — disconnect watch sync (leaves events on the intervals.icu calendar). */
export async function DELETE() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await disconnect(session.userId);
  return NextResponse.json({ ok: true });
}
