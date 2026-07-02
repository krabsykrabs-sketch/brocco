import { requireFeature } from "@/lib/feature-guard";
import CalendarView from "./calendar-view";

export default async function CalendarPage() {
  await requireFeature("calendar");
  return <CalendarView />;
}
