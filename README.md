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

Use two terminals, one per app. The backend allows CORS from
`http://localhost:3000`.

Note: the frontend's server-side fetch targets `http://127.0.0.1:8000`, not
`http://localhost:8000`. Node resolves `localhost` to IPv6 `::1` first, while
uvicorn binds to IPv4 `127.0.0.1` by default, so the literal IPv4 address avoids
a connection-refused error.
