"use client";

import { useActionState, useRef, useState } from "react";

import { chatAction } from "@/app/dashboard/actions";
import type { ChatResult, ChatSource } from "@/lib/types";

const INITIAL: ChatResult = { kind: "idle" };

type StreamState = {
  phase: "idle" | "streaming" | "done" | "refused" | "error";
  question: string;
  text: string;
  sources: ChatSource[];
  sessionId: string;
  error: string;
};

const EMPTY_STREAM: StreamState = {
  phase: "idle",
  question: "",
  text: "",
  sources: [],
  sessionId: "",
  error: "",
};

/** Parse one SSE frame into its event name and JSON payload. */
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

export default function DevChat() {
  const [state, formAction, pending] = useActionState(chatAction, INITIAL);
  const [question, setQuestion] = useState("");
  const [stream, setStream] = useState<StreamState>(EMPTY_STREAM);
  const abortRef = useRef<AbortController | null>(null);

  // Whichever path ran last owns the session, so follow-ups continue it.
  const sessionId =
    stream.sessionId || (state.kind === "success" ? state.session_id : "");

  const busy = pending || stream.phase === "streaming";

  async function runStream() {
    const q = question.trim();
    if (!q) {
      setStream({ ...EMPTY_STREAM, phase: "error", error: "Ask a question first" });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStream({ ...EMPTY_STREAM, phase: "streaming", question: q });

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionId ? { query: q, session_id: sessionId } : { query: q }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let detail = res.statusText;
        try {
          const body = await res.json();
          if (typeof body?.detail === "string") detail = body.detail;
        } catch {
          /* non-JSON */
        }
        setStream((s) => ({ ...s, phase: "error", error: `${res.status} — ${detail}` }));
        return;
      }

      // EventSource is GET-only, so read the body directly and frame it here.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
            const text = String(data.text ?? "");
            setStream((s) => ({ ...s, text: s.text + text }));
          } else if (event === "sources") {
            setStream((s) => ({
              ...s,
              sources: (data.sources as ChatSource[]) ?? [],
              sessionId: String(data.session_id ?? s.sessionId),
            }));
          } else if (event === "refusal") {
            setStream((s) => ({
              ...s,
              phase: "refused",
              text: String(data.answer ?? ""),
              sessionId: String(data.session_id ?? s.sessionId),
            }));
          } else if (event === "error") {
            setStream((s) => ({
              ...s,
              phase: "error",
              error: String(data.message ?? "Stream failed"),
            }));
          } else if (event === "done") {
            setStream((s) =>
              s.phase === "streaming" ? { ...s, phase: "done" } : s,
            );
          }
        }
      }
      setStream((s) => (s.phase === "streaming" ? { ...s, phase: "done" } : s));
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setStream((s) => ({ ...s, phase: "error", error: "Could not reach the backend" }));
    }
  }

  return (
    <section className="w-full max-w-xl">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Ask your documents
        </h2>
        <span className="text-xs text-amber-700 dark:text-amber-400">
          temporary M9b testing control
        </span>
      </div>

      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input
          type="text"
          name="query"
          required
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. what are the contraindications?"
          disabled={busy}
          className="min-w-0 flex-1 rounded-full border border-black/[.08] bg-transparent px-4 py-2 text-sm outline-none focus:border-black/20 disabled:opacity-50 dark:border-white/[.145] dark:focus:border-white/30"
        />
        <button
          type="submit"
          disabled={busy}
          title="Dev-only: non-streaming POST /chat"
          className="shrink-0 rounded-full border border-dashed border-amber-600/50 px-3 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 disabled:opacity-40 dark:text-amber-400"
        >
          {pending ? "Thinking…" : "Ask (dev)"}
        </button>
        <button
          type="button"
          onClick={runStream}
          disabled={busy}
          title="Dev-only: streaming POST /chat/stream over SSE"
          className="shrink-0 rounded-full border border-dashed border-sky-600/50 px-3 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-500/10 disabled:opacity-40 dark:text-sky-400"
        >
          {stream.phase === "streaming" ? "Streaming…" : "Ask (streaming)"}
        </button>
      </form>

      {/* ---- streaming result ---- */}
      {stream.phase !== "idle" && (
        <div aria-live="polite" className="mt-3 space-y-2 text-sm">
          <p className="text-xs text-zinc-500">Q (stream): {stream.question}</p>

          {stream.phase === "error" && !stream.text && (
            <p className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
              {stream.error}
            </p>
          )}

          {(stream.text || stream.phase === "streaming") && (
            <div
              className={`rounded-lg border p-3 ${
                stream.phase === "refused"
                  ? "border-amber-600/30 bg-amber-500/5"
                  : "border-sky-600/25 bg-sky-500/5"
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    stream.phase === "refused"
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "bg-sky-600/10 text-sky-700 dark:text-sky-400"
                  }`}
                >
                  {stream.phase === "refused"
                    ? "not grounded — refused (not streamed)"
                    : stream.phase === "streaming"
                      ? "streaming…"
                      : "grounded — streamed"}
                </span>
                {stream.sessionId && (
                  <span className="truncate font-mono text-[10px] text-zinc-500">
                    session {stream.sessionId.slice(0, 8)}…
                  </span>
                )}
              </div>

              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {stream.text}
                {stream.phase === "streaming" && (
                  <span className="ml-0.5 inline-block animate-pulse">▌</span>
                )}
              </p>

              {stream.phase === "error" && stream.text && (
                <p className="mt-2 text-xs text-red-700 dark:text-red-400">
                  {stream.error}
                </p>
              )}
            </div>
          )}

          {stream.sources.length > 0 && (
            <ul className="space-y-1">
              {stream.sources.map((s, i) => (
                <li
                  key={`${s.document}-${s.chunk_index}-${i}`}
                  className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
                >
                  <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 font-mono tabular-nums">
                    {s.score.toFixed(4)}
                  </span>
                  <span className="min-w-0 truncate">{s.document}</span>
                  <span className="shrink-0 text-zinc-500">
                    chunk #{s.chunk_index}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---- non-streaming result (unchanged path) ---- */}
      <div aria-live="polite" className="mt-3 text-sm">
        {state.kind === "error" && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            {state.message}
          </p>
        )}

        {state.kind === "success" && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500">Q: {state.question}</p>
            <div
              className={`rounded-lg border p-3 ${
                state.grounded
                  ? "border-black/[.08] dark:border-white/[.145]"
                  : "border-amber-600/30 bg-amber-500/5"
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    state.grounded
                      ? "bg-green-600/10 text-green-700 dark:text-green-400"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {state.grounded ? "grounded" : "not grounded — refused"}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {state.answer}
              </p>
            </div>

            {state.sources.length > 0 && (
              <ul className="space-y-1">
                {state.sources.map((s, i) => (
                  <li
                    key={`${s.document}-${s.chunk_index}-${i}`}
                    className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
                  >
                    <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 font-mono tabular-nums">
                      {s.score.toFixed(4)}
                    </span>
                    <span className="min-w-0 truncate">{s.document}</span>
                    <span className="shrink-0 text-zinc-500">
                      chunk #{s.chunk_index}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
