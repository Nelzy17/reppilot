import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import ChatView from "@/components/chat/chat-view";

export const metadata: Metadata = {
  title: "Chat · RepPilot",
  description: "Ask questions answered only from your uploaded documents.",
};

// Resource-based protection, same as /dashboard: the page checks auth itself.
// The proxy only enables Clerk; it does not gate this route.
export default async function ChatPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return <ChatView />;
}
