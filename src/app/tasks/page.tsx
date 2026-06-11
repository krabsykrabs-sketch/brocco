import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import TasksView from "./tasks-view";

export default async function TasksPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  return <TasksView />;
}
