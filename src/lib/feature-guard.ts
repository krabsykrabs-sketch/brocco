import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveFeatures, type Features } from "@/lib/features";

/**
 * Server-side page guard: require login and a specific feature toggle.
 * Direct navigation (bookmark, old PWA shortcut) to a disabled feature's
 * page lands on Today instead of a hidden-but-working screen.
 */
export async function requireFeature(feature: keyof Features): Promise<void> {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { features: true },
  });
  if (!resolveFeatures(profile?.features)[feature]) redirect("/today");
}
