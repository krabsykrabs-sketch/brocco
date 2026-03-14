import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import crypto from "crypto";

function generateInviteCode(): string {
  return crypto.randomBytes(6).toString("hex");
}

export async function POST() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const code = generateInviteCode();

    const invite = await prisma.inviteCode.create({
      data: {
        code,
        createdBy: session.userId,
      },
    });

    return NextResponse.json({ code: invite.code });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
