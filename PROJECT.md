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
- **Phase:** M13 complete → M14 next.
- **Current milestone:** M14 — Progress tracking / analytics view.
- **Last completed:** M13 — coaching engine. Completed transcript → structured coaching report (Structured Outputs / Pydantic): overall + product_knowledge/communication/objection_handling/clinical_accuracy (0–100) + per-dimension narrative + recommendations. Persisted to coaching_reports. Clinical accuracy is DOC-GROUNDED (retrieves product chunks as truth reference) — verified: caught the fabricated 40% mortality claim as unsupported, dinged the score, didn't invent a "correct" figure. Feedback specific/transcript-referenced, honest (45/100, not inflated). Fills M12b coaching placeholder; sources shown for transparency.
- **Blockers:** none
- **Notes:** Coaching only on completed sessions. Doc-grounded clinical accuracy is the key safety design (D-017). Open follow-ups: (1) 127.0.0.1→env var; (2) npm audit M15; (3) jwt_key; (4) stray .git; (5) webhook 500→400; (6) Blob x-api-version 12; (7) remove ALL dev controls before ship; (8) prod table extractor (D-010); (9) source relevance floor/per-doc scoping; (10) session sidebar (deferred).

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