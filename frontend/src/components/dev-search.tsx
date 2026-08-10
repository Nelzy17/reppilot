"use client";

import { useActionState } from "react";

import { searchAction } from "@/app/dashboard/actions";
import type { DocumentSummary, SearchResult } from "@/lib/types";

const INITIAL: SearchResult = { kind: "idle" };
const PREVIEW_CHARS = 300;

export default function DevSearch({
  documents,
}: {
  documents: DocumentSummary[];
}) {
  const [state, formAction, pending] = useActionState(searchAction, INITIAL);

  // /search returns document_id; the filename comes from the list the page
  // already loaded, so no extra request is needed.
  const filenameById = new Map(documents.map((d) => [d.id, d.filename]));

  return (
    <section className="w-full max-w-xl">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Vector search
        </h2>
        <span className="text-xs text-amber-700 dark:text-amber-400">
          temporary M8 testing control
        </span>
      </div>

      <form action={formAction} className="flex items-center gap-3">
        <input
          type="search"
          name="query"
          required
          placeholder="e.g. what is the recommended daily dose?"
          disabled={pending}
          className="min-w-0 flex-1 rounded-full border border-black/[.08] bg-transparent px-4 py-2 text-sm outline-none focus:border-black/20 disabled:opacity-50 dark:border-white/[.145] dark:focus:border-white/30"
        />
        <button
          type="submit"
          disabled={pending}
          title="Dev-only: embeds the query and searches your own chunks"
          className="shrink-0 rounded-full border border-dashed border-amber-600/50 px-3 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 disabled:opacity-40 dark:text-amber-400"
        >
          {pending ? "Searching…" : "Search (dev)"}
        </button>
      </form>

      <div aria-live="polite" className="mt-3 text-sm">
        {state.kind === "error" && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            {state.message}
          </p>
        )}

        {state.kind === "success" && state.hits.length === 0 && (
          <p className="rounded-lg border border-black/[.08] px-3 py-2 text-xs text-zinc-600 dark:border-white/[.145] dark:text-zinc-400">
            No matches for &ldquo;{state.query}&rdquo;. Upload, process and embed
            a document first — or try different wording.
          </p>
        )}

        {state.kind === "success" && state.hits.length > 0 && (
          <>
            <p className="mb-2 text-xs text-zinc-500">
              {state.hits.length} result{state.hits.length === 1 ? "" : "s"} for
              &ldquo;{state.query}&rdquo;
            </p>
            <ol className="space-y-2">
              {state.hits.map((hit) => (
                <li
                  key={hit.chunk_id}
                  className="rounded-lg border border-black/[.08] p-3 dark:border-white/[.145]"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 font-mono tabular-nums">
                      {hit.score.toFixed(4)}
                    </span>
                    <span
                      className="min-w-0 truncate font-medium"
                      title={hit.document_id}
                    >
                      {filenameById.get(hit.document_id) ??
                        `${hit.document_id.slice(0, 8)}…`}
                    </span>
                    <span className="text-zinc-500">
                      chunk #{hit.chunk_index}
                    </span>
                  </div>
                  <p
                    className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400"
                    title={hit.content}
                  >
                    {hit.content.length > PREVIEW_CHARS
                      ? `${hit.content.slice(0, PREVIEW_CHARS)}…`
                      : hit.content}
                  </p>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
