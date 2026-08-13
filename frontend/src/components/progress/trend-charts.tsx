"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DIMENSIONS } from "@/lib/dimensions";
import type { ProgressSession } from "@/lib/types";

type Row = {
  label: string;
  full: string;
  overall_score: number;
  product_knowledge: number;
  communication: number;
  objection_handling: number;
  clinical_accuracy: number;
};

function toRows(sessions: ProgressSession[]): Row[] {
  return sessions.map((s) => {
    const d = new Date(s.created_at);
    return {
      label: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      full: `${s.persona_description} · ${s.product}`,
      overall_score: s.overall_score,
      product_knowledge: s.product_knowledge,
      communication: s.communication,
      objection_handling: s.objection_handling,
      clinical_accuracy: s.clinical_accuracy,
    };
  });
}

type TooltipRow = { name?: string; value?: number; color?: string };

function ChartTooltip({
  active,
  payload,
  label,
  rows,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string;
  rows: Row[];
}) {
  if (!active || !payload?.length) return null;
  const context = rows.find((r) => r.label === label);

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
        {label}
      </p>
      {context && (
        <p className="mb-1.5 max-w-[15rem] truncate text-[12px] text-ink">
          {context.full}
        </p>
      )}
      <ul className="flex flex-col gap-0.5">
        {payload.map((entry, i) => (
          <li key={i} className="flex items-center gap-2 text-[12px]">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: entry.color }}
            />
            {/* Text keeps its ink token; the swatch carries identity. */}
            <span className="text-muted">{entry.name}</span>
            <span className="ml-auto font-mono tabular-nums text-ink">
              {entry.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const AXIS_TICK = { fill: "var(--rp-muted)", fontSize: 11 };

function Frame({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
        {title}
      </h3>
      {caption && <p className="mt-1 text-[12.5px] text-muted">{caption}</p>}
      <div className="mt-4 h-56 w-full">{children}</div>
    </section>
  );
}

export default function TrendCharts({
  sessions,
}: {
  sessions: ProgressSession[];
}) {
  const rows = toRows(sessions);
  // Animation off by default rather than conditionally: restraint reads as
  // credible here, and it removes any reduced-motion question.
  // The dot core takes the surface colour rather than recharts' default white,
  // so it reads as a ring against either theme and separates overlapping marks.
  const common = {
    isAnimationActive: false,
    strokeWidth: 2,
    dot: { r: 4, strokeWidth: 2, fill: "var(--rp-surface)" },
    activeDot: { r: 5, strokeWidth: 2, fill: "var(--rp-surface)" },
  } as const;

  return (
    <div className="flex flex-col gap-4">
      {/* Single series — the title names it, so no legend box. */}
      <Frame title="Overall score by session" caption="Most recent on the right.">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--rp-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--rp-axis)" }}
            />
            <YAxis
              domain={[0, 100]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: "var(--rp-axis)", strokeWidth: 1 }}
              content={<ChartTooltip rows={rows} />}
            />
            <Line
              {...common}
              type="monotone"
              dataKey="overall_score"
              name="Overall"
              stroke="var(--rp-accent)"
            />
          </LineChart>
        </ResponsiveContainer>
      </Frame>

      {/* Four series — legend always present, so identity is never colour alone. */}
      <Frame title="By dimension">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--rp-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--rp-axis)" }}
            />
            <YAxis
              domain={[0, 100]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: "var(--rp-axis)", strokeWidth: 1 }}
              content={<ChartTooltip rows={rows} />}
            />
            {DIMENSIONS.map((d) => (
              <Line
                key={d.key}
                {...common}
                type="monotone"
                dataKey={d.key}
                name={d.label}
                stroke={d.color}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Frame>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 px-1">
        {DIMENSIONS.map((d) => (
          <li key={d.key} className="flex items-center gap-1.5 text-[12px] text-muted">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ background: d.color }}
            />
            {d.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
