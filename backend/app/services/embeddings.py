"""OpenAI embedding generation.

Uses the official SDK directly (decision D-002: no LangChain). Embeddings only —
no chat or generation model is called from here.
"""

import logging
from functools import lru_cache

import openai
from openai import AsyncOpenAI

from app.config import get_settings
from app.services.chunking import count_tokens

logger = logging.getLogger(__name__)

# The embeddings endpoint takes an array, so many chunks cost one round trip
# instead of one each. Two ceilings apply: the API caps an array at 2048 inputs,
# and a single request at 300k tokens. Both limits are held well clear of.
MAX_BATCH_INPUTS = 96
MAX_BATCH_TOKENS = 200_000


class EmbeddingError(Exception):
    """Raised when embeddings cannot be generated."""


@lru_cache(maxsize=1)
def get_openai_client() -> AsyncOpenAI:
    settings = get_settings()
    if not settings.OPENAI_API_KEY:
        raise EmbeddingError("OPENAI_API_KEY is not configured")
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


def _batch(texts: list[str]) -> list[tuple[int, list[str]]]:
    """Group texts into (offset, batch) pairs within the input and token caps."""
    batches: list[tuple[int, list[str]]] = []
    current: list[str] = []
    current_tokens = 0
    offset = 0

    for text in texts:
        tokens = count_tokens(text)
        too_many = len(current) >= MAX_BATCH_INPUTS
        too_big = current and current_tokens + tokens > MAX_BATCH_TOKENS
        if too_many or too_big:
            batches.append((offset, current))
            offset += len(current)
            current = []
            current_tokens = 0
        current.append(text)
        current_tokens += tokens

    if current:
        batches.append((offset, current))
    return batches


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts, returning one vector per input **in the same order**.

    Raises EmbeddingError on any API failure, on a count mismatch, or on a
    vector whose dimension disagrees with the configured value — a silent
    mismatch there would poison the collection.
    """
    if not texts:
        raise EmbeddingError("No texts to embed")
    if any(not (t or "").strip() for t in texts):
        raise EmbeddingError("Refusing to embed an empty chunk")

    settings = get_settings()
    client = get_openai_client()
    vectors: list[list[float]] = [None] * len(texts)  # type: ignore[list-item]

    for offset, batch in _batch(texts):
        try:
            response = await client.embeddings.create(
                model=settings.EMBEDDING_MODEL,
                input=batch,
                # Pinned explicitly so swapping to a larger model still yields
                # vectors the existing collection can hold.
                dimensions=settings.EMBEDDING_DIMENSIONS,
            )
        except openai.APIError as exc:
            raise EmbeddingError(f"OpenAI embeddings request failed: {exc}") from exc
        except Exception as exc:  # network/timeout/etc
            raise EmbeddingError(f"Could not reach OpenAI: {exc}") from exc

        if len(response.data) != len(batch):
            raise EmbeddingError(
                f"OpenAI returned {len(response.data)} embeddings for "
                f"{len(batch)} inputs"
            )

        # The response carries an `index` per item; order is not guaranteed, so
        # place by index rather than trusting sequence.
        for item in response.data:
            position = offset + item.index
            if not 0 <= position < len(texts):
                raise EmbeddingError(f"OpenAI returned out-of-range index {item.index}")
            if len(item.embedding) != settings.EMBEDDING_DIMENSIONS:
                raise EmbeddingError(
                    f"Expected {settings.EMBEDDING_DIMENSIONS}-dim vectors, got "
                    f"{len(item.embedding)}"
                )
            vectors[position] = list(item.embedding)

    if any(v is None for v in vectors):
        raise EmbeddingError("OpenAI did not return an embedding for every input")

    logger.info(
        "Embedded %d chunk(s) with %s in %d request(s)",
        len(texts),
        settings.EMBEDDING_MODEL,
        len(_batch(texts)),
    )
    return vectors
