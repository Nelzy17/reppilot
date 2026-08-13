"""Model registry.

Every model must be imported here so that ``Base.metadata`` is fully populated
by the time Alembic autogenerate inspects it — otherwise autogenerate sees an
empty schema and emits a migration that drops tables.
"""

from app.models.chat import ChatMessage, ChatSession
from app.models.coaching import CoachingReport
from app.models.document import Document
from app.models.document_chunk import DocumentChunk
from app.models.meeting_prep import MeetingPrep
from app.models.roleplay import RoleplaySession
from app.models.user import User

__all__ = [
    "ChatMessage",
    "ChatSession",
    "CoachingReport",
    "Document",
    "DocumentChunk",
    "MeetingPrep",
    "RoleplaySession",
    "User",
]
