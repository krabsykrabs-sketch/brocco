import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { normalizeStaples } from "@/lib/recipes";

/** GET /api/recipes/staples — the user's always-in-stock ingredient list */
export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { pantryStaples: true },
  });
  return NextResponse.json({ staples: normalizeStaples(profile?.pantryStaples) });
}

/** PUT /api/recipes/staples — replace the list. Body: { staples: string[] } */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const staples = normalizeStaples(body.staples);

  await prisma.userProfile.update({
    where: { userId: session.userId },
    data: { pantryStaples: staples },
  });
  return NextResponse.json({ staples });
}
