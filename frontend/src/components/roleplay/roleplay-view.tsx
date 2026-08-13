"use client";

import { useActionState, useState, useTransition } from "react";

import { previewPersonaAction, startSessionAction } from "@/app/roleplay/actions";
import Conversation from "@/components/roleplay/conversation";
import type {
  PersonaCatalogue,
  PersonaPreview,
  StartSessionResult,
} from "@/lib/types";

const INITIAL: StartSessionResult = { kind: "idle" };

/** Radio card. The whole card is the target, not just the dot. */
function OptionCard({
  name,
  option,
  checked,
  onSelect,
  disabled,
}: {
  name: string;
  option: { key: string; label: string; summary: string };
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-3.5 py-3 transition-colors ${
        checked
          ? "border-accent/60 bg-raised"
          : "border-line bg-surface hover:border-accent/30"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          value={option.key}
          checked={checked}
          onChange={onSelect}
          disabled={disabled}
          className="sr-only"
        />
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${
            checked ? "bg-accent" : "bg-line"
          }`}
        />
        <span className="text-[14px] font-medium text-ink">{option.label}</span>
      </span>
      <span className="pl-4 text-[12.5px] leading-snug text-muted">
        {option.summary}
      </span>
    </label>
  );
}

export default function RoleplayView({
  catalogue,
}: {
  catalogue: PersonaCatalogue | null;
}) {
  const [state, formAction, pending] = useActionState(startSessionAction, INITIAL);
  const [specialty, setSpecialty] = useState("");
  const [personality, setPersonality] = useState("");
  const [product, setProduct] = useState("");

  const [preview, setPreview] = useState<PersonaPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewPending, startPreview] = useTransition();

  // Which session the rep has stepped away from, so leaving a conversation
  // returns to setup without losing the action result. Derived, not synced —
  // a new session has a new id and takes over the page again.
  const [leftSession, setLeftSession] = useState<string | null>(null);
  const activeSession =
    state.kind === "success" && state.session.id !== leftSession
      ? state.session
      : null;

  const ready = Boolean(specialty && personality && product.trim());

  if (activeSession) {
    return (
      <Conversation
        session={activeSession}
        catalogue={catalogue}
        onRestart={() => setLeftSession(activeSession.id)}
      />
    );
  }

  function showPrompt() {
    if (!specialty || !personality) {
      setPreviewError("Choose a specialty and a personality first.");
      return;
    }
    setPreviewError("");
    startPreview(async () => {
      const result = await previewPersonaAction(specialty, personality, product);
      if (result.ok) {
        setPreview(result.preview);
      } else {
        setPreview(null);
        setPreviewError(result.message);
      }
    });
  }

  return (
    <div className="rp-surface flex min-h-dvh flex-col">
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
              RepPilot
            </span>
            <h1 className="truncate text-sm text-muted">Practice</h1>
          </div>
          <nav className="flex shrink-0 items-center gap-1">
            <a
              href="/chat"
              className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              Assistant
            </a>
            <a
              href="/prep"
              className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              Meeting prep
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
            Practise a detailing conversation
          </h2>
          <p className="mt-2.5 text-[14px] leading-relaxed text-muted">
            Choose the physician you want to practise against. They haven&rsquo;t
            seen your product materials — you&rsquo;ll have to explain and defend
            the product yourself, which is the point.
          </p>
        </div>

        {catalogue === null ? (
          <p className="rounded-xl border border-critical/35 bg-critical-bg px-5 py-4 text-[14px] text-ink">
            Couldn&rsquo;t load the personas — check the backend is running, then
            reload.
          </p>
        ) : (
          <form action={formAction} className="flex flex-col gap-7">
            <fieldset className="flex flex-col gap-3" disabled={pending}>
              <legend className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                Specialty
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {catalogue.specialties.map((option) => (
                  <OptionCard
                    key={option.key}
                    name="persona_specialty"
                    option={option}
                    checked={specialty === option.key}
                    onSelect={() => setSpecialty(option.key)}
                    disabled={pending}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3" disabled={pending}>
              <legend className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                Personality
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {catalogue.personalities.map((option) => (
                  <OptionCard
                    key={option.key}
                    name="persona_personality"
                    option={option}
                    checked={personality === option.key}
                    onSelect={() => setPersonality(option.key)}
                    disabled={pending}
                  />
                ))}
              </div>
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="product"
                className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted"
              >
                Product
              </label>
              <input
                id="product"
                name="product"
                type="text"
                required
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                disabled={pending}
                placeholder="Cardovex"
                className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-accent/50 disabled:opacity-60"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={pending || !ready}
                className="h-[42px] shrink-0 rounded-lg bg-accent px-4 text-[13.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {pending ? "Starting…" : "Start session"}
              </button>
              <button
                type="button"
                onClick={showPrompt}
                disabled={previewPending}
                className="h-[42px] shrink-0 rounded-lg border border-dashed border-line px-4 text-[13px] text-muted transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-40"
              >
                {previewPending ? "Loading…" : "View persona prompt"}
              </button>
            </div>
          </form>
        )}

        <div aria-live="polite" className="mt-8 flex flex-col gap-5">
          {state.kind === "error" && (
            <div className="rp-rise rounded-xl border border-critical/35 bg-critical-bg px-5 py-4">
              <h3 className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-critical">
                Couldn&rsquo;t start the session
              </h3>
              <p className="text-[14px] leading-relaxed text-ink">{state.message}</p>
            </div>
          )}

          {previewError && (
            <p className="rounded-lg border border-caution/35 bg-caution-bg px-4 py-3 text-[13px] text-ink">
              {previewError}
            </p>
          )}

          {preview && (
            <section className="rp-rise rounded-xl border border-line bg-surface">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
                <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                  Persona prompt · {preview.description}
                </h3>
                <span className="font-mono text-[11px] text-muted">
                  {preview.system_prompt.length} chars
                </span>
              </div>
              <pre className="max-h-[26rem] overflow-auto px-5 py-4 font-mono text-[11.5px] leading-[1.6] text-ink">
                {preview.system_prompt}
              </pre>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
