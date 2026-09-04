import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { sendEmail, passwordResetEmail } from "@/lib/email";
import { requestTranslator } from "@/lib/i18n-server";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * POST /api/auth/forgot — request a password reset link.
 * Always answers with the same generic 200 whether or not the email exists,
 * so the endpoint can't be used to enumerate accounts.
 */
export async function POST(request: NextRequest) {
  const t = requestTranslator(request);
  try {
    const { email } = await request.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: t("api.auth.emailRequired") }, { status: 400 });
    }

    const normalized = email.toLowerCase().trim();
    const ip = clientIp(request);
    // Tight limits: reset emails are a spam vector and tokens are sensitive
    if (
      !rateLimit(`forgot:${normalized}`, 3, 15 * 60 * 1000) ||
      !rateLimit(`forgot-ip:${ip}`, 10, 15 * 60 * 1000)
    ) {
      return NextResponse.json(
        { error: t("api.auth.tooManyRequests") },
        { status: 429 }
      );
    }

    const genericResponse = NextResponse.json({
      ok: true,
      message: t("api.auth.resetSent"),
    });

    const user = await prisma.user.findUnique({ where: { email: normalized } });
    if (!user) return genericResponse;

    // Raw token only ever exists in the emailed link; we store its hash
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${process.env.BASE_URL}/reset-password?token=${token}`;
    const { subject, text } = passwordResetEmail(resetUrl);
    const sent = await sendEmail({ to: user.email, subject, text });
    if (!sent) {
      console.warn(`[forgot] Reset requested for ${user.email} but email delivery is not configured`);
    }

    return genericResponse;
  } catch {
    return NextResponse.json({ error: t("api.internalError") }, { status: 500 });
  }
}
