"use client";

import { useRef, useState } from "react";

import {
  endConversationAction,
  openConversationAction,
} from "@/app/roleplay/actions";
import type { RoleplaySession, RoleplayTurn } from "@/lib/types";

/**
 * DEV/TESTING ONLY (M12 aid) — a plain conversation surface so the loop can be
 * exercised end to end before M12b builds the real interface.
 */

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

export default function DevConversation({
  session,
}: {
  session: RoleplaySession;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<RoleplayTurn[]>([]);
  const [streaming, setStreaming] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function enterConversation() {
    setBusy(true);
    setError("");
    const result = await openConversationAction(session.id);
    if (result.ok) {
      setOpen(true);
      setTurns([result.turn]);
    } else {
      setError(result.message);
    }
    setBusy(false);
  }

  async function send() {
    const message = draft.trim();
    if (!message || busy || ended) return;

    setError("");
    setBusy(true);
    setDraft("");
    setTurns((prev) => [
      ...prev,
      { role: "rep", content: message, ts: new Date().toISOString() },
    ]);
    setStreaming("");

    try {
      const res = await fetch("/api/roleplay/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: session.id, message }),
      });

      if (!res.ok || !res.body) {
        let detail = res.statusText;
        try {
          const body = await res.json();
          if (typeof body?.detail === "string") detail = body.detail;
        } catch {
          /* non-JSON */
        }
        setError(`${res.status} — ${detail}`);
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
          } else if (event === "turn") {
            // The backend has persisted it; promote to a real turn.
            setTurns((prev) => [...prev, data as unknown as RoleplayTurn]);
            setStreaming("");
          } else if (event === "error") {
            setError(String(data.message ?? "The reply failed."));
            setStreaming("");
          }
        }
      }
    } catch {
      setError("Couldn't reach the backend.");
    } finally {
      setStreaming("");
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function endSession() {
    setBusy(true);
    const result = await endConversationAction(session.id);
    if (result.ok) {
      setEnded(true);
      setError("");
    } else {
      setError(result.message);
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <div className="border-t border-line px-5 py-4">
        <button
          type="button"
          onClick={enterConversation}
          disabled={busy}
          title="Dev-only: runs the M12 conversation loop"
          className="rounded-full border border-dashed border-amber-600/50 px-4 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 disabled:opacity-40 dark:text-amber-400"
        >
          {busy ? "Starting…" : "Enter conversation (dev)"}
        </button>
        {error && (
          <p className="mt-2 text-xs text-critical">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400">
          Dev conversation · M12b replaces this
        </span>
        <button
          type="button"
          onClick={endSession}
          disabled={busy || ended}
          className="rounded-full border border-dashed border-line px-3 py-1 text-[11px] text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          {ended ? "Ended" : "End session (dev)"}
        </button>
      </div>

      <div className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto px-5 py-4">
        {turns.map((turn, i) => (
          <div
            key={`${turn.ts}-${i}`}
            className={turn.role === "rep" ? "flex justify-end" : ""}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                turn.role === "rep"
                  ? "bg-accent text-accent-ink"
                  : "border border-line bg-raised text-ink"
              }`}
            >
              <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.12em] opacity-70">
                {turn.role === "rep" ? "You" : "Physician"}
              </span>
              <p className="whitespace-pre-wrap break-words">{turn.content}</p>
            </div>
          </div>
        ))}

        {streaming && (
          <div>
            <div className="max-w-[85%] rounded-lg border border-line bg-raised px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink">
              <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.12em] opacity-70">
                Physician
              </span>
              <p className="whitespace-pre-wrap break-words">
                {streaming}
                <span className="rp-caret" aria-hidden />
              </p>
            </div>
          </div>
        )}

        {busy && !streaming && !ended && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
            <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
            <span className="rp-dot h-1.5 w-1.5 rounded-full bg-muted" />
          </p>
        )}
      </div>

      {error && (
        <p className="border-t border-line px-5 py-2.5 text-xs text-critical">
          {error}
        </p>
      )}

      <div className="border-t border-line px-5 py-3">
        {ended ? (
          <p className="text-[13px] text-muted">
            Session ended. The transcript is saved and becomes M13&rsquo;s
            coaching input.
          </p>
        ) : (
          <div className="flex items-end gap-2.5">
            <label htmlFor="rep-line" className="sr-only">
              Your line to the physician
            </label>
            <textarea
              id="rep-line"
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
              placeholder="What do you say to the physician?"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-accent/50 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !draft.trim()}
              className="h-[40px] shrink-0 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
