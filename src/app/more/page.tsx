import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveFeatures } from "@/lib/features";
import { PageHeader } from "../nav";
import { translator } from "@/lib/dict";
import { isLang, langFromAcceptLanguage } from "@/lib/i18n";

export default async function MorePage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { features: true, language: true },
  });
  const features = resolveFeatures(profile?.features);
  // Server component — no hook here. A stored choice wins; without one, the
  // browser's Accept-Language stands in for the client-side detectLang().
  const lang = isLang(profile?.language)
    ? profile.language
    : langFromAcceptLanguage((await headers()).get("accept-language"));
  const t = translator(lang);

  const items = [
    { name: t("more.trainingPlan"), href: "/plan", emoji: "📅", desc: t("more.planDesc") },
    { name: t("nav.history"), href: "/history", emoji: "🏃", desc: t("more.historyDesc") },
    { name: t("nav.workouts"), href: "/workout", emoji: "💪", desc: t("more.workoutsDesc") },
    ...(features.kitchen ? [{ name: t("nav.kitchen"), href: "/kitchen", emoji: "🍳", desc: t("more.kitchenDesc") }] : []),
    { name: t("nav.settings"), href: "/settings", emoji: "⚙️", desc: t("more.settingsDesc") },
  ];

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4">
      <PageHeader title={t("nav.more")} />
      <div className="mt-4 space-y-2 pb-8">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 sticker sticker-press px-4 py-3.5"
          >
            <span className="text-xl">{item.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-ink">{item.name}</p>
              <p className="text-xs text-moss mt-0.5">{item.desc}</p>
            </div>
            <span className="text-sage">&rsaquo;</span>
          </Link>
        ))}
        <div className="pt-4 text-center">
          <Link href="/legal" className="text-xs text-sage hover:text-moss">Imprint & Privacy</Link>
        </div>
      </div>
    </main>
  );
}
