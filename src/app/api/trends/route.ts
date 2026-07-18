import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPaceCurve, getWeeklyZoneMix } from "@/lib/run-trends";

/** GET /api/trends — 90-day pace curve + 8-week zone mix for the History page. */
export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [paceCurve, weeklyZones] = await Promise.all([
    getPaceCurve(session.userId, 90),
    getWeeklyZoneMix(session.userId, 8),
  ]);

  return NextResponse.json({ paceCurve, weeklyZones });
}
