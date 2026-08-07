"""Structure-aware markdown chunking.

Pure functions only — no DB, no I/O, no network beyond tiktoken's one-time BPE
load — so the splitter can be unit-tested and reasoned about directly. Written
by hand rather than pulled from a framework (decision D-002).

The shape of the algorithm:

1. Split the markdown into *structural blocks*: headings stand alone, and
   ordinary prose is split on blank lines into paragraphs. Fenced code blocks
   and markdown tables are kept whole so a table is never cut mid-row.
2. Greedily pack consecutive blocks into a chunk body until the next block
   would push it past ``BODY_MAX_TOKENS``. Structure is therefore respected by
   default: a split happens at a paragraph or heading boundary.
3. Only a single block that is *itself* larger than the cap gets hard-split,
   into token windows.
4. Each chunk after the first is prefixed with the tail of the previous chunk
   (``OVERLAP_TOKENS``) so context spans the seam.

Sizing: the body cap is ``MAX_TOKENS - OVERLAP_TOKENS``, so a finished chunk —
overlap included — is never larger than ``MAX_TOKENS``. Typical bodies land in
the 500-700 range, i.e. the ~500-800 target with ~12.5% overlap.
"""

import re
from functools import lru_cache
from typing import Any

import tiktoken

# Matches the tokenizer used by OpenAI's text-embedding-3-* models, so these
# counts stay meaningful when M7 embeds these same chunks.
ENCODING_NAME = "cl100k_base"

MAX_TOKENS = 800  # hard cap on a finished chunk, overlap included
OVERLAP_TOKENS = 100  # 12.5% of MAX_TOKENS
BODY_MAX_TOKENS = MAX_TOKENS - OVERLAP_TOKENS  # 700
TARGET_MIN_TOKENS = 500  # only used to decide whether to merge a stub tail
MIN_TAIL_TOKENS = 100  # a trailing chunk smaller than this is merged back

_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+\S")
_FENCE_RE = re.compile(r"^\s*```")
_TABLE_ROW_RE = re.compile(r"^\s*\|")
_ALNUM_RE = re.compile(r"[A-Za-z0-9]")


@lru_cache(maxsize=1)
def _encoder() -> tiktoken.Encoding:
    """Cached: the first call fetches and caches the BPE ranks (see M15 note
    about TIKTOKEN_CACHE_DIR on ephemeral filesystems)."""
    return tiktoken.get_encoding(ENCODING_NAME)


def count_tokens(text: str) -> int:
    return len(_encoder().encode(text))


def has_meaningful_text(text: str) -> bool:
    """True if there is any alphanumeric content.

    Guards against a scanned, image-only PDF: pymupdf4llm returns page
    separators and whitespace for those without raising, which would otherwise
    sail through as 'successfully extracted nothing'.
    """
    return bool(_ALNUM_RE.search(text or ""))


def _split_blocks(text: str) -> list[str]:
    """Break markdown into structural blocks.

    Headings become their own block; fenced code and contiguous table rows are
    held together; everything else splits on blank lines.
    """
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[str] = []
    buf: list[str] = []
    in_fence = False
    in_table = False

    def flush() -> None:
        nonlocal buf, in_table
        if buf:
            block = "\n".join(buf).strip()
            if block:
                blocks.append(block)
        buf = []
        in_table = False

    for line in lines:
        if _FENCE_RE.match(line):
            # Toggle; keep the fence markers attached to their block.
            if in_fence:
                buf.append(line)
                in_fence = False
                flush()
            else:
                flush()
                in_fence = True
                buf.append(line)
            continue

        if in_fence:
            buf.append(line)
            continue

        if not line.strip():
            flush()
            continue

        is_table_row = bool(_TABLE_ROW_RE.match(line))
        if in_table and not is_table_row:
            flush()
        if is_table_row and not in_table:
            flush()
            in_table = True

        if _HEADING_RE.match(line):
            flush()
            blocks.append(line.strip())
            continue

        buf.append(line)

    if in_fence:  # unterminated fence — still emit what we have
        flush()
    flush()
    return blocks


