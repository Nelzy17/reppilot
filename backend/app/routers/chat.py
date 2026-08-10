"""Grounded chat over the user's documents (M9a — non-streaming).

Persistence is deliberately all-or-nothing: the question, the answer and any
newly created session are committed in a single transaction after the answer
exists. A failed model call therefore leaves no half-written turn behind.
"""

import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.clerk import get_current_user_id
from app.db.session import AsyncSessionLocal, get_db
from app.models import ChatMessage, ChatSession, User
from app.services import rag
from app.services.rag import ChatError, answer_question

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

TITLE_MAX_CHARS = 80


class ChatRequest(BaseModel):
    query: str = Field(..., description="The user's question")
    session_id: uuid.UUID | None = Field(
        None, description="Continue an existing session; omit to start a new one"
    )


async def _require_user(db: AsyncSession, clerk_user_id: str) -> User:
    user = (
        await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No user record for this account yet; try again shortly",
        )
    return user


async def _require_session(
    db: AsyncSession, session_id: uuid.UUID, user_id: uuid.UUID
) -> ChatSession:
    """Ownership is part of the lookup: someone else's session reads as missing."""
    session = (
        await db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id, ChatSession.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )
    return session


@router.post("")
async def chat(
    payload: ChatRequest,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    query = (payload.query or "").strip()
    if not query:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Query must not be empty"
        )

    user = await _require_user(db, clerk_user_id)
    # Read the id out now and use the plain value from here on. rollback()
    # expires every ORM object attached to the session, so touching user.id
    # afterwards would trigger a lazy refresh — synchronous IO outside the
    # greenlet context, which raises MissingGreenlet and masks the real error.
    user_id = user.id

    session: ChatSession | None = None
    if payload.session_id is not None:
        session = await _require_session(db, payload.session_id, user_id)
        session_id = session.id

    try:
        result = await answer_question(db, user_id=user_id, query=query)
    except ChatError as exc:
        # Nothing has been written yet, so there is no partial turn to undo;
        # roll back anyway to leave the session clean for the next request.
        await db.rollback()
        logger.warning("Chat failed for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not generate an answer: {exc}",
        ) from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("Unexpected chat failure for user %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error while answering",
        ) from exc

    try:
        if session is None:
            session = ChatSession(
                user_id=user_id,
                # First question doubles as the session title for M9b's list.
                title=query[:TITLE_MAX_CHARS],
            )
            db.add(session)
            await db.flush()  # assign session.id before the messages reference it
            session_id = session.id

        db.add(
            ChatMessage(session_id=session_id, role="user", content=query, sources=None)
        )
        db.add(
            ChatMessage(
                session_id=session_id,
                role="assistant",
                content=result.answer,
                sources=result.sources or None,
            )
        )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to persist chat turn for user %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save the conversation",
        ) from exc

    return {
        "session_id": str(session_id),
        "answer": result.answer,
        "sources": result.sources,
        "grounded": result.grounded,
    }


# --------------------------------------------------------------------------
# Streaming variant (M9b-1). The non-streaming /chat above is unchanged and
# remains the fallback.
# --------------------------------------------------------------------------

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    # Tell nginx-style proxies not to buffer, or tokens arrive in one burst.
    "X-Accel-Buffering": "no",
}


