import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { getSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    const { email, name, password, inviteCode } = await request.json();

    if (!email || !name || !password || !inviteCode) {
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

    // Validate invite code
    const invite = await prisma.inviteCode.findUnique({
      where: { code: inviteCode },
    });

    if (!invite || invite.usedBy) {
      return NextResponse.json(
        { error: "Invalid or already used invite code" },
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

    // Create user + profile + mark invite as used in a transaction
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          name,
          passwordHash,
          inviteCode,
        },
      });

      await tx.userProfile.create({
        data: {
          userId: newUser.id,
          onboardingCompleted: true,
        },
      });

      // Atomic redemption: the usedBy:null condition closes the race where
      // two concurrent signups both passed the pre-check above.
      const redeemed = await tx.inviteCode.updateMany({
        where: { code: inviteCode, usedBy: null },
        data: {
          usedBy: newUser.id,
          usedAt: new Date(),
        },
      });
      if (redeemed.count !== 1) {
        throw new Error("INVITE_ALREADY_USED");
      }

      return newUser;
    });

    // Set session
    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    await session.save();

    return NextResponse.json({ ok: true, userId: user.id });
  } catch (err) {
    if (err instanceof Error && err.message === "INVITE_ALREADY_USED") {
      return NextResponse.json(
        { error: "Invalid or already used invite code" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
