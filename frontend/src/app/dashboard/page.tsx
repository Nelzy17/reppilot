import { UserButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import DocumentList from "@/components/document-list";
import DocumentStatusPoller from "@/components/document-status-poller";
import DocumentUpload from "@/components/document-upload";
import { getDocuments } from "@/lib/api";

// A document is still moving through the ingest pipeline until it reaches one
// of these.
const TERMINAL_STATUSES = new Set(["ready", "failed"]);

// Resource-based protection: the page itself checks auth. The proxy only
// enables Clerk; it does not gate this route.
export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const documents = await getDocuments();

  const pending = documents.ok
    ? documents.data.filter((d) => !TERMINAL_STATUSES.has(d.status)).length
    : 0;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 font-sans">
      <div className="flex items-center gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome back, {user?.firstName ?? "there"}
        </h1>
        <UserButton />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/chat"
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Open document assistant →
        </Link>
        <Link
          href="/prep"
          className="rounded-full border border-black/[.12] px-5 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.2] dark:hover:bg-white/[.06]"
        >
          Meeting prep →
        </Link>
        <Link
          href="/roleplay"
          className="rounded-full border border-black/[.12] px-5 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.2] dark:hover:bg-white/[.06]"
        >
          Practice →
        </Link>
        <Link
          href="/progress"
          className="rounded-full border border-black/[.12] px-5 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.2] dark:hover:bg-white/[.06]"
        >
          Progress →
        </Link>
      </div>

      <DocumentUpload />

      <section className="w-full max-w-xl">
        <h2 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Your documents
        </h2>
        {documents.ok ? (
          <DocumentList documents={documents.data} />
        ) : (
          <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-400">
            {documents.status ? `${documents.status} — ` : ""}
            {documents.error}
          </p>
        )}
      </section>

      <DocumentStatusPoller pending={pending} />

      <Link
        href="/"
        className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400"
      >
        Back to home
      </Link>
    </main>
  );
}
