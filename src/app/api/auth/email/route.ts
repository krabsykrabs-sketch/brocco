import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { verifyPassword } from "@/lib/auth";

/**
 * POST /api/auth/email — change the account email (password-confirmed).
 * The email is the login identifier AND the password-recovery channel, so
 * this requires the current password even inside an authenticated session.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { newEmail, currentPassword } = await request.json();
    const normalized = String(newEmail || "").toLowerCase().trim();

    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    if (!currentPassword) {
      return NextResponse.json({ error: "Current password is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
    }

    if (normalized === user.email) {
      return NextResponse.json({ ok: true, email: normalized });
    }

    const taken = await prisma.user.findUnique({ where: { email: normalized } });
    if (taken) {
      return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { email: normalized, sessionEpoch: { increment: 1 } },
      select: { sessionEpoch: true },
    });

    // Keep the session cookie in sync with the login identifier
    session.email = normalized;
    session.epoch = updated.sessionEpoch;
    await session.save();

    return NextResponse.json({ ok: true, email: normalized });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