def _sse(event: str, data: dict[str, Any]) -> bytes:
    """One SSE frame. Data is JSON so newlines in tokens can't break framing."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()


async def _persist_turn(
    user_id: uuid.UUID,
    session_id: uuid.UUID | None,
    query: str,
    answer: str,
    sources: list[dict[str, Any]] | None,
) -> uuid.UUID:
    """Write the completed turn in its own short-lived session.

    Deliberately not the request-scoped session: that one would otherwise hold
    a pooled connection open for the whole duration of the model stream, which
    on Neon's pooler is a connection pinned doing nothing for several seconds.
    """
    async with AsyncSessionLocal() as db:
        if session_id is None:
            session = ChatSession(user_id=user_id, title=query[:TITLE_MAX_CHARS])
            db.add(session)
            await db.flush()
            session_id = session.id

        db.add(
            ChatMessage(session_id=session_id, role="user", content=query, sources=None)
        )
        db.add(
            ChatMessage(
                session_id=session_id,
                role="assistant",
                content=answer,
                sources=sources or None,
            )
        )
        await db.commit()
    return session_id


@router.post("/stream")
async def chat_stream(
    payload: ChatRequest,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Same contract as POST /chat, delivered as Server-Sent Events.

    Event types:
      ``token``    {"text": "..."}                       incremental answer text
      ``sources``  {"session_id", "sources", "grounded"} sent once, after the text
      ``refusal``  {"session_id", "answer", "grounded": false, "sources": []}
      ``error``    {"message": "..."}
      ``done``     {}                                    always last

    A refusal is delivered as a single ``refusal`` event and no ``token`` events,
    so the client can tell "refused" from "streamed" without guessing.
    """
    query = (payload.query or "").strip()
    if not query:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Query must not be empty"
        )

    user = await _require_user(db, clerk_user_id)
    user_id = user.id

    session_id: uuid.UUID | None = None
    if payload.session_id is not None:
        session = await _require_session(db, payload.session_id, user_id)
        session_id = session.id

    # Retrieval and the threshold gate run BEFORE any streaming, so a failure
    # here is still a normal HTTP error with a proper status code rather than
    # an error buried inside a 200 stream.
    try:
        passages = await rag.retrieve(db, user_id, query)
    except ChatError as exc:
        await db.rollback()
        logger.warning("Streaming chat retrieval failed for %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not generate an answer: {exc}",
        ) from exc

    # Release the request-scoped connection back to the pool before the model
    # stream begins. Safe because every value needed from here on is a plain
    # Python value, not a live ORM attribute.
    await db.rollback()

    if not passages:
        # Hallucination guard: the model is never called.
        logger.info("Streaming chat refused (nothing cleared threshold) for %s", user_id)
        refusal_session_id = await _persist_turn(
            user_id, session_id, query, rag.REFUSAL_TEXT, None
        )

        async def refusal_stream() -> AsyncIterator[bytes]:
            yield _sse(
                "refusal",
                {
                    "session_id": str(refusal_session_id),
                    "answer": rag.REFUSAL_TEXT,
                    "grounded": False,
                    "sources": [],
                },
            )
            yield _sse("done", {})

        return StreamingResponse(
            refusal_stream(), media_type="text/event-stream", headers=SSE_HEADERS
        )

    sources = rag.cite(passages)

    async def answer_stream() -> AsyncIterator[bytes]:
        parts: list[str] = []
        try:
            async for delta in rag.stream_answer_deltas(passages, query):
                parts.append(delta)
                yield _sse("token", {"text": delta})
        except ChatError as exc:
            # Mid-stream failure: tell the client, and persist nothing. A
            # half-finished answer must not enter the conversation history.
            logger.warning("Chat stream failed for %s: %s", user_id, exc)
            yield _sse("error", {"message": str(exc)})
            yield _sse("done", {})
            return
        except Exception as exc:  # noqa: BLE001 - must not escape as a raw crash
            logger.exception("Unexpected chat stream failure for %s", user_id)
            yield _sse("error", {"message": "Unexpected error while answering"})
            yield _sse("done", {})
            return

        answer = "".join(parts).strip()
        if not answer:
            logger.warning("Chat stream produced no text for %s", user_id)
            yield _sse("error", {"message": "The model returned an empty answer"})
            yield _sse("done", {})
            return

        try:
            final_session_id = await _persist_turn(
                user_id, session_id, query, answer, sources
            )
        except Exception:
            logger.exception("Failed to persist streamed turn for %s", user_id)
            yield _sse(
                "error", {"message": "Answer complete but could not be saved"}
            )
            yield _sse("done", {})
            return

        yield _sse(
            "sources",
            {
                "session_id": str(final_session_id),
                "sources": sources,
                "grounded": True,
            },
        )
        yield _sse("done", {})

    return StreamingResponse(
        answer_stream(), media_type="text/event-stream", headers=SSE_HEADERS
    )


@router.get("/sessions")
async def list_sessions(
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """The caller's own chat sessions, newest first."""
    user = await _require_user(db, clerk_user_id)

    sessions = (
        (
            await db.execute(
                select(ChatSession)
                .where(ChatSession.user_id == user.id)
                .order_by(ChatSession.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    return [
        {
            "id": str(s.id),
            "title": s.title,
            "created_at": s.created_at.isoformat(),
        }
        for s in sessions
    ]


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A session's messages in turn order."""
    user = await _require_user(db, clerk_user_id)
    session = await _require_session(db, session_id, user.id)

    messages = (
        (
            await db.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session.id)
                .order_by(ChatMessage.created_at)
            )
        )
        .scalars()
        .all()
    )

    return {
        "id": str(session.id),
        "title": session.title,
        "created_at": session.created_at.isoformat(),
        "messages": [
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "sources": m.sources,
                "created_at": m.created_at.isoformat(),
            }
            for m in messages
        ],
    }
