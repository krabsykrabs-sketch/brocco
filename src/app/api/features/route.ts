import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveFeatures, ALL_FEATURES } from "@/lib/features";

/**
 * Lightweight per-user config read on every app load: feature flags plus the
 * chosen language. `language: null` means the user has never picked one, and
 * the client falls back to the browser's language.
 */
export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    // Defaults rather than 401 — the provider runs on public pages too
    return NextResponse.json({ features: ALL_FEATURES, language: null });
  }
  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { features: true, language: true },
  });
  return NextResponse.json({
    features: resolveFeatures(profile?.features),
    language: profile?.language ?? null,
  });
}
