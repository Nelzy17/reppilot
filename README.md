# RepPilot

Life Sciences field enablement platform.

Dual-backend monorepo: **FastAPI** owns all logic and AI, **Next.js** is UI-only.

- `backend/` — FastAPI (Python 3.12), serves on `http://localhost:8000`
- `frontend/` — Next.js 16 (App Router, TypeScript, Tailwind), serves on `http://localhost:3000`

See [PROJECT.md](PROJECT.md) for state and roadmap.

## Prerequisites

- Python 3.12
- Node.js 20.9+ (developed on 22.12)

## Backend

First time — create the virtualenv and install dependencies:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Run it:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
fastapi dev app/main.py
```

On macOS/Linux, use `python3.12 -m venv .venv` and `source .venv/bin/activate`.

Health check: <http://localhost:8000/health> → `{"status":"ok","service":"reppilot-api"}`
Interactive docs: <http://localhost:8000/docs>

## Frontend

First time:

```powershell
cd frontend
npm install
```

Run it:

```powershell
cd frontend
npm run dev
```

Open <http://localhost:3000>. The homepage server-side fetches the backend health
endpoint and renders `Backend status: ok`. Start the backend first — otherwise the
page renders `Backend status: unreachable`.

## Running both

Use two terminals, one per app. Both defaults assume the other app is on its
usual local port, so nothing has to be configured for local development.

Note: the frontend targets `http://127.0.0.1:8000` by default, not
`http://localhost:8000`. Node resolves `localhost` to IPv6 `::1` first, while
uvicorn binds to IPv4 `127.0.0.1` by default, so the literal IPv4 address avoids
a connection-refused error.

## Configuration

Secrets live in `backend/.env` and `frontend/.env.local`; both are gitignored.
The two deployment-relevant settings:

| Variable | App | Default | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | frontend | `http://127.0.0.1:8000` | Base URL of the FastAPI backend. Set to the deployed backend origin in production. |
| `FRONTEND_URL` | backend | `http://localhost:3000` | Browser origin(s) allowed by CORS. Comma-separate to allow several (e.g. production plus preview domains). |

Two things worth knowing:

- `NEXT_PUBLIC_*` values are inlined at **build** time, not read at runtime.
  Changing `NEXT_PUBLIC_API_URL` on the host means triggering a rebuild — a
  restart alone will keep serving the old value.
- Credentialed CORS cannot use `*`, so `FRONTEND_URL` must list real origins.
  A trailing slash is tolerated (it is stripped) because a browser's `Origin`
  header never has one.

## Deployment

Backend (Render, or any container host) — root directory `backend/`:

- Build: `pip install -r requirements.txt`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Env: everything in `backend/.env`, plus `FRONTEND_URL` set to the deployed
  frontend origin. `DATABASE_URL_DIRECT` is used only by Alembic; run
  `alembic upgrade head` against it separately.

Frontend (Vercel) — root directory `frontend/`:

- Env: the Clerk keys, plus `NEXT_PUBLIC_API_URL` set to the deployed backend
  origin.

Uploads are processed and embedded in a background task on the backend, so the
web service needs to stay awake long enough to finish — on a free tier that
sleeps between requests, a document can be left mid-pipeline.
