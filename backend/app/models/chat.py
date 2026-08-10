import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Text, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=text("gen_random_uuid()")
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(Text, nullable=False)  # 'user' | 'assistant'
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Cited chunk references for an assistant turn; null for user turns.
    sources: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    # clock_timestamp(), not now(): now() is fixed for the whole transaction, and
    # a question and its answer are written in one transaction — they would
    # share a timestamp and the turn order would be ambiguous on read.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.clock_timestamp(),
    )
