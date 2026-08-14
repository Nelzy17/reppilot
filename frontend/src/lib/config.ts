// The single source of truth for the backend base URL. Everything that talks to
// FastAPI — server components, server actions, the SSE route handlers, and the
// browser-side upload — resolves it from here.
//
// NEXT_PUBLIC_ prefix is required, not stylistic: document-upload.tsx posts from
// the browser (Server Actions cap bodies at 1 MB), so the value has to survive
// into the client bundle. Next inlines NEXT_PUBLIC_* at BUILD time, so changing
// it on the host means rebuilding, not just restarting.
//
// Local default is 127.0.0.1, not localhost: Node resolves "localhost" to ::1
// (IPv6) first, while uvicorn binds 127.0.0.1 (IPv4) — a server-side fetch to
// "localhost" would ECONNREFUSED. In production this is overridden by the env
// var with the real backend origin.
//
// Read as a full static expression so the build-time replacement actually fires;
// destructuring process.env would defeat it.
const DEFAULT_API_URL = "http://127.0.0.1:8000";

// Trailing slashes would produce "//documents" once callers append their paths.
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL
).replace(/\/+$/, "");

/** Keep in step with MAX_UPLOAD_BYTES in backend/app/routers/documents.py. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
