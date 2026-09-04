import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { analyzeActivity } from "@/lib/activity-analysis";
import { userTranslator } from "@/lib/i18n-server";

/**
 * POST /api/activities/[id]/analyze — on-demand (re-)analysis.
 * Used for: activities that predate auto-analysis, non-running activities
 * the user wants analyzed anyway, or refreshing after a max-HR setting
 * change. Manual trigger only — never called from a batch/backfill path,
 * so it's not a rate-limit concern.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t = await userTranslator(session.userId);
  const { id } = await params;
  const activity = await prisma.activity.findFirst({
    where: { id, userId: session.userId },
    select: { id: true },
  });
  if (!activity) {
    return NextResponse.json({ error: t("api.notFound") }, { status: 404 });
  }

  try {
    const analysis = await analyzeActivity(session.userId, id);
    if (!analysis) {
      return NextResponse.json(
        { error: t("api.analyze.nothing") },
        { status: 422 }
      );
    }
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("Manual analyze error:", err);
    return NextResponse.json({ error: t("api.analyze.failed") }, { status: 500 });
  }
}
