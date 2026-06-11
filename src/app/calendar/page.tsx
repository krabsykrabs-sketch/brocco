import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import CalendarView from "./calendar-view";

export default async function CalendarPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  return <CalendarView />;
}
