from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.clerk import get_current_user_id
from app.db.session import get_db
from app.models import User

router = APIRouter(tags=["me"])


@router.get("/me")
async def read_me(
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return the caller's profile.

    Two shapes, because the DB sync is M4 (the Clerk webhook) and until then a
    freshly signed-up user has a valid token but no row yet:

      * row found     -> {id, clerk_user_id, email, full_name, role}
      * no row yet    -> {clerk_user_id, synced: false}

    A verified token with no row is not an error — the token is still proof of
    identity. Callers can discriminate on the ``synced`` key.
    """
    user = (
        await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    ).scalar_one_or_none()

    if user is None:
        return {"clerk_user_id": clerk_user_id, "synced": False}

    return {
        "id": str(user.id),
        "clerk_user_id": user.clerk_user_id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
    }
