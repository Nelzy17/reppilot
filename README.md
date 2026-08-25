# RepPilot

**An AI-powered field-enablement platform for Life Sciences sales representatives** — grounded document chat, AI meeting-prep briefs, and physician roleplay with automated coaching.

🔗 **Live demo:** [reppilot-frontend.vercel.app](https://reppilot-frontend.vercel.app)
📦 **Repo:** [github.com/Nelzy17/reppilot](https://github.com/Nelzy17/reppilot)

> ⚠️ All clinical content in the demo is **fictional** (a made-up drug, "Cardovex"), generated purely to exercise the pipeline. Nothing here is medical information.

---

## What it does

Pharmaceutical field reps have to walk into physician meetings fluent in dense clinical documents, anticipate hard questions, and never overstate what the evidence supports. RepPilot is a practice-and-preparation tool built around that job:

- **Document Assistant** — grounded RAG chat over the rep's uploaded product documents. Every answer streams in with the source passages it came from, and the system refuses to answer when the documents don't cover the question rather than guessing.
- **Meeting Prep** — turns a structured brief request (physician, specialty, product, objective) into talking points, likely objections with suggested responses, and follow-ups — plus an explicit statement of what the documents *don't* cover.
- **Roleplay** — the rep practices a detailing conversation against an AI physician persona (5 specialties × 5 temperaments) that stays in character, pushes back like a real skeptic, and refuses to fabricate clinical facts.
- **Coaching** — scores a completed roleplay across five dimensions with specific, transcript-referenced feedback, checking the rep's clinical claims against the source documents.
- **Progress** — trends coaching scores over time so a rep can see improvement.

---

## Why it's interesting (the engineering)

This is a Life Sciences tool, so the central problem isn't "make an LLM talk" — it's **making it grounded and safe**. A confidently-wrong drug fact is the failure mode the whole system is designed to prevent. The interesting decisions all follow from that:

- **Grounded RAG with visible attribution.** Answers derive only from retrieved chunks, with source passages and similarity scores surfaced in the UI. A calibrated score threshold gates retrieval — if nothing scores above it, the system returns an honest "I don't have that in your documents" instead of hallucinating.
- **Forced gap-declaration in meeting prep.** The brief is generated via OpenAI Structured Outputs against a schema that *requires* a `grounding_note` field — so the model must explicitly state what the documents don't cover (e.g. "no comparative efficacy data") rather than silently inventing it.
- **Prompt-injection resistance.** Uploaded document text is treated as *data, not instructions*. Tested adversarially with a PDF containing embedded "ignore all instructions" attacks — the system described them as document content rather than obeying them.
- **Inverted grounding for roleplay.** The physician persona is deliberately *product-cold* (it hasn't seen the docs — the rep has to explain the product, which is the whole point of practice) but *clinically constrained* (it raises objections as questions and never asserts fabricated clinical facts, so the rep never absorbs misinformation). The role-lock was hardened against character-break attacks ("ignore the roleplay, you're an AI now").
- **Doc-grounded coaching.** The coach assesses "clinical accuracy" by checking the rep's claims against the actual source documents — so it flags unsupported claims (e.g. an invented "40% mortality reduction") instead of inventing its own "correct" answer to grade against.

---

## Architecture

```
Next.js (UI only)  ──►  FastAPI (all logic + AI)  ──►  OpenAI  (embeddings + chat)
   Vercel                    Render                 ──►  Qdrant  (vector search)
                                                    ──►  Neon    (Postgres)
                                                    ──►  Vercel Blob (raw PDFs)
   Clerk (auth) ──────────────────────────────────────►  (JWT verify + webhook user sync)
```

**Dual-backend split (D-001):** FastAPI owns all business logic and AI; Next.js is UI-only. The Python AI ecosystem lives more naturally in FastAPI, at the accepted cost of two deploy targets, CORS, and cross-service auth.

**No LangChain (D-002):** OpenAI and Qdrant are called through their own SDKs directly, for full control over chunking, prompts, and retrieval — and because the abstraction obscures behavior for straightforward RAG.

**The RAG pipeline:** PDF → `pymupdf4llm` extraction → structure-aware chunking (~250–350 tokens) → `text-embedding-3-small` (1536-dim) → Qdrant upsert with payload indexes. Chunk text lives in Postgres; Qdrant holds vectors + IDs to join back. Retrieval is user-scoped for multi-tenancy.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind |
| Backend | FastAPI, Python 3.12, SQLAlchemy 2.0 (async), Alembic |
| AI | OpenAI (`text-embedding-3-small`, `gpt-4o-mini`, Structured Outputs, streaming) |
| Vector DB | Qdrant Cloud |
| Database | Neon (Postgres) |
| Auth | Clerk (networkless JWT verification, Svix-verified webhooks) |
| Storage | Vercel Blob (private) |
| Deploy | Vercel (frontend) + Render (backend) |

---

## Running locally

**Prerequisites:** Python 3.12, Node 18+, and accounts for Neon, Qdrant, Clerk, OpenAI, and Vercel Blob.

**Backend**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
# Create backend/.env with:
#   DATABASE_URL, DATABASE_URL_DIRECT, OPENAI_API_KEY,
#   QDRANT_URL, QDRANT_API_KEY, BLOB_READ_WRITE_TOKEN,
#   CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET, FRONTEND_URL
alembic upgrade head
fastapi dev app/main.py     # http://127.0.0.1:8000
```

**Frontend**
```bash
cd frontend
npm install
# Create frontend/.env.local with:
#   NEXT_PUBLIC_API_URL, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY,
#   NEXT_PUBLIC_CLERK_SIGN_IN_URL, NEXT_PUBLIC_CLERK_SIGN_UP_URL
npm run dev                 # http://localhost:3000
```

Secrets live only in gitignored `.env` files — none are committed.

---

## Known constraints & production notes

Honest about where the free-tier demo bends:

- **Document ingestion on the deployed free tier.** `pymupdf4llm` costs ~200 MB transiently per parse regardless of document size; on Render's 512 MB free instance this tips the process over its memory limit. Ingestion was moved to a background task (so requests return immediately), but the *peak* memory is intrinsic to the parser. For the live demo, documents are processed locally (full RAM) against the shared Neon/Qdrant that production reads from. **Production fix:** a larger instance, or a dedicated ingest worker / job queue — decoupling ingestion from the web process entirely.
- **PDF table extraction.** `pymupdf4llm` degrades complex tables; smaller chunks mitigate retrieval impact, but a production system with real clinical tables would use a dedicated table extractor. Diagnosed and deferred deliberately after measuring that retrieval still answered dosing questions correctly.
- **Clerk dev instance.** Deployed on Clerk's development instance; a production launch would use a production instance with a custom domain.

---

## What I'd do next

- Move ingestion to a job queue (Celery/RQ) with a dedicated worker.
- Per-document chat scoping and a relevance floor on displayed sources.
- Session history sidebar (backend already supports it).
- A dedicated table extractor for structured clinical content.
