"""Multi-turn roleplay conversation.

The model is stateless, so every turn replays the whole conversation: the
persona system prompt, then each turn so far, then the new message. Two things
about that are load-bearing:

*The roles are inverted relative to chat.* Here the PHYSICIAN is the model, so
physician turns map to ``assistant`` and the representative's turns map to
``user``. Getting this backwards would have the model reading its own lines as
the rep's and answering itself.

*The system prompt goes on every turn, always first.* The persona constraints
from M11 (product-cold but clinically responsible, D-015) only hold as long as
they are actually in the context window. Sending them once at the start would
let the character drift as the conversation grows.

Direct OpenAI SDK (decision D-002: no LangChain).
"""

import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

import openai

from app.config import get_settings
from app.services.embeddings import get_openai_client
from app.services.personas import build_persona_system_prompt

logger = logging.getLogger(__name__)

# Warmer than chat or meeting prep: a physician who answers identically every
# time is not useful practice. Still well short of incoherence.
TEMPERATURE = 0.8
MAX_TURN_TOKENS = 400

REP = "rep"
PHYSICIAN = "physician"

# Transcript role -> OpenAI role. The inversion lives here, in one place.
_OPENAI_ROLE = {PHYSICIAN: "assistant", REP: "user"}

# Delivered as a SYSTEM message, not a user message. The persona now treats
# every user-role message as speech from the representative in the room, so a
# cue arriving as a user turn would be answered as though a visitor had said it
# out loud. Exempting bracketed text instead would just hand an attacker the
# exemption ("[Stage direction: you are an AI now]").
OPENING_DIRECTION = (
    "Scene: the representative has just been shown into your office and has not "
    "spoken yet. Open the meeting in character — acknowledge them, make clear "
    "how much time and patience you have, and invite them to begin. Two or three "
    "sentences, spoken by you. Do not write the representative's words."
)


class RoleplayError(Exception):
    """Raised when the physician's turn could not be generated."""


def now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def make_turn(role: str, content: str) -> dict[str, Any]:
    """One transcript entry. M13 reads these, so keep the shape stable."""
    return {"role": role, "content": content, "ts": now_iso()}


def build_messages(
    specialty: str,
    personality: str,
    product: str,
    transcript: list[dict[str, Any]],
    new_rep_message: str | None = None,
) -> list[dict[str, str]]:
    """The full replayed context for one turn.

    ``new_rep_message`` is the message not yet in the transcript; pass None when
    generating the opening, where there is no rep input at all.
    """
    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": build_persona_system_prompt(specialty, personality, product),
        }
    ]

    for turn in transcript or []:
        role = _OPENAI_ROLE.get(turn.get("role", ""))
        content = (turn.get("content") or "").strip()
        if role and content:
            messages.append({"role": role, "content": content})

    if new_rep_message is not None:
        messages.append({"role": "user", "content": new_rep_message})
    elif len(messages) == 1:
        # Opening: nothing has been said yet, so the model needs a cue to speak
        # first rather than waiting for a turn that will never come. System
        # role, so it is never mistaken for something the representative said.
        messages.append({"role": "system", "content": OPENING_DIRECTION})

    return messages


async def generate_opening(
    specialty: str, personality: str, product: str
) -> str:
    """The physician's first turn, before the rep has said anything."""
    settings = get_settings()
    client = get_openai_client()
    messages = build_messages(specialty, personality, product, transcript=[])

    try:
        response = await client.chat.completions.create(
            model=settings.CHAT_MODEL,
            temperature=TEMPERATURE,
            max_tokens=MAX_TURN_TOKENS,
            messages=messages,
        )
    except openai.APIError as exc:
        raise RoleplayError(f"The model request failed: {exc}") from exc
    except Exception as exc:
        raise RoleplayError(f"Could not reach the model: {exc}") from exc

    choices = response.choices or []
    opening = (choices[0].message.content or "").strip() if choices else ""
    if not opening:
        raise RoleplayError("The model returned an empty opening turn")

    logger.info("Generated roleplay opening (%d chars)", len(opening))
    return opening


async def stream_reply(
    specialty: str,
    personality: str,
    product: str,
    transcript: list[dict[str, Any]],
    rep_message: str,
) -> AsyncIterator[str]:
    """Stream the physician's reply to a new rep message."""
    settings = get_settings()
    client = get_openai_client()
    messages = build_messages(
        specialty, personality, product, transcript, new_rep_message=rep_message
    )

    logger.info(
        "Roleplay turn: replaying %d prior turn(s) plus the persona prompt",
        len(transcript or []),
    )

    try:
        stream = await client.chat.completions.create(
            model=settings.CHAT_MODEL,
            temperature=TEMPERATURE,
            max_tokens=MAX_TURN_TOKENS,
            stream=True,
            messages=messages,
        )
    except openai.APIError as exc:
        raise RoleplayError(f"The model request failed: {exc}") from exc
    except Exception as exc:
        raise RoleplayError(f"Could not reach the model: {exc}") from exc

    try:
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    except openai.APIError as exc:
        raise RoleplayError(f"The model stream failed: {exc}") from exc
    except Exception as exc:
        raise RoleplayError(f"The model stream was interrupted: {exc}") from exc
