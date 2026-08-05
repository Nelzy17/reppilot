"""PDF upload.

Flow is browser -> FastAPI -> Vercel Blob (decision D-003 / Option A). The file
passes through this service: the frontend never talks to Blob directly, which
keeps the UI-only contract and leaves the bytes here for M6 to parse.
"""

import logging
import re
import uuid
from typing import Any

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.clerk import get_current_user_id
from app.config import get_settings
from app.db.session import get_db
from app.models import Document, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB
CHUNK_BYTES = 1 * 1024 * 1024
PDF_CONTENT_TYPES = {"application/pdf", "application/x-pdf"}
PDF_MAGIC = b"%PDF-"

_UNSAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")

BLOB_API_BASE = "https://blob.vercel-storage.com"
BLOB_API_VERSION = "12"
# The wrapper defaulted to 10s, which a 25 MB upload can easily exceed.
BLOB_UPLOAD_TIMEOUT_SECONDS = 60.0


async def _put_blob_private(path: str, data: bytes, token: str) -> dict[str, Any]:
    """Upload to Vercel Blob with private access.

    Not using vercel_blob.put(): that wrapper (0.4.2, the latest release) sends
    a hardcoded ``access: public`` header — and that header name is itself
    obsolete. The current API expects ``x-vercel-blob-access``, so against a
    private store the wrapper always fails with "Cannot use public access on a
    private store". There is no options key to override it.

    Everything else mirrors the wrapper's request shape: pathname as a query
    parameter, body as raw bytes.
    """
    async with httpx.AsyncClient(timeout=BLOB_UPLOAD_TIMEOUT_SECONDS) as client:
        resp = await client.put(
            f"{BLOB_API_BASE}/",
            params={"pathname": path},
            content=data,
            headers={
                "authorization": f"Bearer {token}",
                "x-api-version": BLOB_API_VERSION,
                "x-vercel-blob-access": "private",
                "x-content-type": "application/pdf",
                "x-add-random-suffix": "1",
                "x-cache-control-max-age": "31536000",
            },
        )

    if resp.status_code != 200:
        # Surfaced as a 502 by the caller.
        raise RuntimeError(
            f"Vercel Blob returned {resp.status_code}: {resp.text[:300]}"
        )

    return resp.json()


def _safe_filename(raw: str | None) -> str:
    """Reduce a client-supplied filename to something safe for a blob path."""
    name = (raw or "").strip().replace("\\", "/").split("/")[-1]
    name = _UNSAFE_FILENAME_CHARS.sub("_", name).lstrip(".")
    if not name.lower().endswith(".pdf"):
        name = f"{name or 'upload'}.pdf"
    # Vercel caps pathname length; leave room for the prefix and random suffix.
    return name[-120:]


async def _read_capped(upload: UploadFile) -> bytes:
    """Read the upload, refusing anything over the cap.

    Read incrementally rather than trusting Content-Length, which a client
    controls and can understate.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    settings = get_settings()

    if not settings.BLOB_READ_WRITE_TOKEN:
        logger.error("BLOB_READ_WRITE_TOKEN is not set; cannot accept uploads")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Blob storage is not configured",
        )

    filename = _safe_filename(file.filename)

    # Content-type and extension are both client-supplied, so check them and
    # then confirm against the file's actual magic bytes below.
    declared = (file.content_type or "").split(";")[0].strip().lower()
    if declared and declared not in PDF_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF uploads are accepted",
        )

    data = await _read_capped(file)

    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty"
        )

    if not data.startswith(PDF_MAGIC):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF uploads are accepted",
        )

    # Map the verified Clerk identity to our own user row. A token can be valid
    # while the M4 webhook has not yet created the row.
    user = (
        await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No user record for this account yet; try again shortly",
        )

    # Namespaced by user, plus a random suffix from Blob, so one tenant cannot
    # guess another's object URLs.
    blob_path = f"documents/{user.id}/{uuid.uuid4().hex}-{filename}"

    try:
        result = await _put_blob_private(
            blob_path, data, settings.BLOB_READ_WRITE_TOKEN
        )
    except Exception as exc:
        # The wrapper retries internally; reaching here means it gave up.
        # Deliberately no DB row: a documents row must never point at a blob
        # that does not exist.
        logger.exception("Vercel Blob upload failed for %s", blob_path)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to store the file in blob storage",
        ) from exc

    storage_url = result.get("url") or result.get("downloadUrl")
    if not storage_url:
        logger.error("Blob upload returned no URL: %r", result)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Blob storage returned no URL for the uploaded file",
        )

    document = Document(
        user_id=user.id,
        filename=filename,
        storage_url=storage_url,
        status="processing",
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)

    logger.info("Stored document %s for user %s", document.id, user.id)

    return {
        "id": str(document.id),
        "filename": document.filename,
        "status": document.status,
    }
