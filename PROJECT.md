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
- **Phase:** M8 complete → M9 next.
- **Current milestone:** M9 — AI chat over docs (RAG + streaming), persisted sessions.
- **Last completed:** M8 — vector search endpoint (query → embed → Qdrant top-k, user-scoped → join chunk text from Postgres). Retrieval validated across three queries: relevant queries surface the correct chunks (contraindications 0.42, renal dose 0.50), off-topic control near-zero (~0.00). Chunk size tuned down to ~250-350 tokens (from ~500-800), lifting relevant scores ~0.35 → 0.50 and giving clean query discrimination.
- **Blockers:** none
- **Notes:** D-010 RESOLVED — coarse chunking (2 chunks/4pp) was the real cause of weak retrieval, not the extractor; halving chunk size fixed it. Residual table-cell label damage from pymupdf4llm persists but the dosing *section* retrieves correctly — accepted for synthetic demo; production with real clinical tables would warrant a dedicated table extractor. Derived a retrieval score threshold for M9: relevant ≥0.42, noise ≤0.01, so a ~0.2 cutoff cleanly separates them (use for the "I don't know" path). Qdrant collection reppilot_chunks (1536/cosine) has payload indexes on document_id, chunk_index, user_id (D-011). University network blocks port 5432 → hotspot/VPN for local DB (irrelevant in prod).
  Open follow-ups: (1) 127.0.0.1 backend URL → env var before deploy; (2) npm audit at M15; (3) optional jwt_key networkless refinement; (4) stray .git above reppilot; (5) webhook missing-secret 500→400 (minor); (6) Blob helper pinned x-api-version 12; (7) remove Process/Embed/Search dev controls before ship; (8) dedicated table extractor for prod (D-010 residual).

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