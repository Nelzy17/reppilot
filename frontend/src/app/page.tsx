import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";

import { API_URL } from "@/lib/config";

// Server-side only. `fetch` is uncached by default in Next 16, so this hits the
// API on every request.
async function getBackendStatus(): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/health`);
    if (!res.ok) return `error (HTTP ${res.status})`;
    const data: { status?: string } = await res.json();
    return data.status ?? "unknown";
  } catch {
    return "unreachable";
  }
}

export default async function Home() {
  const status = await getBackendStatus();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight">RepPilot</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Backend status: {status}
      </p>

      <nav className="flex items-center gap-4">
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]">
              Sign in
            </button>
          </SignInButton>
        </Show>

        <Show when="signed-in">
          <Link
            href="/dashboard"
            className="rounded-full border border-black/[.08] px-5 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            Dashboard
          </Link>
          <UserButton />
        </Show>
      </nav>
    </main>
  );
}
