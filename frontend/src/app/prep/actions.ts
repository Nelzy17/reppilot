"use server";

import { auth } from "@clerk/nextjs/server";

import { API_URL } from "@/lib/config";
import type { MeetingPrepRecord, PrepResult } from "@/lib/types";

/**
 * Generate a meeting brief.
 *
 * Runs on the server so the Clerk token never reaches the browser. Server
 * Functions are reachable by direct POST, so auth is re-checked here; the
 * backend independently scopes retrieval and persistence to the verified user.
 */
export async function generateBriefAction(
  _previous: PrepResult,
  formData: FormData,
): Promise<PrepResult> {
  const product = String(formData.get("product") ?? "").trim();
  const objective = String(formData.get("objective") ?? "").trim();
  const physicianName = String(formData.get("physician_name") ?? "").trim();
  const specialty = String(formData.get("specialty") ?? "").trim();

  if (!product) return { kind: "error", message: "Add the product first." };
  if (!objective) {
    return { kind: "error", message: "Add what you want the meeting to achieve." };
  }

  const { userId, getToken } = await auth();
  if (!userId) return { kind: "error", message: "Not signed in." };

  const token = await getToken();
  if (!token) return { kind: "error", message: "No Clerk session token." };

  try {
    const res = await fetch(`${API_URL}/meeting-prep`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product,
        objective,
        physician_name: physicianName || null,
        specialty: specialty || null,
      }),
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
      // 422 means the documents can't support a brief — a coverage gap, not a
      // malfunction, and the UI says so in different words.
      if (res.status === 422) return { kind: "no_coverage", message: detail };
      return { kind: "error", message: detail };
    }

    return { kind: "success", prep: (await res.json()) as MeetingPrepRecord };
  } catch {
    return {
      kind: "error",
      message: "Couldn't reach RepPilot — check the backend is running.",
    };
  }
}
