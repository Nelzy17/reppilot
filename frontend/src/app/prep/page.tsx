import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import PrepView from "@/components/prep/prep-view";

export const metadata: Metadata = {
  title: "Meeting prep · RepPilot",
  description: "Build a pre-call brief grounded in your uploaded documents.",
};

// Resource-based protection, same as /chat and /dashboard.
export default async function PrepPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return <PrepView />;
}
