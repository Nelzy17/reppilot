import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { fetchPersonaCatalogue } from "@/app/roleplay/actions";
import RoleplayView from "@/components/roleplay/roleplay-view";

export const metadata: Metadata = {
  title: "Practice · RepPilot",
  description: "Rehearse a detailing conversation against a simulated physician.",
};

// Resource-based protection, same as /chat, /prep and /dashboard.
export default async function RoleplayPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const catalogue = await fetchPersonaCatalogue();

  return <RoleplayView catalogue={catalogue} />;
}
