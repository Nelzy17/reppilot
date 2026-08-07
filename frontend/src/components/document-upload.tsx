"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { API_URL, MAX_UPLOAD_BYTES } from "@/lib/config";

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "success"; id: string; filename: string; status: string }
  | { kind: "error"; message: string };

export default function DocumentUpload() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    if (!file) return;

    // Fail fast on the obvious cases. The backend re-checks both — including
    // the PDF magic bytes — and stays the authority.
    if (file.size > MAX_UPLOAD_BYTES) {
      setState({
        kind: "error",
        message: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
      });
      return;
    }

    setState({ kind: "uploading" });

    try {
      const token = await getToken();
      if (!token) {
        setState({ kind: "error", message: "Not signed in" });
        return;
      }

      const body = new FormData();
      body.append("file", file);

      const res = await fetch(`${API_URL}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body, // no Content-Type: the browser sets the multipart boundary
      });

      if (!res.ok) {
        let detail = res.statusText;
        try {
          const parsed = await res.json();
          if (typeof parsed?.detail === "string") detail = parsed.detail;
        } catch {
          /* non-JSON error body */
        }
        setState({ kind: "error", message: `${res.status} — ${detail}` });
        return;
      }

      const data = await res.json();
      setState({
        kind: "success",
        id: data.id,
        filename: data.filename,
        status: data.status,
      });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      // The document list is server-rendered; pull it again so the new row
      // (and its status) appears without a manual reload.
      router.refresh();
    } catch {
      setState({ kind: "error", message: "Could not reach the backend" });
    }
  }

  const busy = state.kind === "uploading";

  return (
    <section className="w-full max-w-xl">
      <h2 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
        Upload a PDF
      </h2>

      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setState({ kind: "idle" });
          }}
          className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-foreground file:px-4 file:py-2 file:text-sm file:font-medium file:text-background hover:file:opacity-90 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={!file || busy}
          className="shrink-0 rounded-full border border-black/[.08] px-5 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>

      <div aria-live="polite" className="mt-3 text-sm">
        {state.kind === "idle" && file && (
          <p className="text-zinc-600 dark:text-zinc-400">
            Ready: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
          </p>
        )}
        {state.kind === "uploading" && (
          <p className="text-zinc-600 dark:text-zinc-400">Uploading…</p>
        )}
        {state.kind === "success" && (
          <div className="rounded-lg border border-green-600/30 bg-green-600/5 p-3 text-green-700 dark:text-green-400">
            <p className="font-medium">Uploaded {state.filename}</p>
            <p className="text-xs opacity-80">
              status: {state.status} · id: {state.id}
            </p>
          </div>
        )}
        {state.kind === "error" && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-red-700 dark:text-red-400">
            {state.message}
          </p>
        )}
      </div>
    </section>
  );
}
