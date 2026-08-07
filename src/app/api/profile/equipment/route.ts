import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { normalizeEquipment } from "@/lib/equipment";

/** GET /api/profile/equipment — kit the athlete owns */
export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { trainingEquipment: true },
  });
  return NextResponse.json({ equipment: normalizeEquipment(profile?.trainingEquipment) });
}

/** PUT /api/profile/equipment — replace the list. Body: { equipment: string[] } */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const equipment = normalizeEquipment(body.equipment);

  await prisma.userProfile.update({
    where: { userId: session.userId },
    data: { trainingEquipment: equipment },
  });
  // Echo the stored list back — normalisation may have dropped duplicates or
  // trimmed entries, and the client should render what was actually saved.
  return NextResponse.json({ equipment });
}
