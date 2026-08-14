import { auth } from "@clerk/nextjs/server";

import { API_URL } from "@/lib/config";

/**
 * SSE pass-through for a roleplay turn. Production path for /roleplay.
 *
 * Same reasoning as /api/chat/stream: the browser needs to read the reply
 * incrementally, and a Server Action cannot return an incremental stream, so
 * the token is attached here on the server and the upstream SSE body is piped
 * through untouched. No logic lives here.
 */
export async function POST(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ detail: "Not signed in" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = await getToken();
  if (!token) {
    return new Response(JSON.stringify({ detail: "No Clerk session token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { session_id?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ detail: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionId = String(body?.session_id ?? "").trim();
  const message = String(body?.message ?? "").trim();
  if (!sessionId || !message) {
    return new Response(
      JSON.stringify({ detail: "session_id and message are both required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${API_URL}/roleplay/sessions/${encodeURIComponent(sessionId)}/message`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
        cache: "no-store",
        // @ts-expect-error -- duplex is valid at runtime, not yet in DOM types
        duplex: "half",
      },
    );
  } catch {
    return new Response(
      JSON.stringify({ detail: "Could not reach the backend" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  // Pass errors through with their status and body intact — a 409 on a
  // completed session needs to reach the client as a 409.
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return new Response(text || JSON.stringify({ detail: upstream.statusText }), {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
