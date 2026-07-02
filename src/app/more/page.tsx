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
    { name: "Training Plan", href: "/plan", emoji: "📅", desc: "Phases, weeks, and workouts" },
    { name: "History", href: "/history", emoji: "🏃", desc: "All past activities" },
    ...(features.notes ? [{ name: "Notes", href: "/notes", emoji: "📝", desc: "Quick facts, lists, and references" }] : []),
    { name: "Settings", href: "/settings", emoji: "⚙️", desc: "Profile, features, Strava, invites" },
  ];

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4">
      <PageHeader title="More" />
      <div className="mt-4 space-y-2 pb-8">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-4 py-3.5 transition-colors"
          >
            <span className="text-xl">{item.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-200">{item.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
            </div>
            <span className="text-gray-600">&rsaquo;</span>
          </Link>
        ))}
        <div className="pt-4 text-center">
          <Link href="/legal" className="text-xs text-gray-600 hover:text-gray-400">Imprint & Privacy</Link>
        </div>
      </div>
    </main>
  );
}
