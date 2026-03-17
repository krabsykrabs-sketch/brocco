import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "brocco.run — Run like a broccoli",
  description: "Your personal AI running coach",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <footer className="w-full flex justify-center items-center gap-3 py-4 opacity-60">
          <a
            href="https://www.strava.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-400 transition-colors"
          >
            Powered by
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-[#FC4C02]" aria-label="Strava">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
            </svg>
            <span className="text-[#FC4C02]">Strava</span>
          </a>
          <span className="text-gray-700">|</span>
          <a href="/legal" className="text-xs text-gray-500 hover:text-gray-400 transition-colors">
            Legal
          </a>
        </footer>
      </body>
    </html>
  );
}
