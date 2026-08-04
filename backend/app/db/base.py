from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base. Every model subclasses this, and Alembic autogenerate
    diffs against ``Base.metadata``."""
