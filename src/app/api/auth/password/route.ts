import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { requestTranslator, userTranslator } from "@/lib/i18n-server";

export async function POST(request: NextRequest) {
  // Request language until we know who it is, then the profile's choice.
  let t = requestTranslator(request);
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    t = await userTranslator(session.userId);

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: t("api.auth.currentAndNewRequired") }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: t("api.auth.newPasswordMin") }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true },
    });

    if (!user) {
      return NextResponse.json({ error: t("api.userNotFound") }, { status: 404 });
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: t("api.auth.currentPasswordIncorrect") }, { status: 403 });
    }

    const newHash = await hashPassword(newPassword);
    // Invalidate every OTHER session; re-stamp this one so the device that
    // changed the password stays logged in.
    const updated = await prisma.user.update({
      where: { id: session.userId },
      data: { passwordHash: newHash, sessionEpoch: { increment: 1 } },
      select: { sessionEpoch: true },
    });
    session.epoch = updated.sessionEpoch;
    await session.save();

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: t("api.internalError") }, { status: 500 });
  }
}
