import { getIronSession, IronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export interface SessionData {
  userId: string;
  email: string;
  /** Mirrors User.sessionEpoch; a mismatch means the password or email
   * changed since this cookie was issued and it is no longer valid. */
  epoch?: number;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "brocco_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  // iron-session cookies are stateless, so a stolen cookie used to survive a
  // password reset for its whole 7-day life. One primary-key lookup per
  // request closes that: any epoch bump on the user invalidates every
  // cookie issued before it.
  if (session.userId) {
    const u = await prisma.user.findUnique({ where: { id: session.userId }, select: { sessionEpoch: true } });
    if (!u || u.sessionEpoch !== (session.epoch ?? 0)) session.destroy();
  }
  return session;
}
