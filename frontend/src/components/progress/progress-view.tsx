import Link from "next/link";

import TrendCharts from "@/components/progress/trend-charts";
import { DIMENSIONS } from "@/lib/dimensions";
import type { Progress } from "@/lib/types";

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3.5 py-3">
      {/* Two lines are reserved whether the label needs them or not, so every
          number in the row sits on the same baseline. */}
      <p className="min-h-[2.4em] font-mono text-[9.5px] uppercase leading-tight tracking-[0.12em] text-muted">
        {label}
      </p>
      <p className="font-mono text-[22px] font-semibold leading-none text-ink">
        {value ?? "—"}
      </p>
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Compact form for the table, where seven columns compete for the width. */
function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export default function ProgressView({ progress }: { progress: Progress }) {
  const { summary, sessions } = progress;

  // Nothing to plot yet — an honest prompt beats an empty chart frame.
  if (sessions.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-12">
        <h2 className="text-balance text-[22px] font-semibold leading-snug tracking-[-0.01em] text-ink">
          No coached sessions yet
        </h2>
        <p className="mt-2.5 text-[14px] leading-relaxed text-muted">
          Your scores appear here once you&rsquo;ve practised a conversation and
          asked for coaching. Run a roleplay, end the session, then choose
          &ldquo;Get coaching&rdquo; — the report from that session becomes the
          first point on your trend.
        </p>
        <Link
          href="/roleplay"
          className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-[13.5px] font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Practise a conversation
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* summary */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">
            {summary.sessions_coached} coached session
            {summary.sessions_coached === 1 ? "" : "s"}
          </h2>
          {summary.first_session_at && summary.latest_session_at && (
            <p className="font-mono text-[11px] text-muted">
              {fmt(summary.first_session_at)} – {fmt(summary.latest_session_at)}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          <Stat label="Overall avg" value={summary.average_overall} />
          {DIMENSIONS.map((d) => (
            <Stat
              key={d.key}
              label={d.label}
              value={summary.averages[d.key]}
            />
          ))}
        </div>
      </section>

      {/* trend — a line needs at least two points to mean anything */}
      {sessions.length >= 2 ? (
        <TrendCharts sessions={sessions} />
      ) : (
        <p className="rounded-xl border border-line bg-surface px-5 py-4 text-[13.5px] leading-relaxed text-muted">
          One session so far — coach a second to start seeing a trend.
        </p>
      )}

      {/* the table view: relief for the two light-mode series that sit under
          3:1, and the accessible read of the same data */}
      <details className="rounded-xl border border-line bg-surface">
        <summary className="cursor-pointer px-5 py-3.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
          View as table
        </summary>
        {/* Scrolls rather than clips if the viewport is too narrow for seven
            columns; at the page's own width it fits without scrolling. */}
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[35rem] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line align-bottom text-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">Session</th>
                <th scope="col" className="px-2 py-2.5 font-medium">Date</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">Overall</th>
                {DIMENSIONS.map((d) => (
                  <th
                    key={d.key}
                    scope="col"
                    className="w-[4.6rem] px-2 py-2.5 text-right font-medium"
                  >
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.session_id} className="border-b border-line last:border-b-0">
                  <th scope="row" className="max-w-[13rem] truncate px-4 py-2.5 font-normal text-ink">
                    {s.persona_description} · {s.product}
                  </th>
                  <td className="whitespace-nowrap px-2 py-2.5 text-muted">
                    {fmtShort(s.created_at)}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-ink">
                    {s.overall_score}
                  </td>
                  {DIMENSIONS.map((d) => (
                    <td
                      key={d.key}
                      className="px-2 py-2.5 text-right font-mono tabular-nums text-muted"
                    >
                      {s[d.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* history */}
      <section>
        <h3 className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
          Session history
          <span className="ml-1.5 tabular-nums text-muted/70">
            {sessions.length}
          </span>
        </h3>
        <ul className="flex flex-col gap-2">
          {[...sessions].reverse().map((s) => (
            <li
              key={s.session_id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-4 py-3"
            >
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                {s.persona_description}
              </span>
              <span className="truncate text-[12.5px] text-muted">
                {s.product}
              </span>
              <span className="font-mono text-[11.5px] text-muted">
                {fmt(s.created_at)}
              </span>
              <span className="w-9 text-right font-mono text-[15px] font-semibold tabular-nums text-ink">
                {s.overall_score}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
