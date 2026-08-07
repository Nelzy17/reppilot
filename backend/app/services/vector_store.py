"""Qdrant vector store.

Official qdrant-client, used directly (decision D-002: no LangChain).

Payloads stay lean on purpose: only what M8 needs to filter by user and join
back to Postgres. The chunk text itself lives in ``document_chunks.content`` and
is deliberately not duplicated here.
"""

import logging
import uuid
from functools import lru_cache
from typing import Any

from qdrant_client import AsyncQdrantClient, models

from app.config import get_settings

logger = logging.getLogger(__name__)

# Fixed namespace so a point id is a pure function of (document_id, chunk_index).
# Re-embedding therefore overwrites the same points instead of creating new ones.
POINT_ID_NAMESPACE = uuid.UUID("1b4e28ba-2fa1-11d2-883f-0016d3cca427")


class VectorStoreError(Exception):
    """Raised when Qdrant cannot be reached or updated."""


def point_id_for(document_id: uuid.UUID | str, chunk_index: int) -> uuid.UUID:
    """Deterministic point id — stable across re-runs."""
    return uuid.uuid5(POINT_ID_NAMESPACE, f"{document_id}:{chunk_index}")


@lru_cache(maxsize=1)
def get_qdrant_client() -> AsyncQdrantClient:
    settings = get_settings()
    if not settings.QDRANT_URL:
        raise VectorStoreError("QDRANT_URL is not configured")
    return AsyncQdrantClient(
        url=settings.QDRANT_URL,
        api_key=settings.QDRANT_API_KEY or None,
        timeout=60,
    )


# Qdrant refuses to filter on an un-indexed payload field, so every field used
# in any filter must appear here. Keep in step with the filters below and with
# M8's search:
#   document_id + chunk_index -> delete_stale_points / count_document_points
#   user_id                   -> M8 per-user search filtering
PAYLOAD_INDEXES: dict[str, models.PayloadSchemaType] = {
    "document_id": models.PayloadSchemaType.KEYWORD,
    "user_id": models.PayloadSchemaType.KEYWORD,
    "chunk_index": models.PayloadSchemaType.INTEGER,
}


async def ensure_collection(client: AsyncQdrantClient | None = None) -> None:
    """Create the collection and its payload indexes if absent.

    Idempotent: existing indexes are detected and skipped, so repeat calls are
    cheap and do not error.
    """
    settings = get_settings()
    client = client or get_qdrant_client()
    name = settings.QDRANT_COLLECTION

    try:
        if not await client.collection_exists(name):
            await client.create_collection(
                collection_name=name,
                vectors_config=models.VectorParams(
                    size=settings.EMBEDDING_DIMENSIONS,
                    distance=models.Distance.COSINE,
                ),
            )
            logger.info(
                "Created Qdrant collection %s (%d dims, cosine)",
                name,
                settings.EMBEDDING_DIMENSIONS,
            )

        existing = (await client.get_collection(name)).payload_schema or {}

        for field, schema in PAYLOAD_INDEXES.items():
            if field in existing:
                continue
            try:
                # wait=True: an index that is still building cannot be filtered
                # on, and the very next call here is a delete-by-filter.
                await client.create_payload_index(
                    collection_name=name,
                    field_name=field,
                    field_schema=schema,
                    wait=True,
                )
                logger.info("Created payload index on %s (%s)", field, schema)
            except Exception as exc:
                # Tolerate a concurrent creator having won the race, but only
                # after confirming the index really is there — never swallow a
                # genuine failure, which is what hid this bug originally.
                recheck = (await client.get_collection(name)).payload_schema or {}
                if field not in recheck:
                    raise VectorStoreError(
                        f"Could not create payload index on {field}: {exc}"
                    ) from exc
                logger.debug("Payload index on %s already present", field)
    except VectorStoreError:
        raise
    except Exception as exc:
        raise VectorStoreError(f"Could not prepare Qdrant collection: {exc}") from exc


async def upsert_chunk_points(
    points: list[dict[str, Any]],
    client: AsyncQdrantClient | None = None,
) -> None:
    """Upsert points. Each dict is ``{id, vector, payload}``.

    Upsert (not insert) is what makes re-embedding idempotent: a repeat run
    writes the same deterministic ids and replaces the vectors in place.
    """
    if not points:
        return

    settings = get_settings()
    client = client or get_qdrant_client()

    try:
        await client.upsert(
            collection_name=settings.QDRANT_COLLECTION,
            points=[
                models.PointStruct(
                    id=str(p["id"]),
                    vector=p["vector"],
                    payload=p["payload"],
                )
                for p in points
            ],
            wait=True,  # don't report success before Qdrant has applied it
        )
    except Exception as exc:
        raise VectorStoreError(f"Qdrant upsert failed: {exc}") from exc


async def delete_stale_points(
    document_id: uuid.UUID | str,
    keep_below_index: int,
    client: AsyncQdrantClient | None = None,
) -> None:
    """Drop this document's points at chunk_index >= ``keep_below_index``.

    Covers the case where reprocessing produced *fewer* chunks than before:
    without it the surplus points would linger and surface in M8 search as
    content the document no longer has.
    """
    settings = get_settings()
    client = client or get_qdrant_client()

    try:
        await client.delete(
            collection_name=settings.QDRANT_COLLECTION,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="document_id",
                            match=models.MatchValue(value=str(document_id)),
                        ),
                        models.FieldCondition(
                            key="chunk_index",
                            range=models.Range(gte=keep_below_index),
                        ),
                    ]
                )
            ),
            wait=True,
        )
    except Exception as exc:
        raise VectorStoreError(f"Qdrant cleanup failed: {exc}") from exc


async def count_document_points(
    document_id: uuid.UUID | str,
    client: AsyncQdrantClient | None = None,
) -> int:
    """How many points this document currently has. Used to verify a run."""
    settings = get_settings()
    client = client or get_qdrant_client()

    try:
        result = await client.count(
            collection_name=settings.QDRANT_COLLECTION,
            count_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="document_id",
                        match=models.MatchValue(value=str(document_id)),
                    )
                ]
            ),
            exact=True,
        )
        return result.count
    except Exception as exc:
        raise VectorStoreError(f"Qdrant count failed: {exc}") from exc
