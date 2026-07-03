import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import WorkoutView from "./workout-view";

// Core coach feature — no feature flag, unlike the life-planner pages.
export default async function WorkoutPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  return <WorkoutView />;
}
