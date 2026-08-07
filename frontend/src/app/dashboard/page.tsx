import { UserButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import DocumentList from "@/components/document-list";
import DocumentUpload from "@/components/document-upload";
import { getDocuments, getMe } from "@/lib/api";

// Resource-based protection: the page itself checks auth. The proxy only
// enables Clerk; it does not gate this route.
export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const [me, documents] = await Promise.all([getMe(), getDocuments()]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 font-sans">
      <div className="flex items-center gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome back, {user?.firstName ?? "there"}
        </h1>
        <UserButton />
      </div>

      <section className="w-full max-w-xl">
        <h2 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          GET /me — verified by FastAPI
        </h2>
        {me.ok ? (
          <pre className="overflow-x-auto rounded-lg border border-black/[.08] bg-black/[.03] p-4 text-sm dark:border-white/[.145] dark:bg-white/[.04]">
            {JSON.stringify(me.data, null, 2)}
          </pre>
        ) : (
          <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-400">
            {me.status ? `${me.status} — ` : ""}
            {me.error}
          </p>
        )}
      </section>

      <DocumentUpload />

      <section className="w-full max-w-xl">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Your documents
          </h2>
          <span className="text-xs text-amber-700 dark:text-amber-400">
            &ldquo;Process&rdquo; is a temporary M6 testing control
          </span>
        </div>
        {documents.ok ? (
          <DocumentList documents={documents.data} />
        ) : (
          <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-400">
            {documents.status ? `${documents.status} — ` : ""}
            {documents.error}
          </p>
        )}
      </section>

      <Link
        href="/"
        className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400"
      >
        Back to home
      </Link>
    </main>
  );
}
