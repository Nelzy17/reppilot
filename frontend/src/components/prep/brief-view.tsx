import SourceLedger from "@/components/chat/source-ledger";
import type { MeetingPrepRecord } from "@/lib/types";

/** Section shell. The eyebrow carries a count so the brief's shape is scannable
 *  before it is read — a rep skims this in a car park, not at a desk. */
function Section({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-5">
      <h3 className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
        {label}
        {typeof count === "number" && (
          <span className="ml-1.5 tabular-nums text-muted/70">{count}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

/** An empty section is left visible and labelled rather than hidden: the rep
 *  needs to know the documents had nothing here, not wonder if it was skipped. */
function Empty({ what }: { what: string }) {
  return (
    <p className="text-[13.5px] italic leading-relaxed text-muted">
      Your documents didn&rsquo;t support any {what}.
    </p>
  );
}

export default function BriefView({ prep }: { prep: MeetingPrepRecord }) {
  const { brief } = prep;

  return (
    <article className="rounded-xl border border-line bg-surface">
      {/* meeting header */}
      <header className="border-b border-line px-5 py-4 sm:px-6">
        <h2 className="text-[19px] font-semibold leading-snug tracking-[-0.01em] text-ink">
          {prep.product}
        </h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
          {prep.objective}
        </p>
        {(prep.physician_name || prep.specialty) && (
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
            {[prep.physician_name, prep.specialty].filter(Boolean).join(" · ")}
          </p>
        )}
      </header>

      <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">
        <Section label="Talking points" count={brief.talking_points.length}>
          {brief.talking_points.length === 0 ? (
            <Empty what="talking points" />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {brief.talking_points.map((point, i) => (
                <li key={i} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent"
                  />
                  <span className="text-[14.5px] leading-[1.6] text-ink">
                    {point}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section label="Product highlights" count={brief.product_highlights.length}>
          {brief.product_highlights.length === 0 ? (
            <Empty what="product highlights" />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {brief.product_highlights.map((point, i) => (
                <li key={i} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent"
                  />
                  <span className="text-[14.5px] leading-[1.6] text-ink">
                    {point}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* The objection pairs are the part a rep rehearses, so they get a
            two-part treatment rather than another bullet list. */}
        <Section label="Likely objections" count={brief.likely_objections.length}>
          {brief.likely_objections.length === 0 ? (
            <Empty what="objections" />
          ) : (
            <ul className="flex flex-col gap-3">
              {brief.likely_objections.map((item, i) => (
                <li
                  key={i}
                  className="overflow-hidden rounded-lg border border-line"
                >
                  <p className="bg-raised px-3.5 py-2.5 text-[14px] font-medium leading-snug text-ink">
                    {item.objection}
                  </p>
                  <p className="px-3.5 py-2.5 text-[14px] leading-[1.6] text-ink">
                    {item.suggested_response}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section label="Follow-ups" count={brief.follow_up_recommendations.length}>
          {brief.follow_up_recommendations.length === 0 ? (
            <Empty what="follow-ups" />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {brief.follow_up_recommendations.map((point, i) => (
                <li key={i} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent"
                  />
                  <span className="text-[14.5px] leading-[1.6] text-ink">
                    {point}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Coverage gaps are given the same weight as the content itself —
            knowing what you cannot claim matters as much as what you can. */}
        <section className="rounded-lg border border-caution/35 bg-caution-bg px-4 py-3.5">
          <h3 className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-caution">
            What your documents don&rsquo;t cover
          </h3>
          <p className="text-[13.5px] leading-[1.6] text-ink">
            {brief.grounding_note?.trim() ||
              "The model did not report any coverage gaps."}
          </p>
        </section>

        <div className="border-t border-line pt-1">
          <SourceLedger sources={prep.sources} />
        </div>
      </div>
    </article>
  );
}
