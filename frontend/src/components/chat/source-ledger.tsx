import type { ChatSource } from "@/lib/types";

/**
 * Provenance for one answer.
 *
 * This is the point of the product: a rep may repeat an answer to a clinician,
 * so every claim has to be traceable back to the document it came from. The
 * numbering is not decoration — [1], [2] are the same labels the model cites
 * inline, so the reader can match a sentence to its passage.
 *
 * Relevance is shown as a meter as well as a figure: a bare 0.6416 means little
 * on its own, but a filled bar next to a 0.7336 makes the ranking legible.
 */
export default function SourceLedger({ sources }: { sources: ChatSource[] }) {
  if (sources.length === 0) return null;

  return (
    <section className="rp-rise mt-4 border-t border-line pt-3">
      <h3 className="mb-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
        Sources · {sources.length} passage{sources.length === 1 ? "" : "s"}
      </h3>

      <ol className="flex flex-col gap-2">
        {sources.map((source, index) => (
          <li
            key={`${source.document}-${source.chunk_index}-${index}`}
            className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 sm:grid-cols-[auto_1fr_auto] sm:items-center"
          >
            <span
              aria-hidden
              className="mt-0.5 shrink-0 self-start rounded-[3px] bg-raised px-1.5 py-0.5 font-mono text-[11px] leading-4 text-accent sm:mt-0 sm:self-center"
            >
              {index + 1}
            </span>

            <span className="min-w-0">
              <span className="block truncate text-[13px] text-ink" title={source.document}>
                {source.document}
              </span>
              <span className="font-mono text-[11px] text-muted">
                chunk {source.chunk_index}
              </span>
            </span>

            <span className="col-start-2 flex items-center gap-2 sm:col-start-3">
              <span
                className="h-1 w-16 overflow-hidden rounded-full bg-line sm:w-20"
                role="img"
                aria-label={`Relevance ${source.score.toFixed(2)} of 1`}
              >
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{
                    width: `${Math.max(2, Math.min(100, source.score * 100))}%`,
                  }}
                />
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted">
                {source.score.toFixed(4)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
