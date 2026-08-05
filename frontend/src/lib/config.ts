// 127.0.0.1, not localhost: Node resolves "localhost" to ::1 (IPv6) first, while
// uvicorn binds to 127.0.0.1 (IPv4) by default — server-side fetch would ECONNREFUSED.
//
// Lives in its own module (no server-only imports) so client components can use
// it without pulling @clerk/nextjs/server into the browser bundle.
export const API_URL = "http://127.0.0.1:8000";

/** Keep in step with MAX_UPLOAD_BYTES in backend/app/routers/documents.py. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
