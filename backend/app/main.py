import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
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

app = FastAPI(title="RepPilot API")

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
