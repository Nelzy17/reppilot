"""Clerk session-token verification.

The frontend being protected (M1) does not protect this service: FastAPI is
separately reachable, so every request's token is verified here independently —
signature and expiry — before anything is trusted.
"""

import logging

from clerk_backend_api.security.types import (
    TokenVerificationError,
    VerifyTokenOptions,
)
from clerk_backend_api.security.verifytoken import verify_token_async
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings

logger = logging.getLogger(__name__)

# auto_error=False so a missing/!Bearer header reaches our own handler and gets a
# 401 "Not authenticated"; HTTPBearer's built-in error is a 403.
bearer_scheme = HTTPBearer(auto_error=False)


def _unauthenticated() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    """Verify the bearer token and return the Clerk user id (``sub``).

    Raises 401 "Not authenticated" for a missing, malformed, expired, or
    badly-signed token — deliberately without saying which, so the endpoint
    can't be used to probe token validity.
    """
    if credentials is None or not credentials.credentials:
        raise _unauthenticated()

    settings = get_settings()
    jwt_key = settings.clerk_jwt_key

    if not jwt_key and not settings.CLERK_SECRET_KEY:
        # Misconfiguration, not a client error — don't disguise it as a 401.
        logger.error("Neither CLERK_JWT_KEY nor CLERK_SECRET_KEY is set")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Auth is not configured",
        )

    try:
        payload = await verify_token_async(
            credentials.credentials,
            VerifyTokenOptions(
                # jwt_key wins when set: verification stays networkless.
                jwt_key=jwt_key,
                secret_key=settings.CLERK_SECRET_KEY or None,
            ),
        )
    except TokenVerificationError as exc:
        logger.info("Token rejected: %s", exc.reason.value[0])
        raise _unauthenticated() from exc

    user_id = payload.get("sub")
    if not user_id:
        logger.info("Token verified but carried no sub claim")
        raise _unauthenticated()

    return user_id
