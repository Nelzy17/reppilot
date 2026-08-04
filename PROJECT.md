# RepPilot — Project State & Roadmap

> **Living source of truth.** Lives in the repo root; Claude Code updates it as part
> of every milestone. Every chat reads this FIRST each session. Architecture sets the
> target; Claude Code + Build Review record the result.
>
> Stable design (product brief, architecture, schema, locked decisions) lives in
> Project Instructions. The *why* behind decisions lives in `decision-log.md`
> (Project Knowledge). This file is roadmap + current state + acceptance criteria +
> API contracts only.

## CURRENT STATE
## CURRENT STATE
- **Phase:** M2 complete → M3 next.
- **Current milestone:** M3 — Clerk JWT verification in FastAPI; frontend calls protected /me.
- **Last completed:** M2 — FastAPI + Postgres (Neon) + SQLAlchemy 2.0 async + Alembic; users table migrated.
- **Blockers:** none
- **Notes:** DB is Neon Postgres 18; pooled URL for app, direct URL for migrations; both in gitignored backend/.env. Follow-ups still open: (1) 127.0.0.1 backend URL → env var before deploy; (2) npm audit at M15. Also open: stray .git repo somewhere above reppilot — investigate.

## MILESTONES

### Week 1 — Foundation
- [x] **M0** Monorepo scaffold; both apps boot; `/health` ok; homepage shows backend status.
- [x] **M1** Next.js shell + Clerk auth; resource-based route protection; sign-in/up; protected dashboard.
- [x] **M2** FastAPI + Postgres (Neon) + SQLAlchemy + first migration (`users`).
- [ ] **M3** Clerk JWT verification in FastAPI; frontend calls protected `/me`.
- [ ] **M4** Clerk webhook → user sync into Postgres.
- [ ] **M5** PDF upload UI → FastAPI → Vercel Blob; `documents` row created.

### Week 2 — Intelligence
- [ ] **M6** PDF parsing + chunking; `document_chunks` populated.
- [ ] **M7** Embedding generation + Qdrant upsert; document status → ready.
- [ ] **M8** Vector search endpoint (query → top-k chunks).
- [ ] **M9** AI chat over docs (RAG + streaming), persisted sessions.
- [ ] **M10** Meeting Prep agent (structured input → structured brief).

### Week 3 — Simulation + Ship
- [ ] **M11** Roleplay session create + persona system prompts.
- [ ] **M12** Multi-turn roleplay loop with transcript persistence.
- [ ] **M13** Coaching engine (transcript → rubric scoring → report).
- [ ] **M14** Progress tracking / analytics view.
- [ ] **M15** Production deploy (Vercel + Render), env hardening, polish.
      Also: create Demo chat + demo script; promote AI Safety checklist to a skill.

## ACCEPTANCE CRITERIA (current milestone only)
**M0:**
- backend boots with uvicorn; `/health` returns 200 JSON; `/docs` renders
- frontend boots with `npm run dev`; homepage renders
- homepage shows "Backend status: ok" (proves cross-app HTTP + CORS)
- `.gitignore` excludes node_modules/, .venv/, .env
- initial commit made; no secrets or dependencies committed

## API CONTRACTS
Conventions: dev base URL `http://localhost:8000`; non-public routes require
`Authorization: Bearer <clerk_jwt>`; errors as JSON `{ "detail": "..." }`; IDs are
UUID strings; timestamps ISO-8601 UTC.

- `GET /health` — public (M0) → `200 { "status": "ok", "service": "reppilot-api" }`
- `GET /me` — protected (M3) → `200 { id, clerk_user_id, email, full_name, role }` / `401`
- `POST /webhooks/clerk` — public, Svix-HMAC-verified (M4) → `200 { "received": true }`
- `POST /documents` — protected (M5), multipart → `201 { id, filename, status: "processing" }`

*(M6–M15 endpoints appended as each milestone is designed.)*