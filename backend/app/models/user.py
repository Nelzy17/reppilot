import uuid
from datetime import datetime

from sqlalchemy import DateTime, Text, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        server_default=text("gen_random_uuid()"),  # built into Postgres 13+
    )
    # unique=True + index=True emits a single UNIQUE INDEX, not a constraint
    # plus a redundant second index.
    clerk_user_id: Mapped[str] = mapped_column(
        Text, nullable=False, unique=True, index=True
    )
    email: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'rep'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
