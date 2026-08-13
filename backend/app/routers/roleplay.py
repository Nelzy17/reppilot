"""Roleplay session setup (M11).

Creates a practice session and exposes the persona catalogue. The conversation
loop is M12 and scoring is M13 — nothing here calls the model.
"""

import json
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.clerk import get_current_user_id
from app.db.session import AsyncSessionLocal, get_db
from app.models import CoachingReport, RoleplaySession, User
from app.services.coaching import (
    CoachingError,
    NotCoachableError,
    generate_report,
)
from app.services.personas import (
    PERSONALITIES,
    SPECIALTIES,
    build_persona_system_prompt,
    describe_persona,
)
from app.services.roleplay_chat import (
    PHYSICIAN,
    REP,
    RoleplayError,
    generate_opening,
    make_turn,
    stream_reply,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/roleplay", tags=["roleplay"])


class CreateSessionRequest(BaseModel):
    persona_specialty: str = Field(..., description="Specialty component key")
    persona_personality: str = Field(..., description="Personality component key")
    product: str = Field(..., description="The product being practised")


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


def _validate_persona(specialty: str, personality: str) -> None:
    if specialty not in SPECIALTIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Unknown specialty '{specialty}'. Choose one of: "
                f"{', '.join(sorted(SPECIALTIES))}"
            ),
        )
    if personality not in PERSONALITIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Unknown personality '{personality}'. Choose one of: "
                f"{', '.join(sorted(PERSONALITIES))}"
            ),
        )


def _serialise(session: RoleplaySession) -> dict[str, Any]:
    return {
        "id": str(session.id),
        "persona_specialty": session.persona_specialty,
        "persona_personality": session.persona_personality,
        "persona_description": describe_persona(
            session.persona_specialty, session.persona_personality
        ),
        "product": session.product,
        "status": session.status,
        "created_at": session.created_at.isoformat(),
        "completed_at": (
            session.completed_at.isoformat() if session.completed_at else None
        ),
    }


