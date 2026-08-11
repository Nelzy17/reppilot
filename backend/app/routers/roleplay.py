"""Roleplay session setup (M11).

Creates a practice session and exposes the persona catalogue. The conversation
loop is M12 and scoring is M13 — nothing here calls the model.
"""

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.clerk import get_current_user_id
from app.db.session import get_db
from app.models import RoleplaySession, User
from app.services.personas import (
    PERSONALITIES,
    SPECIALTIES,
    build_persona_system_prompt,
    describe_persona,
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
