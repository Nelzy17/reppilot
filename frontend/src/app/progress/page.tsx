import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import ProgressView from "@/components/progress/progress-view";
import { getProgress } from "@/lib/api";

export const metadata: Metadata = {
  title: "Progress · RepPilot",
  description: "Your roleplay coaching scores over time.",
};

// Resource-based protection, same as the other pages.
export default async function ProgressPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const progress = await getProgress();

  return (
    <div className="rp-surface flex min-h-dvh flex-col">
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
              RepPilot
            </span>
            <h1 className="truncate text-sm text-muted">Progress</h1>
          </div>
          <nav className="flex shrink-0 items-center gap-1">
            <a
              href="/chat"
              className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              Assistant
            </a>
            <a
              href="/prep"
              className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              Meeting prep
            </a>
            <a
              href="/roleplay"
              className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              Practice
            </a>
            <a
              href="/dashboard"
              className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              Documents
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        {progress.ok ? (
          <ProgressView progress={progress.data} />
        ) : (
          <div className="rounded-xl border border-critical/35 bg-critical-bg px-5 py-4">
            <h2 className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-critical">
              Couldn&rsquo;t load your progress
            </h2>
            <p className="text-[14px] leading-relaxed text-ink">
              {progress.message}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
