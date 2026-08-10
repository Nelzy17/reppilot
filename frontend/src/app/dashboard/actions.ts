"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import { API_URL } from "@/lib/config";
import type {
  EmbedResult,
  ProcessResult,
  SearchHit,
  SearchResult,
} from "@/lib/types";

const SEARCH_K = 5;

/**
 * DEV/TESTING ONLY (M6 aid) — kick off backend processing for one document.
 *
 * Runs on the server, so the Clerk token is attached here and never reaches the
 * browser (unlike the upload, which posts directly for body-size reasons).
 *
 * Server Functions are reachable by direct POST, not only through our UI, so
 * auth is re-checked here rather than assumed from the page that rendered the
 * button. Ownership is enforced independently by the backend, which scopes the
 * lookup to the verified user and returns 404 for anyone else's document.
 */
export async function processDocumentAction(
  _previous: ProcessResult,
  formData: FormData,
): Promise<ProcessResult> {
  const documentId = String(formData.get("documentId") ?? "").trim();
  if (!documentId) {
    return { kind: "error", message: "Missing document id" };
  }

  const { userId, getToken } = await auth();
  if (!userId) {
    return { kind: "error", message: "Not signed in" };
  }

  const token = await getToken();
  if (!token) {
    return { kind: "error", message: "No Clerk session token" };
  }

  try {
    const res = await fetch(
      `${API_URL}/documents/${encodeURIComponent(documentId)}/process`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        if (typeof body?.detail === "string") detail = body.detail;
      } catch {
        /* non-JSON error body */
      }
      // Still revalidate: a failed run flips the row to status='failed', and
      // the list should show that.
      revalidatePath("/dashboard");
      return { kind: "error", message: `${res.status} — ${detail}` };
    }

    const data = await res.json();
    revalidatePath("/dashboard");

    return {
      kind: "success",
      status: String(data.status ?? "unknown"),
      page_count: data.page_count ?? null,
      chunk_count: Number(data.chunk_count ?? 0),
      total_tokens: Number(data.total_tokens ?? 0),
    };
  } catch {
    return { kind: "error", message: "Could not reach the backend" };
  }
}

/**
 * DEV/TESTING ONLY (M7 aid) — embed one document's chunks and upsert the
 * vectors into Qdrant.
 *
 * Same server-side token pattern as processDocumentAction: the Clerk token is
 * attached here, never in the browser. Auth is re-checked because Server
 * Functions are reachable by direct POST; the backend independently scopes the
 * document lookup to the verified user.
 */
export async function embedDocumentAction(
  _previous: EmbedResult,
  formData: FormData,
): Promise<EmbedResult> {
  const documentId = String(formData.get("documentId") ?? "").trim();
  if (!documentId) {
    return { kind: "error", message: "Missing document id" };
  }

  const { userId, getToken } = await auth();
  if (!userId) {
    return { kind: "error", message: "Not signed in" };
  }

  const token = await getToken();
  if (!token) {
    return { kind: "error", message: "No Clerk session token" };
  }

  try {
    const res = await fetch(
      `${API_URL}/documents/${encodeURIComponent(documentId)}/embed`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        if (typeof body?.detail === "string") detail = body.detail;
      } catch {
        /* non-JSON error body */
      }
      // A failed embed flips the row to status='failed'; refresh so the badge
      // reflects that.
      revalidatePath("/dashboard");
      return { kind: "error", message: `${res.status} — ${detail}` };
    }

    const data = await res.json();
    revalidatePath("/dashboard");

    return {
      kind: "success",
      status: String(data.status ?? "unknown"),
      chunk_count: Number(data.chunk_count ?? 0),
      embedded_count: Number(data.embedded_count ?? 0),
      points_in_collection: Number(data.points_in_collection ?? 0),
    };
  } catch {
    return { kind: "error", message: "Could not reach the backend" };
  }
}

/**
 * DEV/TESTING ONLY (M8 aid) — vector search over the caller's own chunks.
 *
 * Same server-side token pattern as the Process/Embed actions: the Clerk token
 * is attached here, never in the browser. Auth is re-checked because Server
 * Functions are reachable by direct POST; the backend scopes the search to the
 * verified user's own vectors regardless.
 *
 * Read-only, so no revalidatePath — nothing on the page has changed.
 */
export async function searchAction(
  _previous: SearchResult,
  formData: FormData,
): Promise<SearchResult> {
  const query = String(formData.get("query") ?? "").trim();
  if (!query) {
    return { kind: "error", message: "Enter a query first" };
  }

  const { userId, getToken } = await auth();
  if (!userId) {
    return { kind: "error", message: "Not signed in" };
  }

  const token = await getToken();
  if (!token) {
    return { kind: "error", message: "No Clerk session token" };
  }

  try {
    const res = await fetch(`${API_URL}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, k: SEARCH_K }),
      cache: "no-store",
    });

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        if (typeof body?.detail === "string") detail = body.detail;
      } catch {
        /* non-JSON error body */
      }
      return { kind: "error", message: `${res.status} — ${detail}` };
    }

    // The endpoint returns a bare array; an empty one is a valid "no matches".
    const hits = (await res.json()) as SearchHit[];
    return {
      kind: "success",
      query,
      hits: Array.isArray(hits) ? hits : [],
    };
  } catch {
    return { kind: "error", message: "Could not reach the backend" };
  }
}
