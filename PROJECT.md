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
- **Phase:** M15 Stage 1 (code prep) complete → Stage 2 is the manual deploy itself.
- **Current milestone:** M15 — production deploy (Vercel + Render), env hardening, remove dev controls, demo prep.
- **M15 Stage 1 (code only, NOT deployed):** backend URL now env-driven via `NEXT_PUBLIC_API_URL` (default `http://127.0.0.1:8000`) resolved once in `frontend/src/lib/config.ts`; CORS env-driven via `FRONTEND_URL` (comma-separated, trailing slash tolerated). ALL dev controls removed (/me debug box, Process/Embed/Search/Ask buttons, dev-chat, dev-search, orphaned roleplay dev-conversation, dashboard/actions.ts). Ingestion is now automatic: upload schedules a background process→embed, so a document reaches 'ready' with no manual step. New intermediate status `embedding` — 'ready' now means "vectors exist", not just "chunked". requirements.txt: added `pymupdf` + `pydantic` (imported directly), dropped unused `vercel_blob`. Verified: clean-venv install, `uvicorn app.main:app --host 0.0.0.0 --port $PORT` boots and serves all 22 routes, frontend prod build passes, real end-to-end upload→ready in ~10s.
- **Last completed:** M14 — progress/analytics. GET /progress aggregates the user's coaching_reports; /progress page with overall trend chart, per-dimension trend chart (recharts), summary stat cards, session table + history. Real aggregation verified (avg 56 = mean of 45/55/60/65). No new AI. Nav renamed for users (Assistant/Meeting prep/Practice/Documents).
- **Blockers:** none
- **Notes:** Full product loop complete: upload→chunk→embed→retrieve→chat/prep/roleplay→coach→track. Follow-ups: (1) 127.0.0.1→env var **[DONE M15]**; (2) npm audit [M15 stage 2]; (3) jwt_key [optional]; (4) stray .git; (5) webhook 500→400 [minor]; (6) Blob x-api-version 12; (7) REMOVE all dev controls **[DONE M15]**; (8) prod table extractor (D-010); (9) source relevance floor/per-doc scoping; (10) session sidebar (deferred); (11) recharts added in M14; (12) don't reorder `src/lib/dimensions.ts` without re-running the palette validator; (13) **background ingest dies with the process** — a host that sleeps or restarts mid-pipeline leaves a document on 'processing'/'embedding' forever; there is no retry UI now that the dev buttons are gone (the /process and /embed endpoints still exist). A real queue is the proper fix; (14) `/progress` returns HTTP 200 rather than 307 when signed out because `loading.tsx` streams the shell first — the redirect still fires and no data is exposed.

## MILESTONES

### Week 1 — Foundation
- [x] **M0** Monorepo scaffold; both apps boot; `/health` ok; homepage shows backend status.
- [x] **M1** Next.js shell + Clerk auth; resource-based route protection; sign-in/up; protected dashboard.
- [x] **M2** FastAPI + Postgres (Neon) + SQLAlchemy + first migration (`users`).
- [x] **M3** Clerk JWT verification in FastAPI; frontend calls protected `/me`.
- [x] **M4** Clerk webhook → user sync into Postgres.
- [x] **M5** PDF upload UI → FastAPI → Vercel Blob; `documents` row created.

### Week 2 — Intelligence
- [x] **M6** PDF parsing + chunking; `document_chunks` populated.
- [x] **M7** Embedding generation + Qdrant upsert; document status → ready.
- [x] **M8** Vector search endpoint (query → top-k chunks).
- [x] **M9** AI chat over docs (RAG + streaming), persisted sessions.
- [x] **M10** Meeting Prep agent (structured input → structured brief).

### Week 3 — Simulation + Ship
- [x] **M11** Roleplay session create + persona system prompts.
- [x] **M12** Multi-turn roleplay loop with transcript persistence.
- [x] **M13** Coaching engine (transcript → rubric scoring → report).
- [x] **M14** Progress tracking / analytics view.
- [x] **M15** Production deploy (Vercel + Render), env hardening, polish.
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