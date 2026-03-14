import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import Dashboard from "./dashboard";

export default async function Home() {
  const session = await getSession();
  if (!session.userId) {
    redirect("/login");
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
  });

  if (!profile || !profile.onboardingCompleted) {
    redirect("/onboarding");
  }

  return <Dashboard />;
}
