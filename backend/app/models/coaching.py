import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CoachingReport(Base):
    __tablename__ = "coaching_reports"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=text("gen_random_uuid()")
    )
    # Unique: one report per session. The constraint is the guarantee — the
    # endpoint's replace-on-regenerate would otherwise be the only thing
    # stopping duplicates.
    roleplay_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("roleplay_sessions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    overall_score: Mapped[int] = mapped_column(Integer, nullable=False)
    product_knowledge: Mapped[int] = mapped_column(Integer, nullable=False)
    communication: Mapped[int] = mapped_column(Integer, nullable=False)
    objection_handling: Mapped[int] = mapped_column(Integer, nullable=False)
    clinical_accuracy: Mapped[int] = mapped_column(Integer, nullable=False)

    recommendations: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    # Per-dimension explanations, keyed by dimension name plus "overall".
    narratives: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False)
    # The document passages clinical_accuracy was judged against. Empty when the
    # rep has no matching documents — which the report says explicitly rather
    # than scoring as though it had checked.
    sources: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
