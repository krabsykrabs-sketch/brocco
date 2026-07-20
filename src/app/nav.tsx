"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFeatures } from "./features-provider";

/**
 * Shared navigation. Desktop top-nav mirrors the mobile tab structure:
 * Today · Calendar · Chat · Tasks, plus the "More" pages inline. Links for
 * disabled features are hidden (see features-provider).
 */

const DESKTOP_LINKS = [
  { name: "Today", href: "/today", match: (p: string) => p === "/" || p.startsWith("/today") },
  { name: "Calendar", href: "/calendar", match: (p: string) => p.startsWith("/calendar"), feature: "calendar" as const },
  { name: "Chat", href: "/chat", match: (p: string) => p.startsWith("/chat") },
  { name: "Plan", href: "/plan", match: (p: string) => p.startsWith("/plan") },
  { name: "History", href: "/history", match: (p: string) => p.startsWith("/history") || p.startsWith("/activity") },
  { name: "Workouts", href: "/workout", match: (p: string) => p.startsWith("/workout") },
  { name: "Kitchen", href: "/kitchen", match: (p: string) => p.startsWith("/kitchen"), feature: "kitchen" as const },
  { name: "Settings", href: "/settings", match: (p: string) => p.startsWith("/settings") },
];

export function DesktopNavLinks() {
  const pathname = usePathname();
  const features = useFeatures();
  return (
    <div className="hidden md:flex items-center gap-4 text-sm">
      {DESKTOP_LINKS.filter((l) => !l.feature || features[l.feature]).map((l) => (
        <Link
          key={l.name}
          href={l.href}
          className={`transition-colors font-bold ${l.match(pathname) ? "text-ink" : "text-sage hover:text-ink"}`}
        >
          {l.name}
        </Link>
      ))}
    </div>
  );
}

/** Standard page header: branding + desktop links. Used by the new life-planner pages. */
export function PageHeader({ title, right }: { title?: string; right?: React.ReactNode }) {
  return (
    <nav className="safe-top sticky top-0 z-30 bg-cream/95 backdrop-blur-sm -mx-4 px-4 border-b-2 border-ink/10">
      <div className="flex items-center justify-between pb-2 md:pb-4">
        <div className="flex items-center gap-2 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-64.png" alt="Brocco" className="w-6 h-6 md:w-8 md:h-8 rounded-full border-2 border-ink" />
          <span className="font-extrabold text-sm text-ink md:text-lg truncate">
            {title || "brocco.run"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {right}
          <DesktopNavLinks />
        </div>
      </div>
    </nav>
  );
}
