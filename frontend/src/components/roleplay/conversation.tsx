"use client";

import { useEffect, useRef, useState } from "react";

import {
  endConversationAction,
  openConversationAction,
} from "@/app/roleplay/actions";
import type {
  PersonaCatalogue,
  RoleplaySession,
  RoleplayTurn,
} from "@/lib/types";

type Phase = "opening" | "ready" | "waiting" | "streaming" | "complete";

function parseFrame(frame: string): { event: string; data: Record<string, unknown> } {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  let data: Record<string, unknown> = {};
  try {
    data = dataLines.length ? JSON.parse(dataLines.join("\n")) : {};
  } catch {
    /* keep {} */
  }
  return { event, data };
}

export default function Conversation({
  session,
  catalogue,
  onRestart,
}: {
  session: RoleplaySession;
  catalogue: PersonaCatalogue | null;
  onRestart: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("opening");
  const [turns, setTurns] = useState<RoleplayTurn[]>([]);
  const [streaming, setStreaming] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);

  // Temperament reminder, so the rep can see what they're up against without
  // going back to the setup screen.
  const temperament = catalogue?.personalities.find(
    (p) => p.key === session.persona_personality,
  )?.summary;

  // The physician speaks first — fetch the opening as soon as the room opens.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const result = await openConversationAction(session.id);
      if (result.ok) {
        setTurns([result.turn]);
        setPhase("ready");
      } else {
        setError(result.message);
        setPhase("ready");
      }
    })();
  }, [session.id]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [turns, streaming, phase]);

  const busy = phase === "opening" || phase === "waiting" || phase === "streaming";

  async function send() {
    const message = draft.trim();
    if (!message || busy || phase === "complete") return;

    setError("");
    setDraft("");
    setTurns((prev) => [
      ...prev,
      { role: "rep", content: message, ts: new Date().toISOString() },
    ]);
    setStreaming("");
    setPhase("waiting");

    try {
      const res = await fetch("/api/roleplay/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: session.id, message }),
      });

      if (!res.ok || !res.body) {
        let detail = "";
        try {
          const body = await res.json();
          if (typeof body?.detail === "string") detail = body.detail;
        } catch {
          /* non-JSON */
        }
        setError(detail || "The physician didn't respond — try sending that again.");
        setPhase("ready");
        return;
      }

      // EventSource is GET-only, so read the POST body directly.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let split: number;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (!frame.trim()) continue;

          const { event, data } = parseFrame(frame);
          if (event === "token") {
            text += String(data.text ?? "");
            setStreaming(text);
            setPhase("streaming");
          } else if (event === "turn") {
            // Backend has persisted it — promote to a real transcript entry.
            setTurns((prev) => [...prev, data as unknown as RoleplayTurn]);
            setStreaming("");
          } else if (event === "error") {
            setError(
              String(data.message ?? "") ||
                "Something went wrong mid-reply — try sending that again.",
            );
            setStreaming("");
          }
        }
      }
    } catch {
      setError("Lost connection to RepPilot — check the backend is running.");
    } finally {
      setStreaming("");
      setPhase((p) => (p === "complete" ? p : "ready"));
      inputRef.current?.focus();
    }
  }

  async function end() {
    setError("");
    const result = await endConversationAction(session.id);
    if (result.ok) {
      setPhase("complete");
    } else {
      setError(result.message);
    }
  }

  const complete = phase === "complete";

  return (
    <div className="rp-surface flex h-dvh flex-col overflow-hidden">
      {/* ---- who you are facing: always visible ---- */}
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {session.persona_description}
              </h1>
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] ${
                  complete
                    ? "bg-grounded-bg text-grounded"
                    : "bg-raised text-muted"
                }`}
              >
                {complete ? "Session complete" : "In session"}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[12.5px] text-muted">
              Practising {session.product}
              {temperament && ` · ${temperament}`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {!complete && (
              <button
                type="button"
                onClick={() => void end()}
                className="rounded-md border border-line px-2.5 py-1 text-[12.5px] text-muted transition-colors hover:border-caution/50 hover:text-ink"
              >
                End session
              </button>
            )}
            <button
              type="button"
              onClick={onRestart}
              className="rounded-md px-2 py-1 text-[12.5px] text-muted transition-colors hover:text-ink"
            >
              {complete ? "New session" : "Leave"}
            </button>
          </div>
        </div>
      </header>

      {/* ---- transcript ---- */}
      <div ref={transcriptRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 py-7">
          <ol className="flex flex-col gap-5">
            {turns.map((turn, i) => (
              <li
                key={`${turn.ts}-${i}`}
                className={turn.role === "rep" ? "flex justify-end" : ""}
              >
                <div className={turn.role === "rep" ? "max-w-[85%]" : "max-w-[92%]"}>
                  <span className="mb-1 block px-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">
                    {turn.role === "rep" ? "You" : session.persona_description}
                  </span>
                  <p
                    className={`whitespace-pre-wrap break-words text-[14.5px] leading-[1.65] ${
                      turn.role === "rep"
                        ? "rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-accent-ink"
                        : "rounded-xl border border-line bg-surface px-4 py-3 text-ink"
                    }`}
                  >
                    {turn.content}
                  </p>
                </div>
              </li>
            ))}

            {/* physician mid-reply */}
            {streaming && (
              <li>
                <div className="max-w-[92%]">
                  <span className="mb-1 block px-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">
                    {session.persona_description}
                  </span>
                  <p className="whitespace-pre-wrap break-words rounded-xl border border-line bg-surface px-4 py-3 text-[14.5px] leading-[1.65] text-ink">
                    {streaming}
                    <span className="rp-caret" aria-hidden />
                  </p>
                </div>
              </li>
            )}

            {/* before the first token arrives */}
            {(phase === "opening" || phase === "waiting") && (
              <li aria-live="polite">
                <div className="max-w-[92%]">
                  <span className="mb-1 block px-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">
                    {session.persona_description}
                  </span>
                  <p className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-[13.5px] text-muted">
                    <span className="flex items-center gap-1">
                      <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
                      <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
                      <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
                    </span>
                    {phase === "opening"
                      ? "Showing you in…"
                      : "The physician is responding…"}
                  </p>
                </div>
              </li>
            )}
          </ol>

          {error && (
            <p className="mt-5 rounded-lg border border-critical/30 bg-critical-bg px-4 py-3 text-[13px] leading-relaxed text-ink">
              {error}
            </p>
          )}

          {/* ---- session complete: reserved slot for M13 coaching ---- */}
          {complete && (
            <section className="rp-rise mt-7 rounded-xl border border-line bg-surface">
              <div className="border-b border-line px-5 py-4">
                <h2 className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                  Session complete
                </h2>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
                  {turns.filter((t) => t.role === "rep").length} of your turns,{" "}
                  {turns.filter((t) => t.role === "physician").length} from the
                  physician. The full conversation stays above — scroll back over
                  what you said.
                </p>
              </div>

              <div className="px-5 py-5">
                <h3 className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                  Coaching feedback
                </h3>
                <p className="text-[13.5px] leading-relaxed text-muted">
                  Your coaching feedback will appear here — how you handled the
                  objections, where the conversation turned, and what to try
                  differently next time.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled
                    aria-describedby="coaching-note"
                    className="cursor-not-allowed rounded-lg border border-line px-4 py-2 text-[13.5px] font-medium text-muted opacity-60"
                  >
                    Get coaching
                  </button>
                  <span id="coaching-note" className="text-[12.5px] text-muted">
                    Arriving in the next milestone.
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* ---- composer ---- */}
      {!complete && (
        <div className="shrink-0 border-t border-line bg-ground">
          <div className="mx-auto flex w-full max-w-3xl items-end gap-2.5 px-5 py-3.5">
            <label htmlFor="rep-turn" className="sr-only">
              What you say to the physician
            </label>
            <textarea
              id="rep-turn"
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={busy}
              placeholder="What do you say?"
              className="max-h-40 min-h-[42px] flex-1 resize-none rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-accent/50 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !draft.trim()}
              className="h-[42px] shrink-0 rounded-lg bg-accent px-4 text-[13.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </div>
          <p className="mx-auto w-full max-w-3xl px-5 pb-3 text-[11.5px] text-muted">
            Enter to send · Shift + Enter for a new line. The physician
            hasn&rsquo;t seen your product materials — explain it as you would in
            the room.
          </p>
        </div>
      )}
    </div>
  );
}
