// 127.0.0.1, not localhost: Node resolves "localhost" to ::1 (IPv6) first, while
// uvicorn binds to 127.0.0.1 (IPv4) by default — server-side fetch would ECONNREFUSED.
const API_URL = "http://127.0.0.1:8000";

// Server-side only. `fetch` is uncached by default in Next 16, so this hits the
// API on every request.
async function getBackendStatus(): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/health`);
    if (!res.ok) return `error (HTTP ${res.status})`;
    const data: { status?: string } = await res.json();
    return data.status ?? "unknown";
  } catch {
    return "unreachable";
  }
}

export default async function Home() {
  const status = await getBackendStatus();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight">RepPilot</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Backend status: {status}
      </p>
    </main>
  );
}
