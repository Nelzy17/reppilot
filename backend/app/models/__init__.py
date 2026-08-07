"""Model registry.

Every model must be imported here so that ``Base.metadata`` is fully populated
by the time Alembic autogenerate inspects it — otherwise autogenerate sees an
empty schema and emits a migration that drops tables.
"""

from app.models.document import Document
from app.models.document_chunk import DocumentChunk
from app.models.user import User

__all__ = ["Document", "DocumentChunk", "User"]
