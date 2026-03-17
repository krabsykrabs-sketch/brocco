"use client";

import { usePathname } from "next/navigation";

export function AppFooter() {
  const pathname = usePathname();

  // Hide footer on chat pages (full-screen layout with own header/input)
  if (pathname.startsWith("/chat")) return null;

  return (
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
  );
}
