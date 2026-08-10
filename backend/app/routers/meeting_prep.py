"""Meeting Prep endpoints.

A brief is persisted only after it has been generated successfully, so a failed
run leaves nothing behind for a rep to mistake for real preparation.
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
from app.models import MeetingPrep, User
from app.services.meeting_prep import (
    MeetingPrepError,
    NoCoverageError,
    generate_brief,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meeting-prep", tags=["meeting-prep"])


class MeetingPrepRequest(BaseModel):
    physician_name: str | None = Field(None, description="Who the meeting is with")
    specialty: str | None = Field(None, description="Their clinical specialty")
    product: str = Field(..., description="The product the meeting is about")
    objective: str = Field(..., description="What the rep wants to achieve")


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


def _serialise(prep: MeetingPrep) -> dict[str, Any]:
    stored = prep.output or {}
    return {
        "id": str(prep.id),
        "physician_name": prep.physician_name,
        "specialty": prep.specialty,
        "product": prep.product,
        "objective": prep.objective,
        "brief": stored.get("brief", {}),
        "sources": stored.get("sources", []),
        "created_at": prep.created_at.isoformat(),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_meeting_prep(
    payload: MeetingPrepRequest,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    product = (payload.product or "").strip()
    objective = (payload.objective or "").strip()

    if not product:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Product is required"
        )
    if not objective:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Meeting objective is required",
        )

    physician_name = (payload.physician_name or "").strip() or None
    specialty = (payload.specialty or "").strip() or None

    user = await _require_user(db, clerk_user_id)
    user_id = user.id

    try:
        result = await generate_brief(
            db,
            user_id=user_id,
            physician_name=physician_name,
            specialty=specialty,
            product=product,
            objective=objective,
        )
    except NoCoverageError as exc:
        # Not an error in the system — the documents genuinely cannot support a
        # brief. 422 so the client can present it as a coverage gap, not a fault.
        await db.rollback()
        logger.info("Meeting prep refused for %r: no coverage", product)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except MeetingPrepError as exc:
        await db.rollback()
        logger.warning("Meeting prep failed for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not generate the brief: {exc}",
        ) from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("Unexpected meeting prep failure for user %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error while generating the brief",
        ) from exc

    try:
        prep = MeetingPrep(
            user_id=user_id,
            physician_name=physician_name,
            specialty=specialty,
            product=product,
            objective=objective,
            output={"brief": result.brief, "sources": result.sources},
        )
        db.add(prep)
        await db.commit()
        await db.refresh(prep)
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to persist meeting prep for user %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Brief generated but could not be saved",
        ) from exc

    return _serialise(prep)


@router.get("")
async def list_meeting_preps(
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """The caller's saved briefs, newest first."""
    user = await _require_user(db, clerk_user_id)

    preps = (
        (
            await db.execute(
                select(MeetingPrep)
                .where(MeetingPrep.user_id == user.id)
                .order_by(MeetingPrep.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    # Summary only: the full brief is fetched per-item.
    return [
        {
            "id": str(p.id),
            "physician_name": p.physician_name,
            "specialty": p.specialty,
            "product": p.product,
            "objective": p.objective,
            "created_at": p.created_at.isoformat(),
        }
        for p in preps
    ]


@router.get("/{prep_id}")
async def get_meeting_prep(
    prep_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    user = await _require_user(db, clerk_user_id)

    # Ownership is part of the lookup: another user's brief reads as missing.
    prep = (
        await db.execute(
            select(MeetingPrep).where(
                MeetingPrep.id == prep_id, MeetingPrep.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if prep is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Brief not found"
        )

    return _serialise(prep)
