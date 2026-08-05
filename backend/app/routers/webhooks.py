"""Clerk webhook receiver.

This endpoint is publicly reachable — anyone on the internet can POST to it. It
is authenticated solely by the Svix HMAC signature over the raw request body, so
nothing touches the database until that signature verifies. There is deliberately
no Clerk JWT dependency here: the caller is Clerk's server, not a signed-in user.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from svix.webhooks import Webhook, WebhookVerificationError

from app.config import get_settings
from app.db.session import get_db
from app.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

USER_UPSERT_EVENTS = {"user.created", "user.updated"}
USER_DELETE_EVENT = "user.deleted"


def _primary_email(data: dict[str, Any]) -> str | None:
    """Clerk sends every address; the primary one is named by id."""
    addresses = data.get("email_addresses") or []
    primary_id = data.get("primary_email_address_id")

    for entry in addresses:
        if primary_id and entry.get("id") == primary_id:
            return entry.get("email_address")

    # No primary flagged (or it points at nothing) — fall back to the first.
    for entry in addresses:
        if entry.get("email_address"):
            return entry.get("email_address")

    return None


def _full_name(data: dict[str, Any]) -> str | None:
    parts = [data.get("first_name"), data.get("last_name")]
    joined = " ".join(part for part in parts if part).strip()
    return joined or None


@router.post("/clerk")
async def clerk_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    settings = get_settings()

    if not settings.CLERK_WEBHOOK_SECRET:
        # Misconfiguration, not a bad caller — don't disguise it as a 400.
        logger.error("CLERK_WEBHOOK_SECRET is not set; refusing to accept webhooks")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Webhook is not configured",
        )

    # The signature covers the exact bytes Clerk sent. Re-serializing parsed JSON
    # would change them (key order, whitespace) and break verification, so the
    # raw body is what gets verified.
    body = await request.body()

    try:
        event: dict[str, Any] = Webhook(settings.CLERK_WEBHOOK_SECRET).verify(
            body, dict(request.headers)
        )
    except WebhookVerificationError as exc:
        # Missing/!parseable headers, timestamp outside the 5-minute window, or
        # no matching signature.
        logger.warning("Webhook signature rejected: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid webhook signature",
        ) from exc
    except Exception as exc:
        # A malformed svix-signature header can raise ValueError/binascii.Error
        # out of the parser before it ever reaches a signature comparison. Any
        # failure to verify is a rejection.
        logger.warning("Webhook verification failed: %r", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid webhook signature",
        ) from exc

    # --- past this line the payload is authenticated -------------------------

    event_type = event.get("type")
    data = event.get("data") or {}
    clerk_user_id = data.get("id")

    if not clerk_user_id:
        logger.warning("Verified %s event carried no data.id; ignoring", event_type)
        return {"received": True}

    if event_type in USER_UPSERT_EVENTS:
        email = _primary_email(data)
        if not email:
            # users.email is NOT NULL and inventing a value would be worse than
            # skipping. Ack anyway: retrying will not add an email to the payload.
            logger.warning(
                "Skipping %s for %s: no email address in payload",
                event_type,
                clerk_user_id,
            )
            return {"received": True}

        full_name = _full_name(data)

        # ON CONFLICT against the unique index on clerk_user_id. role, id and
        # created_at are omitted so their column defaults stand on insert and
        # are left untouched on update.
        stmt = (
            pg_insert(User)
            .values(clerk_user_id=clerk_user_id, email=email, full_name=full_name)
            .on_conflict_do_update(
                index_elements=[User.clerk_user_id],
                set_={"email": email, "full_name": full_name},
            )
        )
        await db.execute(stmt)
        await db.commit()
        logger.info("Synced %s for %s", event_type, clerk_user_id)

    elif event_type == USER_DELETE_EVENT:
        await db.execute(delete(User).where(User.clerk_user_id == clerk_user_id))
        await db.commit()
        logger.info("Deleted user row for %s", clerk_user_id)

    else:
        logger.debug("Ignoring unhandled Clerk event type %s", event_type)

    return {"received": True}
