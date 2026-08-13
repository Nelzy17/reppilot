"use client";

import { useEffect, useRef, useState } from "react";

import SourceLedger from "@/components/chat/source-ledger";
import type { ChatSource } from "@/lib/types";

type AnswerState = "thinking" | "streaming" | "grounded" | "refused" | "error";

type Turn =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      state: AnswerState;
      sources: ChatSource[];
      error: string;
    };

const EXAMPLES = [
  "What are the contraindications?",
  "What is the recommended starting dose?",
  "How should this be stored?",
];

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

/** Small status chip. State is carried by shape and word, not colour alone. */
function StateChip({ state }: { state: AnswerState }) {
  const map: Record<AnswerState, { label: string; className: string }> = {
    thinking: {
      label: "Searching your documents",
      className: "bg-raised text-muted",
    },
    streaming: { label: "Answering", className: "bg-raised text-muted" },
    grounded: {
      label: "Grounded in your documents",
      className: "bg-grounded-bg text-grounded",
    },
    refused: {
      label: "No supporting passage found",
      className: "bg-caution-bg text-caution",
    },
    error: { label: "Could not complete", className: "bg-critical-bg text-critical" },
  };
  const { label, className } = map[state];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em] ${className}`}
    >
      {label}
    </span>
  );
}

export default function ChatView() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState("");

  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Keep the newest turn in view while tokens arrive.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function patchAssistant(id: string, patch: Partial<Extract<Turn, { role: "assistant" }>>) {
    setTurns((prev) =>
      prev.map((t) => (t.id === id && t.role === "assistant" ? { ...t, ...patch } : t)),
    );
  }

  async function send(question: string) {
    const query = question.trim();
    if (!query || busy) return;

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const answerId = `a-${stamp}`;

    setTurns((prev) => [
      ...prev,
      { id: `u-${stamp}`, role: "user", content: query },
      {
        id: answerId,
        role: "assistant",
        content: "",
        state: "thinking",
        sources: [],
        error: "",
      },
    ]);
    setDraft("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionId ? { query, session_id: sessionId } : { query }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let detail = "";
        try {
          const body = await res.json();
          if (typeof body?.detail === "string") detail = body.detail;
        } catch {
          /* non-JSON */
        }
        patchAssistant(answerId, {
          state: "error",
          error:
            detail ||
            "Something went wrong generating the answer — try asking again.",
        });
        return;
      }

      // EventSource only does GET, so read the POST response body directly.
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
            patchAssistant(answerId, { content: text, state: "streaming" });
          } else if (event === "sources") {
            const id = String(data.session_id ?? "");
            if (id) setSessionId(id);
            patchAssistant(answerId, {
              state: "grounded",
              sources: (data.sources as ChatSource[]) ?? [],
            });
          } else if (event === "refusal") {
            const id = String(data.session_id ?? "");
            if (id) setSessionId(id);
            patchAssistant(answerId, {
              state: "refused",
              content: String(data.answer ?? ""),
              sources: [],
            });
          } else if (event === "error") {
            patchAssistant(answerId, {
              state: "error",
              error:
                String(data.message ?? "") ||
                "Something went wrong generating the answer — try asking again.",
            });
          }
        }
      }

      // Stream closed without a terminal event.
      setTurns((prev) =>
        prev.map((t) =>
          t.id === answerId && t.role === "assistant" && t.state === "streaming"
            ? {
                ...t,
                state: t.content ? "grounded" : "error",
                error: t.content ? "" : "The answer ended before it started.",
              }
            : t,
        ),
      );
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        patchAssistant(answerId, {
          state: "error",
          error: "Couldn't reach the assistant — check the backend is running.",
        });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      textareaRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  return (
    // Fixed height so the transcript is the only thing that scrolls; the
    // header and composer stay put without needing sticky positioning.
    <div className="rp-surface flex h-dvh flex-col overflow-hidden">
      {/* ---- header ---- */}
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
              RepPilot
            </span>
            <h1 className="truncate text-sm text-muted">Document assistant</h1>
          </div>
          <nav className="flex shrink-0 items-center gap-1">
            <a
              href="/prep"
              className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              Meeting prep
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

      {/* ---- transcript ---- */}
      <div ref={transcriptRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 py-8">
          {turns.length === 0 ? (
            <div className="mx-auto max-w-xl py-10">
              <h2 className="text-balance text-[22px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                Ask a question about your documents
              </h2>
              <p className="mt-2.5 text-[14px] leading-relaxed text-muted">
                Answers are drawn only from the files you have uploaded, and every
                answer shows the passages it came from. If your documents don&rsquo;t
                cover something, RepPilot will say so rather than guess.
              </p>

              <ul className="mt-6 flex flex-col gap-2">
                {EXAMPLES.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      onClick={() => void send(example)}
                      className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-left text-[13.5px] text-ink transition-colors hover:border-accent/40 hover:bg-raised"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ol className="flex flex-col gap-7">
              {turns.map((turn) =>
                turn.role === "user" ? (
                  <li key={turn.id} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[14.5px] leading-relaxed text-accent-ink">
                      {turn.content}
                    </p>
                  </li>
                ) : (
                  <li key={turn.id}>
                    <article
                      className={`rounded-xl border bg-surface px-4 py-3.5 sm:px-5 sm:py-4 ${
                        turn.state === "refused"
                          ? "border-caution/35"
                          : turn.state === "error"
                            ? "border-critical/35"
                            : "border-line"
                      }`}
                    >
                      <div className="mb-2.5">
                        <StateChip state={turn.state} />
                      </div>

                      {turn.state === "thinking" ? (
                        <p className="flex items-center gap-1.5 py-1 text-muted">
                          <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
                          <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
                          <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
                          <span className="sr-only">Searching your documents</span>
                        </p>
                      ) : turn.state === "error" ? (
                        <p className="text-[14.5px] leading-relaxed text-critical">
                          {turn.error}
                        </p>
                      ) : (
                        <div
                          aria-live={turn.state === "streaming" ? "polite" : "off"}
                          className="text-[14.5px] leading-[1.65] text-ink"
                        >
                          <p className="whitespace-pre-wrap break-words">
                            {turn.content}
                            {turn.state === "streaming" && (
                              <span className="rp-caret" aria-hidden />
                            )}
                          </p>

                          {turn.state === "refused" && (
                            <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-muted">
                              Nothing in your uploaded documents was close enough to
                              this question, so no answer was generated. Try
                              rephrasing, or upload a document that covers it.
                            </p>
                          )}
                        </div>
                      )}

                      {turn.state === "grounded" && (
                        <SourceLedger sources={turn.sources} />
                      )}
                    </article>
                  </li>
                ),
              )}
            </ol>
          )}
        </div>
      </div>

      {/* ---- composer ---- */}
      <div className="shrink-0 border-t border-line bg-ground">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="mx-auto flex w-full max-w-3xl items-end gap-2.5 px-5 py-3.5"
        >
          <label htmlFor="chat-input" className="sr-only">
            Ask a question about your documents
          </label>
          <textarea
            id="chat-input"
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            placeholder="Ask a question…"
            className="max-h-40 min-h-[42px] flex-1 resize-none rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-accent/50 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="h-[42px] shrink-0 rounded-lg bg-accent px-4 text-[13.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Sending" : "Send"}
          </button>
        </form>
        <p className="mx-auto w-full max-w-3xl px-5 pb-3 text-[11.5px] text-muted">
          Enter to send · Shift + Enter for a new line. Answers come only from your
          uploaded documents.
        </p>
      </div>
    </div>
  );
}
