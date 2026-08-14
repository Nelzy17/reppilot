"""PDF upload and processing.

Upload flow is browser -> FastAPI -> Vercel Blob (decision D-003 / Option A).
The file passes through this service: the frontend never talks to Blob
directly, which keeps the UI-only contract and leaves the bytes here to parse.
"""

import logging
import re
import uuid
from typing import Any

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.clerk import get_current_user_id
from app.config import get_settings
from app.db.session import AsyncSessionLocal, get_db
from app.models import Document, DocumentChunk, User
from app.services.chunking import chunk_markdown, has_meaningful_text
from app.services.embeddings import EmbeddingError, embed_texts
from app.services.pdf_processing import (
    PdfProcessingError,
    extract_document_markdown,
)
from app.services.vector_store import (
    VectorStoreError,
    count_document_points,
    delete_stale_points,
    ensure_collection,
    point_id_for,
    upsert_chunk_points,
)

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


@router.get("")
async def list_documents(
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """The requesting user's documents, newest first.

    Scoped to the caller by user_id — there is no way to ask for someone else's.
    """
    user = await _require_user(db, clerk_user_id)

    rows = (
        (
            await db.execute(
                select(Document)
                .where(Document.user_id == user.id)
                .order_by(Document.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    return [
        {
            "id": str(doc.id),
            "filename": doc.filename,
            "status": doc.status,
            "page_count": doc.page_count,
            "created_at": doc.created_at.isoformat(),
        }
        for doc in rows
    ]


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


async def _ingest_in_background(document_id: uuid.UUID, clerk_user_id: str) -> None:
    """Run process -> embed for a freshly uploaded document, out of band (M15).

    Replaces the M6/M7 dev buttons: an upload now carries itself all the way to
    'ready' with no manual step. Both stages are the same endpoint functions the
    routes expose, called directly, so there is one implementation and the
    endpoints remain available for a retry.

    A stage that fails has already flipped the row to 'failed' via _mark_failed;
    this swallows the exception because nothing is listening — the response went
    out long ago. The document's status is the channel that reports the outcome.

    Each stage gets its own session: they commit independently, and a rollback
    in one must not discard the other's work.
    """
    for stage, run in (("process", process_document), ("embed", embed_document)):
        try:
            async with AsyncSessionLocal() as db:
                await run(
                    document_id=document_id, clerk_user_id=clerk_user_id, db=db
                )
        except HTTPException as exc:
            logger.warning(
                "Auto-%s failed for document %s: %s", stage, document_id, exc.detail
            )
            return
        except Exception:
            logger.exception(
                "Unexpected auto-%s error for document %s", stage, document_id
            )
            return

    logger.info("Auto-ingest complete for document %s", document_id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_document(
    background_tasks: BackgroundTasks,
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

    # Runs after this response is sent, so the client is not held for the parse
    # and the embedding round-trip. The row is already committed, so the task
    # can find it.
    background_tasks.add_task(_ingest_in_background, document.id, clerk_user_id)

    return {
        "id": str(document.id),
        "filename": document.filename,
        "status": document.status,
    }


# --------------------------------------------------------------------------
# Processing (M6): extract text -> chunk -> populate document_chunks
# --------------------------------------------------------------------------

# An image-only scan extracts to page separators and whitespace. Require some
# real content before believing the extraction succeeded.
MIN_EXTRACTED_CHARS = 50


async def _mark_failed(db: AsyncSession, document_id: uuid.UUID) -> None:
    """Flip the document to 'failed' in its own transaction.

    Called after the work transaction has been rolled back, so the status
    update survives; a document must never be left stuck on 'processing'.
    """
    try:
        await db.rollback()
        await db.execute(
            update(Document).where(Document.id == document_id).values(status="failed")
        )
        await db.commit()
    except Exception:  # pragma: no cover - best effort
        logger.exception("Could not mark document %s as failed", document_id)


@router.post("/{document_id}/process")
async def process_document(
    document_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Extract, chunk, and store chunks for a previously uploaded PDF.

    Re-running replaces the document's chunks rather than appending, so a retry
    after a failure is safe.
    """
    user = (
        await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No user record for this account yet; try again shortly",
        )

    # Ownership is part of the lookup: another user's document is reported as
    # missing rather than forbidden, so the endpoint can't confirm it exists.
    # FOR UPDATE serialises concurrent processing of the same document, which
    # is what stops a double-submit from producing two sets of chunks.
    document = (
        await db.execute(
            select(Document)
            .where(Document.id == document_id, Document.user_id == user.id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )

    try:
        markdown, page_count = await extract_document_markdown(document)
    except PdfProcessingError as exc:
        logger.warning("Extraction failed for document %s: %s", document_id, exc)
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not process the PDF: {exc}",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected extraction error for document %s", document_id)
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error while processing the PDF",
        ) from exc

    stripped = (markdown or "").strip()
    if (
        len(stripped) < MIN_EXTRACTED_CHARS
        or not has_meaningful_text(stripped)
    ):
        logger.warning(
            "Document %s extracted only %d chars; treating as no text",
            document_id,
            len(stripped),
        )
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "No selectable text found in this PDF. It is most likely a "
                "scanned or image-only document, which needs OCR before it can "
                "be processed."
            ),
        )

    try:
        chunks = chunk_markdown(stripped)
    except Exception as exc:
        logger.exception("Chunking failed for document %s", document_id)
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error while splitting the document into chunks",
        ) from exc

    if not chunks:
        logger.warning("Chunking produced no chunks for document %s", document_id)
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Extracted text could not be split into any usable chunks",
        )

    try:
        # Replace, don't append: reprocessing must not duplicate chunks.
        await db.execute(
            delete(DocumentChunk).where(DocumentChunk.document_id == document.id)
        )
        db.add_all(
            [
                DocumentChunk(
                    document_id=document.id,
                    chunk_index=chunk["chunk_index"],
                    content=chunk["content"],
                    token_count=chunk["token_count"],
                )
                for chunk in chunks
            ]
        )
        document.page_count = page_count
        # Not 'ready': chunks exist but nothing is searchable until the vectors
        # are in Qdrant. Since M15 auto-runs embedding straight after, 'ready'
        # is reserved for the end of that pipeline so the badge never claims a
        # document is usable while it still has no vectors.
        document.status = "embedding"
        await db.commit()
    except Exception as exc:
        logger.exception("Failed to persist chunks for document %s", document_id)
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save the document chunks",
        ) from exc

    total_tokens = sum(chunk["token_count"] for chunk in chunks)
    logger.info(
        "Processed document %s: %d page(s), %d chunk(s), %d tokens",
        document_id,
        page_count,
        len(chunks),
        total_tokens,
    )

    return {
        "id": str(document.id),
        "status": document.status,
        "page_count": page_count,
        "chunk_count": len(chunks),
        "total_tokens": total_tokens,
    }


# --------------------------------------------------------------------------
# Embedding (M7): chunks -> OpenAI vectors -> Qdrant -> qdrant_point_id
# --------------------------------------------------------------------------


@router.post("/{document_id}/embed")
async def embed_document(
    document_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Embed a processed document's chunks and store the vectors in Qdrant.

    Re-runnable: point ids are derived from (document_id, chunk_index), so a
    second run overwrites the same points rather than duplicating them.
    """
    user = await _require_user(db, clerk_user_id)

    document = (
        await db.execute(
            select(Document)
            .where(Document.id == document_id, Document.user_id == user.id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )

    chunks = (
        (
            await db.execute(
                select(DocumentChunk)
                .where(DocumentChunk.document_id == document.id)
                .order_by(DocumentChunk.chunk_index)
            )
        )
        .scalars()
        .all()
    )

    # Refuse before spending anything at OpenAI. Status is left alone: an
    # unchunked document has not failed at embedding, it simply is not ready
    # for it.
    if not chunks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document has no chunks; run /process first",
        )

    try:
        vectors = await embed_texts([chunk.content for chunk in chunks])
    except EmbeddingError as exc:
        logger.warning("Embedding failed for document %s: %s", document_id, exc)
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not generate embeddings: {exc}",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected embedding error for document %s", document_id)
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error while generating embeddings",
        ) from exc

    # Belt and braces: embed_texts already checks this, but a mismatch here
    # would silently pair vectors with the wrong chunks.
    if len(vectors) != len(chunks):
        logger.error(
            "Embedding count mismatch for %s: %d vectors for %d chunks",
            document_id,
            len(vectors),
            len(chunks),
        )
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"Embedding count mismatch: got {len(vectors)} vectors for "
                f"{len(chunks)} chunks"
            ),
        )

    points = [
        {
            "id": point_id_for(document.id, chunk.chunk_index),
            "vector": vector,
            "payload": {
                "document_id": str(document.id),
                "chunk_index": chunk.chunk_index,
                "user_id": str(user.id),
            },
        }
        for chunk, vector in zip(chunks, vectors)
    ]

    try:
        await ensure_collection()
        await upsert_chunk_points(points)
        # If a previous run produced more chunks than this one, drop the surplus.
        await delete_stale_points(document.id, keep_below_index=len(chunks))
        stored = await count_document_points(document.id)
    except VectorStoreError as exc:
        logger.warning("Qdrant write failed for document %s: %s", document_id, exc)
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not store vectors: {exc}",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected vector store error for document %s", document_id)
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error while storing vectors",
        ) from exc

    if stored != len(chunks):
        logger.error(
            "Qdrant holds %d points for document %s but there are %d chunks",
            stored,
            document_id,
            len(chunks),
        )
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"Vector store holds {stored} points for {len(chunks)} chunks; "
                "refusing to mark the document ready"
            ),
        )

    try:
        for chunk, point in zip(chunks, points):
            chunk.qdrant_point_id = point["id"]
        await db.flush()

        # Never mark ready on a partially-linked document.
        unlinked = (
            await db.execute(
                select(func.count())
                .select_from(DocumentChunk)
                .where(
                    DocumentChunk.document_id == document.id,
                    DocumentChunk.qdrant_point_id.is_(None),
                )
            )
        ).scalar_one()
        if unlinked:
            raise RuntimeError(f"{unlinked} chunk(s) still have no point id")

        document.status = "ready"
        await db.commit()
    except Exception as exc:
        logger.exception("Failed to link point ids for document %s", document_id)
        await _mark_failed(db, document_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record vector ids against the chunks",
        ) from exc

    settings = get_settings()
    logger.info(
        "Embedded document %s: %d chunk(s) -> %s",
        document_id,
        len(chunks),
        settings.QDRANT_COLLECTION,
    )

    return {
        "id": str(document.id),
        "status": document.status,
        "chunk_count": len(chunks),
        "embedded_count": len(vectors),
        "points_in_collection": stored,
        "model": settings.EMBEDDING_MODEL,
        "dimensions": settings.EMBEDDING_DIMENSIONS,
        "collection": settings.QDRANT_COLLECTION,
    }
