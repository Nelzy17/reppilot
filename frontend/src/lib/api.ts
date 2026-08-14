import { auth } from "@clerk/nextjs/server";

import { API_URL } from "@/lib/config";
import type { DocumentSummary, Progress, ProgressResult } from "@/lib/types";

export { API_URL };
export type { DocumentSummary };

export type DocumentsResult =
  | { ok: true; data: DocumentSummary[] }
  | { ok: false; status: number | null; error: string };

/**
 * Server-side only. Lists the caller's documents. The backend scopes the query
 * to the verified Clerk identity, so there is no user id to pass.
 */
export async function getDocuments(): Promise<DocumentsResult> {
  const { getToken } = await auth();
  const token = await getToken();

  if (!token) {
    return { ok: false, status: null, error: "No Clerk session token" };
  }

  try {
    const res = await fetch(`${API_URL}/documents`, {
      headers: { Authorization: `Bearer ${token}` },
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
      return { ok: false, status: res.status, error: detail };
    }

    return { ok: true, data: (await res.json()) as DocumentSummary[] };
  } catch {
    return { ok: false, status: null, error: "Backend unreachable" };
  }
}

/**
 * Server-side only. The caller's coached-session history and summary stats.
 * Pure aggregation — no model is involved.
 */
export async function getProgress(): Promise<ProgressResult> {
  const { getToken } = await auth();
  const token = await getToken();

  if (!token) return { ok: false, message: "No Clerk session token" };

  try {
    const res = await fetch(`${API_URL}/progress`, {
      headers: { Authorization: `Bearer ${token}` },
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
      return { ok: false, message: detail };
    }

    return { ok: true, data: (await res.json()) as Progress };
  } catch {
    return {
      ok: false,
      message: "Couldn't reach RepPilot — check the backend is running.",
    };
  }
}
