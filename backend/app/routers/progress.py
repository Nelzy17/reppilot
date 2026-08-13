"""Progress tracking (M14).

Pure aggregation over what M11-M13 already produced — no model is called here.
Only sessions that actually have a coaching report are included: an uncoached
session has no scores, and padding the series with nulls would draw a trend line
through data that does not exist.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.clerk import get_current_user_id
from app.db.session import get_db
from app.models import CoachingReport, RoleplaySession, User
from app.services.personas import describe_persona

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/progress", tags=["progress"])

DIMENSIONS = (
    "product_knowledge",
    "communication",
    "objection_handling",
    "clinical_accuracy",
)


def _mean(values: list[int]) -> int | None:
    """Rounded mean, or None when there is nothing to average."""
    if not values:
        return None
    return round(sum(values) / len(values))


def _describe(specialty: str, personality: str) -> str:
    """Persona label, degrading to the raw keys if one is no longer catalogued.

    Sessions are only created through the roleplay endpoint, which validates
    both keys, so this should not fire. But a rep's history is permanent and the
    catalogue is not: retiring a persona must not make the whole page 500.
    """
    try:
        return describe_persona(specialty, personality)
    except KeyError:
        logger.warning(
            "Unknown persona keys on a stored session: %s/%s", specialty, personality
        )
        return f"{personality} {specialty}".replace("_", " ").capitalize()


@router.get("")
async def get_progress(
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Every coached session for the caller, oldest first, plus summary stats.

    Oldest first because the list is also the chart series — the client plots it
    straight through without re-sorting.
    """
    user = (
        await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No user record for this account yet; try again shortly",
        )

    # Inner join: a session without a report contributes no scores.
    rows = (
        await db.execute(
            select(RoleplaySession, CoachingReport)
            .join(
                CoachingReport,
                CoachingReport.roleplay_session_id == RoleplaySession.id,
            )
            .where(RoleplaySession.user_id == user.id)
            .order_by(RoleplaySession.created_at)
        )
    ).all()

    sessions: list[dict[str, Any]] = []
    for session, report in rows:
        sessions.append(
            {
                "session_id": str(session.id),
                "persona_specialty": session.persona_specialty,
                "persona_personality": session.persona_personality,
                "persona_description": _describe(
                    session.persona_specialty, session.persona_personality
                ),
                "product": session.product,
                "created_at": session.created_at.isoformat(),
                "coached_at": report.created_at.isoformat(),
                "overall_score": report.overall_score,
                **{d: getattr(report, d) for d in DIMENSIONS},
            }
        )

    summary = {
        "sessions_coached": len(sessions),
        "average_overall": _mean([s["overall_score"] for s in sessions]),
        "averages": {
            d: _mean([s[d] for s in sessions]) for d in DIMENSIONS
        },
        "first_session_at": sessions[0]["created_at"] if sessions else None,
        "latest_session_at": sessions[-1]["created_at"] if sessions else None,
    }

    logger.info(
        "Progress for user %s: %d coached session(s)", user.id, len(sessions)
    )
    return {"summary": summary, "sessions": sessions}
