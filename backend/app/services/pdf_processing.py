"""Fetch a stored PDF and extract its text as markdown.

Markdown rather than raw text because pymupdf4llm preserves headings, lists and
tables, and that structure is what the chunker splits on.
"""

import logging

import httpx
import pymupdf
import pymupdf4llm
from fastapi.concurrency import run_in_threadpool

from app.config import get_settings

logger = logging.getLogger(__name__)

BLOB_FETCH_TIMEOUT_SECONDS = 60.0


class PdfProcessingError(Exception):
    """Raised when the PDF cannot be fetched or parsed."""


async def fetch_blob_bytes(storage_url: str, token: str) -> bytes:
    """Download a blob from the private store.

    The store is private (M5), so an anonymous GET returns 403 — the read has to
    carry the same R/W token the upload used.
    """
    try:
        async with httpx.AsyncClient(timeout=BLOB_FETCH_TIMEOUT_SECONDS) as client:
            resp = await client.get(
                storage_url, headers={"authorization": f"Bearer {token}"}
            )
    except httpx.HTTPError as exc:
        raise PdfProcessingError(f"Could not reach blob storage: {exc}") from exc

    if resp.status_code != 200:
        raise PdfProcessingError(
            f"Blob storage returned {resp.status_code} for the stored file"
        )

    return resp.content


def _extract_sync(pdf_bytes: bytes) -> tuple[str, int]:
    """Blocking parse. Runs in a worker thread — pymupdf is CPU-bound."""
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise PdfProcessingError(f"File is not a readable PDF: {exc}") from exc

    try:
        page_count = doc.page_count
        markdown = pymupdf4llm.to_markdown(doc)
    except Exception as exc:
        raise PdfProcessingError(f"Failed to extract text from PDF: {exc}") from exc
    finally:
        doc.close()

    return markdown or "", page_count


async def extract_document_markdown(document, token: str | None = None) -> tuple[str, int]:
    """Given a ``documents`` row, return ``(markdown_text, page_count)``.

    Note this can succeed while returning empty text: an image-only scan yields
    no extractable characters and pymupdf4llm does not warn about it. Callers
    must check the text before trusting it.
    """
    settings = get_settings()
    blob_token = token if token is not None else settings.BLOB_READ_WRITE_TOKEN
    if not blob_token:
        raise PdfProcessingError("Blob storage is not configured")

    pdf_bytes = await fetch_blob_bytes(document.storage_url, blob_token)
    if not pdf_bytes:
        raise PdfProcessingError("Stored file is empty")

    try:
        markdown, page_count = await run_in_threadpool(_extract_sync, pdf_bytes)
    finally:
        # Up to 25 MB. pymupdf holds the stream until doc.close(), which
        # _extract_sync has already done, so nothing references it after this.
        # Dropping it here keeps the raw bytes and the extracted markdown from
        # being resident at the same time (M15: 512 MB instance).
        del pdf_bytes

    logger.info(
        "Extracted %d chars of markdown from %d page(s) for document %s",
        len(markdown),
        page_count,
        getattr(document, "id", "?"),
    )
    return markdown, page_count
