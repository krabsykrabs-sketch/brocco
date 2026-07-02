import { requireFeature } from "@/lib/feature-guard";
import NotesView from "./notes-view";

export default async function NotesPage() {
  await requireFeature("notes");
  return <NotesView />;
}
