import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveFeatures, ALL_FEATURES } from "@/lib/features";

/** Lightweight flags read for the client FeaturesProvider (called on every app load). */
export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    // Defaults rather than 401 — the provider runs on public pages too
    return NextResponse.json({ features: ALL_FEATURES });
  }
  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { features: true },
  });
  return NextResponse.json({ features: resolveFeatures(profile?.features) });
}
