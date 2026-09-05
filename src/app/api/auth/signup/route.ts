import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { requestTranslator } from "@/lib/i18n-server";

// Shared access code gate. brocco.run isn't indexed or advertised anywhere,
// so a simple code handed to friends is deliberate — this is a bouncer for
// drive-by bots, not a security boundary. Override in env if it ever leaks
// (Coolify: SIGNUP_ACCESS_CODE).
const ACCESS_CODE = process.env.SIGNUP_ACCESS_CODE || "brocco2026";

export async function POST(request: NextRequest) {
  const t = requestTranslator(request);
  try {
    // The only auth route that had no rate limit — and the one behind a
    // guessable shared code.
    const ip = clientIp(request);
    if (!rateLimit(`signup:${ip}`, 5, 60 * 60 * 1000)) {
      return NextResponse.json({ error: t("api.auth.tooManyAttemptsLater") }, { status: 429 });
    }

    const { email, name, password, accessCode } = await request.json();

    if (!email || !name || !password || !accessCode) {
      return NextResponse.json(
        { error: t("api.auth.allFieldsRequired") },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: t("api.auth.passwordMin") },
        { status: 400 }
      );
    }

    if (String(accessCode).trim().toLowerCase() !== ACCESS_CODE.toLowerCase()) {
      return NextResponse.json(
        { error: t("api.auth.wrongAccessCode") },
        { status: 400 }
      );
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existing) {
      return NextResponse.json(
        { error: t("api.auth.emailRegistered") },
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
          // False until the first-run sheet on Today has asked language,
          // sport and timezone; existing accounts were created with true.
          onboardingCompleted: false,
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
      { error: t("api.internalError") },
      { status: 500 }
    );
  }
}
