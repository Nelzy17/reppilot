"use client";

import { useActionState } from "react";

import {
  embedDocumentAction,
  processDocumentAction,
} from "@/app/dashboard/actions";
import type {
  DocumentSummary,
  EmbedResult,
  ProcessResult,
} from "@/lib/types";

const INITIAL: ProcessResult = { kind: "idle" };
const INITIAL_EMBED: EmbedResult = { kind: "idle" };

// Shared styling for the temporary dev-only controls, so they stay visually
// distinct from real product UI.
const DEV_BUTTON_CLASS =
  "shrink-0 rounded-full border border-dashed border-amber-600/50 px-3 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 disabled:opacity-40 dark:text-amber-400";

const STATUS_STYLES: Record<string, string> = {
  ready: "bg-green-600/10 text-green-700 dark:text-green-400",
  processing: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  const style =
    STATUS_STYLES[status] ?? "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {status}
    </span>
  );
}

function DocumentRow({ doc }: { doc: DocumentSummary }) {
  const [state, formAction, pending] = useActionState(
    processDocumentAction,
    INITIAL,
  );
  // Separate hook per action so each button has its own pending flag and its
  // own inline result.
  const [embedState, embedFormAction, embedPending] = useActionState(
    embedDocumentAction,
    INITIAL_EMBED,
  );

  return (
    <li className="border-b border-black/[.06] py-3 last:border-b-0 dark:border-white/[.1]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm" title={doc.filename}>
          {doc.filename}
        </span>

        <StatusBadge status={doc.status} />

        <span className="text-xs text-zinc-500 tabular-nums">
          {doc.page_count === null ? "— pages" : `${doc.page_count} pages`}
        </span>

        <form action={formAction}>
          <input type="hidden" name="documentId" value={doc.id} />
          <button
            type="submit"
            disabled={pending}
            title="Dev-only: runs extraction + chunking on the backend"
            className={DEV_BUTTON_CLASS}
          >
            {pending ? "Processing…" : "Process (dev)"}
          </button>
        </form>

        <form action={embedFormAction}>
          <input type="hidden" name="documentId" value={doc.id} />
          <button
            type="submit"
            disabled={embedPending}
            title="Dev-only: embeds this document's chunks and upserts them into Qdrant"
            className={DEV_BUTTON_CLASS}
          >
            {embedPending ? "Embedding…" : "Embed (dev)"}
          </button>
        </form>
      </div>

      <div aria-live="polite" className="mt-2 text-xs">
        {state.kind === "success" && (
          <p className="rounded border border-green-600/25 bg-green-600/5 px-3 py-2 text-green-700 dark:text-green-400">
            status: <strong>{state.status}</strong> · page_count:{" "}
            <strong>{state.page_count ?? "—"}</strong> · chunk_count:{" "}
            <strong>{state.chunk_count}</strong> · total_tokens:{" "}
            <strong>{state.total_tokens}</strong>
          </p>
        )}
        {state.kind === "error" && (
          <p className="rounded border border-red-500/25 bg-red-500/5 px-3 py-2 text-red-700 dark:text-red-400">
            {state.message}
          </p>
        )}

        {embedState.kind === "success" && (
          <p className="mt-1 rounded border border-green-600/25 bg-green-600/5 px-3 py-2 text-green-700 dark:text-green-400">
            embed → status: <strong>{embedState.status}</strong> · chunk_count:{" "}
            <strong>{embedState.chunk_count}</strong> · embedded_count:{" "}
            <strong>{embedState.embedded_count}</strong> ·
            points_in_collection:{" "}
            <strong>{embedState.points_in_collection}</strong>
          </p>
        )}
        {embedState.kind === "error" && (
          <p className="mt-1 rounded border border-red-500/25 bg-red-500/5 px-3 py-2 text-red-700 dark:text-red-400">
            embed → {embedState.message}
          </p>
        )}
      </div>
    </li>
  );
}

export default function DocumentList({
  documents,
}: {
  documents: DocumentSummary[];
}) {
  if (documents.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No documents yet — upload a PDF above.
      </p>
    );
  }

  return (
    <ul className="w-full">
      {documents.map((doc) => (
        <DocumentRow key={doc.id} doc={doc} />
      ))}
    </ul>
  );
}