@router.get("/personas")
async def list_personas(
    clerk_user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """The persona building blocks, for the setup UI's pickers."""
    return {
        "specialties": [
            {"key": s.key, "label": s.label, "summary": s.summary}
            for s in SPECIALTIES.values()
        ],
        "personalities": [
            {"key": p.key, "label": p.label, "summary": p.summary}
            for p in PERSONALITIES.values()
        ],
    }


@router.get("/persona-preview")
async def preview_persona(
    specialty: str = Query(..., description="Specialty component key"),
    personality: str = Query(..., description="Personality component key"),
    product: str = Query("this product", description="Product name"),
    clerk_user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """The composed system prompt, for inspection before M12 wires it up.

    The persona text is a tuning surface, so being able to read exactly what the
    model will be told matters more than hiding it.
    """
    _validate_persona(specialty, personality)
    clean_product = (product or "").strip() or "this product"

    return {
        "specialty": specialty,
        "personality": personality,
        "product": clean_product,
        "description": describe_persona(specialty, personality),
        "system_prompt": build_persona_system_prompt(
            specialty, personality, clean_product
        ),
    }


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def create_session(
    payload: CreateSessionRequest,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    specialty = (payload.persona_specialty or "").strip()
    personality = (payload.persona_personality or "").strip()
    product = (payload.product or "").strip()

    if not product:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Product is required"
        )
    _validate_persona(specialty, personality)

    user = await _require_user(db, clerk_user_id)

    session = RoleplaySession(
        user_id=user.id,
        persona_specialty=specialty,
        persona_personality=personality,
        product=product,
        status="active",
        transcript=[],
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    logger.info(
        "Created roleplay session %s (%s, product=%r)",
        session.id,
        describe_persona(specialty, personality),
        product,
    )
    return _serialise(session)


@router.get("/sessions")
async def list_sessions(
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """The caller's own roleplay sessions, newest first."""
    user = await _require_user(db, clerk_user_id)

    sessions = (
        (
            await db.execute(
                select(RoleplaySession)
                .where(RoleplaySession.user_id == user.id)
                .order_by(RoleplaySession.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_serialise(s) for s in sessions]


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    user = await _require_user(db, clerk_user_id)

    # Ownership is part of the lookup: another user's session reads as missing.
    session = (
        await db.execute(
            select(RoleplaySession).where(
                RoleplaySession.id == session_id,
                RoleplaySession.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )

    payload = _serialise(session)
    payload["transcript"] = session.transcript or []
    return payload


# --------------------------------------------------------------------------
# Conversation loop (M12)
# --------------------------------------------------------------------------


class MessageRequest(BaseModel):
    message: str = Field(..., description="What the representative says")


SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
}


def _sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()


async def _locked_session(
    db: AsyncSession, session_id: uuid.UUID, user_id: uuid.UUID
) -> RoleplaySession:
    """Fetch the session for update. FOR UPDATE serialises concurrent turns so
    two in-flight messages cannot each read-then-overwrite the transcript."""
    session = (
        await db.execute(
            select(RoleplaySession)
            .where(
                RoleplaySession.id == session_id,
                RoleplaySession.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )
    return session


def _require_active(session: RoleplaySession) -> None:
    if session.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This session is {session.status}; start a new one to keep practising",
        )


async def _append_turn(
    session_id: uuid.UUID, user_id: uuid.UUID, turn: dict[str, Any]
) -> int:
    """Append one turn in its own short-lived session, returning its index.

    Not the request-scoped session: during streaming that one would hold a
    pooled connection open for the whole model response. Re-reads under FOR
    UPDATE so the append is against current state, and assigns a NEW list —
    mutating the existing one in place would not mark the JSONB column dirty.
    """
    async with AsyncSessionLocal() as db:
        session = (
            await db.execute(
                select(RoleplaySession)
                .where(
                    RoleplaySession.id == session_id,
                    RoleplaySession.user_id == user_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if session is None:
            raise RoleplayError("Session disappeared while saving the turn")

        transcript = list(session.transcript or [])
        transcript.append(turn)
        session.transcript = transcript
        await db.commit()
        return len(transcript) - 1


@router.post("/sessions/{session_id}/opening")
async def create_opening(
    session_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The physician speaks first, before the rep has said anything.

    Idempotent: if an opening already exists it is returned unchanged rather
    than generating a second one.
    """
    user = await _require_user(db, clerk_user_id)
    user_id = user.id
    session = await _locked_session(db, session_id, user_id)
    _require_active(session)

    existing = list(session.transcript or [])
    if existing:
        await db.rollback()
        return {
            "session_id": str(session_id),
            "turn": existing[0],
            "turn_index": 0,
            "created": False,
        }

    specialty = session.persona_specialty
    personality = session.persona_personality
    product = session.product
    await db.rollback()  # release the row before the model call

    try:
        opening = await generate_opening(specialty, personality, product)
    except RoleplayError as exc:
        logger.warning("Opening generation failed for %s: %s", session_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not start the conversation: {exc}",
        ) from exc

    turn = make_turn(PHYSICIAN, opening)
    try:
        index = await _append_turn(session_id, user_id, turn)
    except Exception as exc:
        logger.exception("Failed to persist opening for %s", session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Opening generated but could not be saved",
        ) from exc

    return {
        "session_id": str(session_id),
        "turn": turn,
        "turn_index": index,
        "created": True,
    }


@router.post("/sessions/{session_id}/message")
async def send_message(
    session_id: uuid.UUID,
    payload: MessageRequest,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Send the rep's message and stream the physician's reply.

    Events: ``token`` {"text"}, ``turn`` {the persisted physician turn},
    ``error`` {"message"}, ``done`` {}.

    The rep's message is persisted before streaming begins, so a mid-stream
    failure leaves their words in the transcript but no half-finished physician
    turn beside them.
    """
    message = (payload.message or "").strip()
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Message must not be empty"
        )

    user = await _require_user(db, clerk_user_id)
    user_id = user.id
    session = await _locked_session(db, session_id, user_id)
    _require_active(session)

    specialty = session.persona_specialty
    personality = session.persona_personality
    product = session.product
    # Snapshot the history the reply will be generated against, before the new
    # rep message is appended.
    history = list(session.transcript or [])
    await db.rollback()  # release the connection for the duration of the stream

    rep_turn = make_turn(REP, message)
    try:
        await _append_turn(session_id, user_id, rep_turn)
    except Exception as exc:
        logger.exception("Failed to persist rep message for %s", session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save your message",
        ) from exc

    async def reply_stream() -> AsyncIterator[bytes]:
        parts: list[str] = []
        try:
            async for delta in stream_reply(
                specialty, personality, product, history, message
            ):
                parts.append(delta)
                yield _sse("token", {"text": delta})
        except RoleplayError as exc:
            logger.warning("Roleplay stream failed for %s: %s", session_id, exc)
            yield _sse("error", {"message": str(exc)})
            yield _sse("done", {})
            return
        except Exception:  # noqa: BLE001 - must not escape as a raw crash
            logger.exception("Unexpected roleplay stream failure for %s", session_id)
            yield _sse("error", {"message": "Unexpected error during the reply"})
            yield _sse("done", {})
            return

        reply = "".join(parts).strip()
        if not reply:
            yield _sse("error", {"message": "The physician gave an empty reply"})
            yield _sse("done", {})
            return

        physician_turn = make_turn(PHYSICIAN, reply)
        try:
            index = await _append_turn(session_id, user_id, physician_turn)
        except Exception:
            logger.exception("Failed to persist physician turn for %s", session_id)
            yield _sse(
                "error", {"message": "Reply complete but could not be saved"}
            )
            yield _sse("done", {})
            return

        yield _sse("turn", {**physician_turn, "turn_index": index})
        yield _sse("done", {})

    return StreamingResponse(
        reply_stream(), media_type="text/event-stream", headers=SSE_HEADERS
    )


@router.post("/sessions/{session_id}/end")
async def end_session(
    session_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Close the session. The completed transcript is M13's coaching input."""
    user = await _require_user(db, clerk_user_id)
    session = await _locked_session(db, session_id, user.id)

    if session.status == "completed":
        # Already closed — report the existing state rather than erroring.
        payload = _serialise(session)
        payload["turn_count"] = len(session.transcript or [])
        await db.rollback()
        return payload

    session.status = "completed"
    session.completed_at = datetime.now(tz=timezone.utc)
    await db.commit()
    await db.refresh(session)

    logger.info(
        "Ended roleplay session %s after %d turn(s)",
        session_id,
        len(session.transcript or []),
    )
    payload = _serialise(session)
    payload["turn_count"] = len(session.transcript or [])
    return payload


# --------------------------------------------------------------------------
# Coaching (M13)
# --------------------------------------------------------------------------

DIMENSIONS = (
    "product_knowledge",
    "communication",
    "objection_handling",
    "clinical_accuracy",
)


def _serialise_report(report: CoachingReport) -> dict[str, Any]:
    return {
        "id": str(report.id),
        "roleplay_session_id": str(report.roleplay_session_id),
        "overall_score": report.overall_score,
        "scores": {d: getattr(report, d) for d in DIMENSIONS},
        "narratives": report.narratives or {},
        "recommendations": report.recommendations or [],
        "sources": report.sources or [],
        "created_at": report.created_at.isoformat(),
    }


async def _existing_report(
    db: AsyncSession, session_id: uuid.UUID
) -> CoachingReport | None:
    return (
        await db.execute(
            select(CoachingReport).where(
                CoachingReport.roleplay_session_id == session_id
            )
        )
    ).scalar_one_or_none()


@router.post("/sessions/{session_id}/coaching")
async def create_coaching(
    session_id: uuid.UUID,
    regenerate: bool = Query(
        False, description="Discard any existing report and score again"
    ),
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Score a completed conversation.

    Returns the existing report unless ``regenerate=true`` — a second click
    should not silently spend another model call.
    """
    user = await _require_user(db, clerk_user_id)
    user_id = user.id

    session = (
        await db.execute(
            select(RoleplaySession).where(
                RoleplaySession.id == session_id,
                RoleplaySession.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )

    if session.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="End the session before asking for coaching",
        )

    existing = await _existing_report(db, session_id)
    if existing is not None and not regenerate:
        return _serialise_report(existing)

    product = session.product
    persona = describe_persona(
        session.persona_specialty, session.persona_personality
    )
    transcript = list(session.transcript or [])
    await db.rollback()  # release the connection across the model call

    try:
        result = await generate_report(
            db,
            user_id=user_id,
            product=product,
            persona_description=persona,
            transcript=transcript,
        )
    except NotCoachableError as exc:
        await db.rollback()
        logger.info("Refused coaching for %s: %s", session_id, exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except CoachingError as exc:
        await db.rollback()
        logger.warning("Coaching failed for %s: %s", session_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not produce the report: {exc}",
        ) from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("Unexpected coaching failure for %s", session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error while reviewing the conversation",
        ) from exc

    try:
        report = await _existing_report(db, session_id)
        if report is None:
            report = CoachingReport(roleplay_session_id=session_id)
            db.add(report)

        report.overall_score = result.report["overall_score"]
        for dimension in DIMENSIONS:
            setattr(report, dimension, result.report[dimension])
        report.recommendations = result.report["recommendations"]
        report.narratives = result.report["narratives"]
        report.sources = result.sources

        await db.commit()
        await db.refresh(report)
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to persist coaching report for %s", session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Report generated but could not be saved",
        ) from exc

    return _serialise_report(report)


@router.get("/sessions/{session_id}/coaching")
async def get_coaching(
    session_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    user = await _require_user(db, clerk_user_id)

    # Ownership goes through the session, so another user's report is missing.
    session = (
        await db.execute(
            select(RoleplaySession).where(
                RoleplaySession.id == session_id,
                RoleplaySession.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )

    report = await _existing_report(db, session_id)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No coaching report for this session yet",
        )

    return _serialise_report(report)
