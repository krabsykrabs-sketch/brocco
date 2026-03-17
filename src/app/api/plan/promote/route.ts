import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { promoteWeekDetails } from "@/lib/promote-weeks";

/**
 * POST /api/plan/promote — Trigger weekly promotion of plan detail levels.
 * Called on first dashboard/plan visit each week.
 */
export async function POST() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await promoteWeekDetails(session.userId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Promotion error:", err);
    return NextResponse.json({ error: "Promotion failed" }, { status: 500 });
  }
}
