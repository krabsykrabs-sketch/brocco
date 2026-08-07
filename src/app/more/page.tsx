import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveFeatures } from "@/lib/features";
import { PageHeader } from "../nav";

export default async function MorePage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { features: true },
  });
  const features = resolveFeatures(profile?.features);

  const items = [
    { name: "Training Plan", href: "/plan", emoji: "📅", desc: "Phases, weekly targets, race countdown" },
    { name: "History", href: "/history", emoji: "🏃", desc: "All past activities" },
    { name: "Workouts", href: "/workout", emoji: "💪", desc: "Guided S&C sessions and interval timers" },
    ...(features.kitchen ? [{ name: "Kitchen", href: "/kitchen", emoji: "🍳", desc: "Recipe library, photo scans, cooking ideas" }] : []),
    { name: "Settings", href: "/settings", emoji: "⚙️", desc: "Profile, features, Strava, notifications" },
  ];

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4">
      <PageHeader title="More" />
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
