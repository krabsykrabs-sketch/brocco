import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import NotesView from "./notes-view";

export default async function NotesPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  return <NotesView />;
}
