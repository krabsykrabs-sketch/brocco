import { requireFeature } from "@/lib/feature-guard";
import JournalView from "./journal-view";

export default async function JournalPage() {
  await requireFeature("journal");
  return <JournalView />;
}