def _is_heading(block: str) -> bool:
    return bool(_HEADING_RE.match(block))


def _hard_split(block: str, limit: int) -> list[str]:
    """Split one oversized block into <= limit token windows.

    Only reached when a single paragraph/table/code block exceeds the cap on its
    own; the seam overlap is added later by the caller.
    """
    enc = _encoder()
    token_ids = enc.encode(block)
    pieces: list[str] = []
    for start in range(0, len(token_ids), limit):
        piece = enc.decode(token_ids[start : start + limit]).strip()
        if piece:
            pieces.append(piece)
    return pieces


def _tail_tokens(text: str, n: int) -> str:
    enc = _encoder()
    token_ids = enc.encode(text)
    if len(token_ids) <= n:
        return text
    return enc.decode(token_ids[-n:]).strip()


def _with_overlap(previous: str, body: str) -> str:
    """Prefix ``body`` with the tail of ``previous``, never exceeding MAX_TOKENS.

    The budget is measured on the joined string rather than by adding token
    counts: the joiner costs a token, and re-tokenizing a concatenation can
    merge or split tokens at the seam, so summing the parts under-counts.
    Shrink until it genuinely fits — the body alone is always <=
    BODY_MAX_TOKENS, so dropping the overlap entirely is a valid floor.
    """
    budget = OVERLAP_TOKENS
    while budget > 0:
        overlap = _tail_tokens(previous, budget)
        if not overlap:
            break
        candidate = f"{overlap}\n\n{body}"
        if count_tokens(candidate) <= MAX_TOKENS:
            return candidate
        budget -= max(8, budget // 4)
    return body


def chunk_markdown(text: str) -> list[dict[str, Any]]:
    """Split markdown into overlapping, structure-aligned chunks.

    Returns a list of ``{"chunk_index", "content", "token_count"}`` ordered by
    index. Returns ``[]`` for empty or content-free input — callers must treat
    that as a failure rather than as an empty success.
    """
    if not text or not has_meaningful_text(text):
        return []

    blocks = _split_blocks(text)
    if not blocks:
        return []

    # --- pack blocks into bodies -------------------------------------------
    bodies: list[list[str]] = []
    current: list[str] = []
    current_tokens = 0

    def flush_current() -> None:
        nonlocal current, current_tokens
        # Never let a chunk end on a dangling heading — carry it to the next
        # chunk so the heading sits with the text it introduces.
        if len(current) > 1 and _is_heading(current[-1]):
            trailing = current.pop()
            if current:
                bodies.append(current)
            current = [trailing]
            current_tokens = count_tokens(trailing)
            return
        if current:
            bodies.append(current)
        current = []
        current_tokens = 0

    for block in blocks:
        block_tokens = count_tokens(block)

        if block_tokens > BODY_MAX_TOKENS:
            flush_current()
            for piece in _hard_split(block, BODY_MAX_TOKENS):
                bodies.append([piece])
            continue

        if current and current_tokens + block_tokens > BODY_MAX_TOKENS:
            flush_current()

        current.append(block)
        current_tokens += block_tokens

    flush_current()

    texts = ["\n\n".join(body).strip() for body in bodies]
    texts = [t for t in texts if t and has_meaningful_text(t)]
    if not texts:
        return []

    # --- merge a stub tail --------------------------------------------------
    if len(texts) > 1 and count_tokens(texts[-1]) < MIN_TAIL_TOKENS:
        merged = f"{texts[-2]}\n\n{texts[-1]}"
        if count_tokens(merged) <= BODY_MAX_TOKENS:
            texts = texts[:-2] + [merged]

    # --- add seam overlap ---------------------------------------------------
    chunks: list[dict[str, Any]] = []
    for i, body in enumerate(texts):
        content = body if i == 0 else _with_overlap(texts[i - 1], body)
        content = content.strip()
        if not content or not has_meaningful_text(content):
            continue

        chunks.append(
            {
                "chunk_index": len(chunks),
                "content": content,
                "token_count": count_tokens(content),
            }
        )

    return chunks
