import { auth } from "@clerk/nextjs/server";

import { API_URL } from "@/lib/config";

/**
 * SSE pass-through to the FastAPI backend. Production path for /chat.
 *
 * Why this exists: a typewriter effect needs the browser to read the response
 * body incrementally, and a Server Action cannot hand back an incremental
 * stream. Rather than expose the Clerk token to the browser, the browser calls
 * this same-origin route, the token is attached here on the server, and the
 * upstream SSE body is piped straight through untouched.
 *
 * No logic lives here — FastAPI still owns retrieval, grounding and
 * persistence. This is an auth-attaching proxy and nothing more.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ detail: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/chat/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      // Node's fetch buffers the whole body without this hint on some setups.
      // @ts-expect-error -- duplex is valid at runtime, not yet in the DOM types
      duplex: "half",
    });
  } catch {
    return new Response(
      JSON.stringify({ detail: "Could not reach the backend" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  // Pass errors through with their status and JSON body intact.
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
