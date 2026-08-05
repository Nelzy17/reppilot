import { auth } from "@clerk/nextjs/server";

import { API_URL } from "@/lib/config";

export { API_URL };

/** Shape returned by GET /me once the M4 webhook has synced the row. */
export type SyncedMe = {
  id: string;
  clerk_user_id: string;
  email: string;
  full_name: string | null;
  role: string;
};

/** Shape returned when the token is valid but no users row exists yet (pre-M4). */
export type UnsyncedMe = {
  clerk_user_id: string;
  synced: false;
};

export type Me = SyncedMe | UnsyncedMe;

export type MeResult =
  | { ok: true; data: Me }
  | { ok: false; status: number | null; error: string };

/**
 * Server-side only. Fetches the backend's protected /me with the caller's Clerk
 * session token attached as a bearer credential.
 */
export async function getMe(): Promise<MeResult> {
  const { getToken } = await auth();
  const token = await getToken();

  if (!token) {
    return { ok: false, status: null, error: "No Clerk session token" };
  }

  try {
    const res = await fetch(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      // FastAPI errors are {"detail": "..."}; fall back to raw text if not JSON.
      let detail = res.statusText;
      try {
        const body = await res.json();
        if (typeof body?.detail === "string") detail = body.detail;
      } catch {
        /* non-JSON error body */
      }
      return { ok: false, status: res.status, error: detail };
    }

    return { ok: true, data: (await res.json()) as Me };
  } catch {
    return { ok: false, status: null, error: "Backend unreachable" };
  }
}
