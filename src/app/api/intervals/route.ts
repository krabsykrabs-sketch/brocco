import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { testConnection, saveConnection, disconnect, syncWorkoutsToIntervals } from "@/lib/intervals-icu";
import { userTranslator } from "@/lib/i18n-server";

/**
 * POST /api/intervals — connect watch sync: verify the intervals.icu
 * credentials, store them (API key encrypted), and push the current plan
 * window right away so the user sees workouts appear.
 * Body: { athleteId, apiKey }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const t = await userTranslator(session.userId);
  const body = await request.json().catch(() => ({}));
  const athleteId = String(body.athleteId || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  if (!athleteId || !apiKey) {
    return NextResponse.json({ error: t("api.intervals.credentialsRequired") }, { status: 400 });
  }

  const test = await testConnection(athleteId, apiKey);
  if (!test.ok) {
    const error =
      test.error === "rejected_key"
        ? t("api.intervals.rejectedKey")
        : test.error === "unreachable"
          ? t("api.intervals.unreachable")
          : t("api.intervals.badStatus", { status: test.status ?? "?" });
    return NextResponse.json({ error }, { status: 400 });
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
