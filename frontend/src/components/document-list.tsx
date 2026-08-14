import type { DocumentSummary } from "@/lib/types";

// Upload runs process + embed automatically (M15), so a document moves
// processing -> embedding -> ready on its own. Each state gets its own badge so
// the row says where it actually is.
const STATUS_STYLES: Record<string, string> = {
  ready: "bg-green-600/10 text-green-700 dark:text-green-400",
  processing: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  embedding: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const STATUS_HINTS: Record<string, string> = {
  processing: "Extracting text",
  embedding: "Building the search index",
  ready: "Ready to use",
  failed: "Something went wrong with this file",
};

function StatusBadge({ status }: { status: string }) {
  const style =
    STATUS_STYLES[status] ?? "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400";
  return (
    <span
      title={STATUS_HINTS[status] ?? status}
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {status}
    </span>
  );
}

function DocumentRow({ doc }: { doc: DocumentSummary }) {
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
