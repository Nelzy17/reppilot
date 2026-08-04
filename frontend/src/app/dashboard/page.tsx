import { UserButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

// Resource-based protection: the page itself checks auth. The proxy only
// enables Clerk; it does not gate this route.
export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 font-sans">
      <div className="flex items-center gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome back, {user?.firstName ?? "there"}
        </h1>
        <UserButton />
      </div>
      <Link
        href="/"
        className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400"
      >
        Back to home
      </Link>
    </main>
  );
}
