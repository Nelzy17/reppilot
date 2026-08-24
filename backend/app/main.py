import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, update

from app.config import get_settings
from app.db.session import AsyncSessionLocal
from app.models import Document
from app.routers import (
    chat,
    documents,
    me,
    meeting_prep,
    progress,
    roleplay,
    search,
    webhooks,
)

logger = logging.getLogger(__name__)

SERVICE_NAME = "reppilot-api"

# Statuses that mean "a background task is meant to be working on this".
IN_FLIGHT_STATUSES = ("processing", "embedding")


async def _fail_stranded_documents() -> None:
    """Mark documents whose ingest task died with a previous process.

    Ingest runs as a FastAPI background task, which lives and dies with the
    worker. A restart mid-pipeline — an OOM kill, a deploy, a free-tier sleep —
    leaves the row on 'processing' or 'embedding' with nothing left to advance
    it, and the UI polls it forever.

    Only rows older than INGEST_STALE_MINUTES are touched, so a task that is
    genuinely still running (ingest takes seconds) is never cut off, including
    when more than one worker is live.
    """
    settings = get_settings()
    cutoff = datetime.now(timezone.utc) - timedelta(
        minutes=settings.INGEST_STALE_MINUTES
    )

    try:
        async with AsyncSessionLocal() as db:
            stranded = (
                (
                    await db.execute(
                        select(Document.id).where(
                            Document.status.in_(IN_FLIGHT_STATUSES),
                            Document.created_at < cutoff,
                        )
                    )
                )
                .scalars()
                .all()
            )
            if not stranded:
                return

            await db.execute(
                update(Document)
                .where(Document.id.in_(stranded))
                .values(status="failed")
            )
            await db.commit()
            logger.warning(
                "Marked %d document(s) as failed: ingest did not survive a "
                "previous process (%s)",
                len(stranded),
                ", ".join(str(d) for d in stranded),
            )
    except Exception:
        # Never let a housekeeping query stop the API from serving.
        logger.exception("Could not reconcile stranded documents at startup")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await _fail_stranded_documents()
    yield


app = FastAPI(title="RepPilot API", lifespan=lifespan)

# Env-driven (M15): set FRONTEND_URL to the deployed frontend origin, or to a
# comma-separated list to allow preview domains alongside it.
_cors_origins = get_settings().cors_origins
logger.info("CORS allow_origins: %s", _cors_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(me.router)
app.include_router(webhooks.router)
app.include_router(documents.router)
app.include_router(search.router)
app.include_router(chat.router)
app.include_router(meeting_prep.router)
app.include_router(roleplay.router)
app.include_router(progress.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE_NAME}
