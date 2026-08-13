"use client";

import { useActionState } from "react";

import { generateBriefAction } from "@/app/prep/actions";
import BriefView from "@/components/prep/brief-view";
import type { PrepResult } from "@/lib/types";

const INITIAL: PrepResult = { kind: "idle" };

function Field({
  name,
  label,
  placeholder,
  required,
  disabled,
  textarea,
}: {
  name: string;
  label: string;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
  textarea?: boolean;
}) {
  const shared =
    "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-accent/50 disabled:opacity-60";

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={name}
        className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted"
      >
        {label}
        {!required && <span className="ml-1.5 normal-case tracking-normal">optional</span>}
      </label>
      {textarea ? (
        <textarea
          id={name}
          name={name}
          rows={3}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          className={`${shared} resize-none`}
        />
      ) : (
        <input
          id={name}
          name={name}
          type="text"
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          className={shared}
        />
      )}
    </div>
  );
}

export default function PrepView() {
  const [state, formAction, pending] = useActionState(generateBriefAction, INITIAL);

  return (
    <div className="rp-surface flex min-h-dvh flex-col">
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
              RepPilot
            </span>
            <h1 className="truncate text-sm text-muted">Meeting prep</h1>
          </div>
          <nav className="flex shrink-0 items-center gap-1">
            <a
              href="/chat"
              className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              Assistant
            </a>
            <a
              href="/roleplay"
              className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              Practice
            </a>
            <a
              href="/progress"
              className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              Progress
            </a>
            <a
              href="/dashboard"
              className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              Documents
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        <div className="mb-7 max-w-xl">
          <h2 className="text-balance text-[22px] font-semibold leading-snug tracking-[-0.01em] text-ink">
            Prepare for a call
          </h2>
          <p className="mt-2.5 text-[14px] leading-relaxed text-muted">
            RepPilot builds a brief from your uploaded documents only. Anything
            your documents don&rsquo;t cover is listed as a gap rather than filled
            in.
          </p>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="physician_name"
              label="Physician"
              placeholder="Dr Amara Osei"
              disabled={pending}
            />
            <Field
              name="specialty"
              label="Specialty"
              placeholder="Cardiology"
              disabled={pending}
            />
          </div>

          <Field
            name="product"
            label="Product"
            placeholder="Cardovex"
            required
            disabled={pending}
          />

          <Field
            name="objective"
            label="Meeting objective"
            placeholder="Introduce the revised dosing guidance and address safety questions"
            required
            disabled={pending}
            textarea
          />

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="h-[42px] shrink-0 rounded-lg bg-accent px-4 text-[13.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {pending ? "Building brief…" : "Generate brief"}
            </button>
            {pending && (
              <p className="flex items-center gap-1.5 text-[13px] text-muted">
                <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
                <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
                <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
                <span className="ml-1">Searching your documents</span>
              </p>
            )}
          </div>
        </form>

        <div aria-live="polite" className="mt-8">
          {state.kind === "no_coverage" && (
            <div className="rp-rise rounded-xl border border-caution/35 bg-caution-bg px-5 py-4">
              <h3 className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-caution">
                Not enough document coverage
              </h3>
              <p className="text-[14px] leading-relaxed text-ink">{state.message}</p>
            </div>
          )}

          {state.kind === "error" && (
            <div className="rp-rise rounded-xl border border-critical/35 bg-critical-bg px-5 py-4">
              <h3 className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-critical">
                Couldn&rsquo;t build the brief
              </h3>
              <p className="text-[14px] leading-relaxed text-ink">{state.message}</p>
            </div>
          )}

          {state.kind === "success" && (
            <div className="rp-rise">
              <BriefView prep={state.prep} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
