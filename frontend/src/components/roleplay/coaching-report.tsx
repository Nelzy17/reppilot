import SourceLedger from "@/components/chat/source-ledger";
import type { CoachingReport } from "@/lib/types";

const DIMENSIONS: { key: keyof CoachingReport["scores"]; label: string }[] = [
  { key: "product_knowledge", label: "Product knowledge" },
  { key: "communication", label: "Communication" },
  { key: "objection_handling", label: "Objection handling" },
  { key: "clinical_accuracy", label: "Clinical accuracy" },
];

/** Bands, not a gradient: a score is a signal, and three states read faster
 *  than a continuous hue ramp. */
function band(score: number) {
  if (score >= 75) return { text: "text-grounded", bar: "bg-grounded" };
  if (score >= 50) return { text: "text-caution", bar: "bg-caution" };
  return { text: "text-critical", bar: "bg-critical" };
}

function Meter({ label, score }: { label: string; score: number }) {
  const tone = band(score);
  return (
    <div className="flex items-center gap-3">
      <span className="w-[9.5rem] shrink-0 text-[13px] text-ink">{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
        <span
          className={`block h-full rounded-full ${tone.bar}`}
          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
        />
      </span>
      <span
        className={`w-9 shrink-0 text-right font-mono text-[13px] tabular-nums ${tone.text}`}
      >
        {score}
      </span>
    </div>
  );
}

export default function CoachingReportView({
  report,
}: {
  report: CoachingReport;
}) {
  const overall = band(report.overall_score);

  return (
    <div className="flex flex-col gap-6">
      {/* headline */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div className="min-w-0">
          <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
            Overall
          </h3>
          <p className="mt-1.5 flex items-baseline gap-2">
            <span
              className={`font-mono text-[34px] font-semibold leading-none tabular-nums ${overall.text}`}
            >
              {report.overall_score}
            </span>
            <span className="font-mono text-[13px] text-muted">/ 100</span>
          </p>
        </div>
        <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-muted sm:max-w-sm">
          {report.narratives.overall}
        </p>
      </div>

      {/* dimensions */}
      <section className="flex flex-col gap-5">
        {DIMENSIONS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-2">
            <Meter label={label} score={report.scores[key]} />
            {report.narratives[key] && (
              <p className="pl-[10.75rem] text-[13px] leading-[1.6] text-muted">
                {report.narratives[key]}
              </p>
            )}
          </div>
        ))}
      </section>

      {/* recommendations */}
      {report.recommendations.length > 0 && (
        <section className="border-t border-line pt-5">
          <h3 className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
            Try next time
            <span className="ml-1.5 tabular-nums text-muted/70">
              {report.recommendations.length}
            </span>
          </h3>
          <ul className="flex flex-col gap-2.5">
            {report.recommendations.map((item, i) => (
              <li key={i} className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent"
                />
                <span className="text-[14px] leading-[1.6] text-ink">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* what clinical accuracy was checked against */}
      {report.sources.length > 0 ? (
        <SourceLedger sources={report.sources} />
      ) : (
        <section className="border-t border-line pt-4">
          <h3 className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
            Sources
          </h3>
          <p className="text-[13px] leading-relaxed text-muted">
            No matching passages were found in your documents, so the clinical
            claims in this conversation could not be checked against a source.
            Upload the product documentation to have accuracy assessed.
          </p>
        </section>
      )}
    </div>
  );
}
