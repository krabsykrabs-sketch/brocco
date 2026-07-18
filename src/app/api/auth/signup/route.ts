import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { getSession } from "@/lib/session";

// Shared access code gate. brocco.run isn't indexed or advertised anywhere,
// so a simple code handed to friends is deliberate — this is a bouncer for
// drive-by bots, not a security boundary. Override in env if it ever leaks
// (Coolify: SIGNUP_ACCESS_CODE).
const ACCESS_CODE = process.env.SIGNUP_ACCESS_CODE || "brocco2026";

export async function POST(request: NextRequest) {
  try {
    const { email, name, password, accessCode } = await request.json();

    if (!email || !name || !password || !accessCode) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    if (String(accessCode).trim().toLowerCase() !== ACCESS_CODE.toLowerCase()) {
      return NextResponse.json(
        { error: "Wrong access code — ask the person who invited you" },
        { status: 400 }
      );
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          name,
          passwordHash,
          inviteCode: "access-code",
        },
      });

      await tx.userProfile.create({
        data: {
          userId: newUser.id,
          onboardingCompleted: true,
        },
      });

      return newUser;
    });

    // Set session
    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    await session.save();

    return NextResponse.json({ ok: true, userId: user.id });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
