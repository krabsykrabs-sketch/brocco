import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Dashboard from "./dashboard";

export default async function Home() {
  const session = await getSession();
  if (!session.userId) {
    redirect("/login");
  }

  return <Dashboard />;
}
