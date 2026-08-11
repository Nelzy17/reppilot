"use server";

import { auth } from "@clerk/nextjs/server";

import { API_URL } from "@/lib/config";
import type {
  PersonaCatalogue,
  PersonaPreview,
  RoleplaySession,
  RoleplayTurn,
  StartSessionResult,
} from "@/lib/types";

/** Attach the Clerk token server-side; the browser never sees it. */
async function backend(path: string, init?: RequestInit) {
  const { userId, getToken } = await auth();
  if (!userId) throw new Error("Not signed in");
  const token = await getToken();
  if (!token) throw new Error("No Clerk session token");

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
}

async function detailOf(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    /* non-JSON */
  }
  return res.statusText;
}

/** Persona building blocks for the pickers. Called from the server component. */
export async function fetchPersonaCatalogue(): Promise<PersonaCatalogue | null> {
  try {
    const res = await backend("/roleplay/personas");
    if (!res.ok) return null;
    return (await res.json()) as PersonaCatalogue;
  } catch {
    return null;
  }
}

export async function startSessionAction(
  _previous: StartSessionResult,
  formData: FormData,
): Promise<StartSessionResult> {
  const specialty = String(formData.get("persona_specialty") ?? "").trim();
  const personality = String(formData.get("persona_personality") ?? "").trim();
  const product = String(formData.get("product") ?? "").trim();

  if (!specialty) return { kind: "error", message: "Choose a specialty." };
  if (!personality) return { kind: "error", message: "Choose a personality." };
  if (!product) return { kind: "error", message: "Add the product to practise." };

  try {
    const res = await backend("/roleplay/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persona_specialty: specialty,
        persona_personality: personality,
        product,
      }),
    });

    if (!res.ok) return { kind: "error", message: await detailOf(res) };
    return { kind: "success", session: (await res.json()) as RoleplaySession };
  } catch {
    return {
      kind: "error",
      message: "Couldn't reach RepPilot — check the backend is running.",
    };
  }
}

/**
 * The composed system prompt for a persona.
 *
 * Exposed so the persona wording — a tuning surface — can be read exactly as
 * the model will receive it, before M12 wires it to a conversation.
 */
export async function previewPersonaAction(
  specialty: string,
  personality: string,
  product: string,
): Promise<{ ok: true; preview: PersonaPreview } | { ok: false; message: string }> {
  const params = new URLSearchParams({
    specialty,
    personality,
    product: product.trim() || "this product",
  });

  try {
    const res = await backend(`/roleplay/persona-preview?${params}`);
    if (!res.ok) return { ok: false, message: await detailOf(res) };
    return { ok: true, preview: (await res.json()) as PersonaPreview };
  } catch {
    return { ok: false, message: "Couldn't reach RepPilot." };
  }
}

/**
 * DEV/TESTING ONLY (M12 aid) — the physician's opening turn.
 *
 * Non-streaming, so a Server Action fits and the token stays server-side.
 * Idempotent on the backend: re-opening returns the existing greeting.
 */
export async function openConversationAction(
  sessionId: string,
): Promise<{ ok: true; turn: RoleplayTurn } | { ok: false; message: string }> {
  try {
    const res = await backend(
      `/roleplay/sessions/${encodeURIComponent(sessionId)}/opening`,
      { method: "POST" },
    );
    if (!res.ok) return { ok: false, message: await detailOf(res) };
    const body = await res.json();
    return { ok: true, turn: body.turn as RoleplayTurn };
  } catch {
    return { ok: false, message: "Couldn't reach RepPilot." };
  }
}

/** DEV/TESTING ONLY (M12 aid) — close the session. */
export async function endConversationAction(
  sessionId: string,
): Promise<{ ok: true; status: string; turnCount: number } | { ok: false; message: string }> {
  try {
    const res = await backend(
      `/roleplay/sessions/${encodeURIComponent(sessionId)}/end`,
      { method: "POST" },
    );
    if (!res.ok) return { ok: false, message: await detailOf(res) };
    const body = await res.json();
    return {
      ok: true,
      status: String(body.status ?? "completed"),
      turnCount: Number(body.turn_count ?? 0),
    };
  } catch {
    return { ok: false, message: "Couldn't reach RepPilot." };
  }
}
