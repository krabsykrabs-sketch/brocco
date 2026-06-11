import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import TodayView from "./today-view";

export default async function TodayPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  return <TodayView />;
}
