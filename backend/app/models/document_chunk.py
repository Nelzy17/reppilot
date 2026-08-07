import uuid

from sqlalchemy import ForeignKey, Integer, Text, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    # CASCADE mirrors documents.user_id: deleting a document takes its chunks
    # with it, and users -> documents -> chunks stays deletable end to end.
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Populated in M7 when the chunk is embedded and upserted into Qdrant.
    qdrant_point_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
