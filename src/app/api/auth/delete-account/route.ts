import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { password } = await request.json();
    if (!password) {
      return NextResponse.json({ error: "Password required for confirmation" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 403 });
    }

    // Delete user — cascades to all related tables (profile, plans, activities, chat, health, etc.)
    await prisma.user.delete({
      where: { id: session.userId },
    });

    // Clear session
    session.destroy();

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
