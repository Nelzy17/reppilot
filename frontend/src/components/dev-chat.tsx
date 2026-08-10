"use client";

import { useActionState } from "react";

import { chatAction } from "@/app/dashboard/actions";
import type { ChatResult } from "@/lib/types";

const INITIAL: ChatResult = { kind: "idle" };

export default function DevChat() {
  const [state, formAction, pending] = useActionState(chatAction, INITIAL);

  // Carry the session forward so follow-up questions stay in one conversation.
  const sessionId = state.kind === "success" ? state.session_id : "";

  return (
    <section className="w-full max-w-xl">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Ask your documents
        </h2>
        <span className="text-xs text-amber-700 dark:text-amber-400">
          temporary M9a testing control (non-streaming)
        </span>
      </div>

      <form action={formAction} className="flex items-center gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input
          type="text"
          name="query"
          required
          placeholder="e.g. what are the contraindications?"
          disabled={pending}
          className="min-w-0 flex-1 rounded-full border border-black/[.08] bg-transparent px-4 py-2 text-sm outline-none focus:border-black/20 disabled:opacity-50 dark:border-white/[.145] dark:focus:border-white/30"
        />
        <button
          type="submit"
          disabled={pending}
          title="Dev-only: retrieves context and answers with gpt-4o-mini"
          className="shrink-0 rounded-full border border-dashed border-amber-600/50 px-3 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 disabled:opacity-40 dark:text-amber-400"
        >
          {pending ? "Thinking…" : "Ask (dev)"}
        </button>
      </form>

      <div aria-live="polite" className="mt-3 text-sm">
        {state.kind === "error" && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            {state.message}
          </p>
        )}

        {state.kind === "success" && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500">
              Q: {state.question}
            </p>

            <div
              className={`rounded-lg border p-3 ${
                state.grounded
                  ? "border-black/[.08] dark:border-white/[.145]"
                  : "border-amber-600/30 bg-amber-500/5"
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    state.grounded
                      ? "bg-green-600/10 text-green-700 dark:text-green-400"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {state.grounded ? "grounded" : "not grounded — refused"}
                </span>
                <span className="truncate font-mono text-[10px] text-zinc-500">
                  session {state.session_id.slice(0, 8)}…
                </span>
              </div>

              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {state.answer}
              </p>
            </div>

            {state.sources.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-zinc-500">
                  Sources ({state.sources.length})
                </p>
                <ul className="space-y-1">
                  {state.sources.map((s, i) => (
                    <li
                      key={`${s.document}-${s.chunk_index}-${i}`}
                      className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
                    >
                      <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 font-mono tabular-nums">
                        {s.score.toFixed(4)}
                      </span>
                      <span className="min-w-0 truncate">{s.document}</span>
                      <span className="shrink-0 text-zinc-500">
                        chunk #{s.chunk_index}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
