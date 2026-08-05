from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import documents, me, webhooks

SERVICE_NAME = "reppilot-api"

app = FastAPI(title="RepPilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(me.router)
app.include_router(webhooks.router)
app.include_router(documents.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE_NAME}
