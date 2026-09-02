import type { Metadata, Viewport } from "next";
import { Nunito, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppFooter } from "./app-footer";
import { BottomTabBar } from "./bottom-tabs";
import { PWAInstallBanner } from "./pwa-banner";
import { StravaAutoSync } from "./strava-auto-sync";
import { ReminderWatcher } from "./reminder-watcher";
import { FeaturesProvider } from "./features-provider";
import { BootSplash } from "./boot-splash";
import ToastHost from "./toast-host";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";
import { prisma } from "@/lib/db";
import { DEFAULT_LANG, resolveLang, type Lang } from "@/lib/i18n";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "brocco.run — Run like a broccoli",
  description: "Your personal AI running coach",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Brocco",
  },
};

export const viewport: Viewport = {
  themeColor: "#faf6ea",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * The stored language preference, so `<html lang>` matches the UI (screen
 * readers, hyphenation, form validation messages). Signed-out visitors and
 * anyone without a stored choice get the default; the client provider still
 * picks up the browser guess for the strings themselves.
 */
async function htmlLang(): Promise<Lang> {
  try {
    // Cookie only — getSession() would add the session-epoch lookup, and this
    // runs on every page render just to pick a language.
    const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
    if (!session.userId) return DEFAULT_LANG;
    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.userId },
      select: { language: true },
    });
    return resolveLang(profile?.language);
  } catch {
    return DEFAULT_LANG;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = await htmlLang();
  return (
    <html lang={lang}>
      <head>
        <link rel="icon" href="/icons/icon-192.png" type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        {/* Boot splash artwork must paint immediately on app launch */}
        <link rel="preload" as="image" href="/brand/brocco-runner.png" />
      </head>
      <body
        className={`${nunito.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <BootSplash />
        <FeaturesProvider>
          {children}
          <AppFooter />
          <BottomTabBar />
          {/* The floating voice FAB used to sit on every tab. A second, separate
              chat outside the Chat tab was confusing, and it went unused — voice
              now lives only in Chat, which has its own mic. */}
          <StravaAutoSync />
          <ReminderWatcher />
          <ToastHost />
          <PWAInstallBanner />
        </FeaturesProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').then(function(r){console.log('SW registered, scope:',r.scope)}).catch(function(e){console.error('SW registration failed:',e)})}`,
          }}
        />
      </body>
    </html>
  );
}
