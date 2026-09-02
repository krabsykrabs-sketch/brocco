import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/lib/session";

const sessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "brocco_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7,
  },
};

const PUBLIC_PATHS = [
  "/login", "/signup", "/forgot-password", "/reset-password",
  "/api/auth/login", "/api/auth/signup", "/api/strava/webhook", "/api/calendar/ics",
  // Read on public pages by the provider; a redirect here fed HTML to r.json().
  "/api/features",
  // Container liveness — must work with no cookie.
  "/api/_health",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Allow static assets, PWA files, and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname === "/icon.png" || // Next.js app-router favicon (src/app/icon.png)
    pathname.startsWith("/api/auth/") ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname.startsWith("/icons/") ||
    // Mascot on the login/signup pages and exercise diagrams: static, public.
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/exercise-art/")
  ) {
    return NextResponse.next();
  }

  // Check session
  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(request, response, sessionOptions);

  if (!session.userId) {
    // API callers can't follow a redirect: every client does r.json(), which
    // then chokes on the login page's HTML and swallows the error — an
    // expired cookie looked like an empty app. A 401 lets them react.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
