import { requireFeature } from "@/lib/feature-guard";
import KitchenView from "./kitchen-view";

export default async function KitchenPage() {
  await requireFeature("kitchen");
  return <KitchenView />;
}
