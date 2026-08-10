"""Vector search over a user's own document chunks.

Retrieval only — no chat or generation model is called here. The caller (M9)
composes an answer from what this returns, and an empty list is its signal to
take the "I don't know" path rather than invent an answer.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.clerk import get_current_user_id
from app.db.session import get_db
from app.models import Document, DocumentChunk, User
from app.services.embeddings import EmbeddingError, embed_texts
from app.services.vector_store import VectorStoreError, search_chunks

logger = logging.getLogger(__name__)

router = APIRouter(tags=["search"])

DEFAULT_K = 5
MAX_K = 20


class SearchRequest(BaseModel):
    query: str = Field(..., description="Natural-language query to search for")
    k: int = Field(DEFAULT_K, description=f"How many chunks to return (max {MAX_K})")
    min_score: float | None = Field(
        None,
        description=(
            "Optional cosine-similarity floor. Omitted by default so callers "
            "see the scores and decide for themselves."
        ),
    )


@router.post("/search")
async def search(
    payload: SearchRequest,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Embed the query, find this user's nearest chunks, return them with text.

    Results are ordered by similarity descending. An empty list means nothing
    matched — a normal outcome, returned as 200.
    """
    query = (payload.query or "").strip()
    if not query:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Query must not be empty",
        )

    if payload.k < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="k must be at least 1",
        )
    # Clamp rather than reject: an over-large k is a caller convenience issue,
    # not a reason to fail their search.
    k = min(payload.k, MAX_K)
    if payload.k > MAX_K:
        logger.info("Clamped requested k=%d to %d", payload.k, k)

    user = (
        await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No user record for this account yet; try again shortly",
        )

    try:
        query_vector = (await embed_texts([query]))[0]
    except EmbeddingError as exc:
        logger.warning("Query embedding failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not embed the query: {exc}",
        ) from exc

    try:
        hits = await search_chunks(
            query_vector=query_vector,
            user_id=user.id,
            limit=k,
            score_threshold=payload.min_score,
        )
    except VectorStoreError as exc:
        logger.warning("Vector search failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Vector search failed: {exc}",
        ) from exc

    if not hits:
        return []

    # Fetch the text from Postgres. Joined to documents and re-scoped to this
    # user: Qdrant already filtered, but the authoritative ownership check
    # belongs with the authoritative data.
    point_ids = [hit["point_id"] for hit in hits]
    rows = (
        (
            await db.execute(
                select(DocumentChunk)
                .join(Document, Document.id == DocumentChunk.document_id)
                .where(
                    DocumentChunk.qdrant_point_id.in_(point_ids),
                    Document.user_id == user.id,
                )
            )
        )
        .scalars()
        .all()
    )
    by_point_id = {str(row.qdrant_point_id): row for row in rows}

    results: list[dict[str, Any]] = []
    for hit in hits:
        chunk = by_point_id.get(hit["point_id"])
        if chunk is None:
            # A vector with no surviving row — e.g. chunks deleted without the
            # points being cleaned up. Skip it rather than return a hit with no
            # text; M9 must never be handed an empty passage.
            logger.warning(
                "Qdrant point %s has no matching chunk row; skipping",
                hit["point_id"],
            )
            continue
        results.append(
            {
                "chunk_id": str(chunk.id),
                "document_id": str(chunk.document_id),
                "chunk_index": chunk.chunk_index,
                "content": chunk.content,
                "score": hit["score"],
            }
        )

    logger.info(
        "Search for user %s returned %d/%d hit(s)", user.id, len(results), len(hits)
    )
    return results
