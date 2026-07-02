import { requireFeature } from "@/lib/feature-guard";
import TasksView from "./tasks-view";

export default async function TasksPage() {
  await requireFeature("tasks");
  return <TasksView />;
}
