import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getValidToken } from "@/lib/strava";
import { serverTranslator } from "@/lib/i18n-server";
import { resolveLang } from "@/lib/i18n";

/**
 * POST /api/strava/disconnect — unlink Strava without deleting the account
 * (previously the only way to disconnect). Best-effort deauthorize at
 * Strava's end, then clear the stored tokens and sync-health flags.
 * Imported activities are kept — they're the user's training history.
 */
export async function POST() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { stravaAccessToken: true, language: true },
  });
  if (!profile?.stravaAccessToken) {
    const t = serverTranslator(resolveLang(profile?.language));
    return NextResponse.json({ error: t("api.strava.notConnected") }, { status: 400 });
  }

  // Best-effort revoke on Strava's side — a dead token here must not stop
  // the local unlink (that's exactly the situation a broken connection is in).
  try {
    const token = await getValidToken(session.userId);
    await fetch("https://www.strava.com/oauth/deauthorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `access_token=${encodeURIComponent(token)}`,
    });
  } catch {
    // Token already invalid — nothing to revoke
  }

  await prisma.userProfile.update({
    where: { userId: session.userId },
    data: {
      stravaAccessToken: null,
      stravaRefreshToken: null,
      stravaAthleteId: null,
      stravaTokenExpiresAt: null,
      stravaLastSyncError: null,
      stravaNeedsReconnect: false,
    },
  });

  return NextResponse.json({ ok: true });
}
