import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Brute-force protection: 10 attempts per 15 min per email+IP,
    // plus a wider per-IP cap against email enumeration sweeps.
    const ip = clientIp(request);
    const emailKey = `login:${String(email).toLowerCase().trim()}:${ip}`;
    if (
      !rateLimit(emailKey, 10, 15 * 60 * 1000) ||
      !rateLimit(`login-ip:${ip}`, 30, 15 * 60 * 1000) ||
      // No IP in this key: brute force against one account is capped even if
      // every request arrives with a different forged address.
      !rateLimit(`login-email:${email.toLowerCase()}`, 25, 60 * 60 * 1000)
    ) {
      return NextResponse.json(
        { error: "Too many attempts. Try again in a few minutes." },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    session.epoch = user.sessionEpoch;
    await session.save();

    return NextResponse.json({ ok: true, userId: user.id });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
