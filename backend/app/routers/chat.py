"""Grounded chat over the user's documents (M9a — non-streaming).

Persistence is deliberately all-or-nothing: the question, the answer and any
newly created session are committed in a single transaction after the answer
exists. A failed model call therefore leaves no half-written turn behind.
"""

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.clerk import get_current_user_id
from app.db.session import get_db
from app.models import ChatMessage, ChatSession, User
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
