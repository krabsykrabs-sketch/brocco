import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { requestTranslator } from "@/lib/i18n-server";

/** POST /api/auth/reset — set a new password using an emailed reset token. */
export async function POST(request: NextRequest) {
  const t = requestTranslator(request);
  try {
    const { token, password } = await request.json();

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: t("api.auth.resetTokenMissing") }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: t("api.auth.passwordMin") }, { status: 400 });
    }

    // Brute-forcing a 256-bit token is hopeless anyway, but no free lunches
    if (!rateLimit(`reset-ip:${clientIp(request)}`, 10, 15 * 60 * 1000)) {
      return NextResponse.json({ error: t("api.auth.tooManyAttemptsLater") }, { status: 429 });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      return NextResponse.json(
        { error: t("api.auth.resetLinkInvalid") },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);
    await prisma.$transaction([
      // Bump the epoch: every existing session for this account is now invalid.
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash, sessionEpoch: { increment: 1 } } }),
      // Mark this token used and kill any other outstanding tokens for the user
      prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      prisma.passwordResetToken.deleteMany({
        where: { userId: reset.userId, usedAt: null, id: { not: reset.id } },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: t("api.internalError") }, { status: 500 });
  }
}
