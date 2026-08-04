from collections.abc import AsyncGenerator
from uuid import uuid4

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.async_database_url,
    pool_pre_ping=True,  # Neon idles connections out; check before handing one over
    connect_args={
        # Neon's pooled endpoint is PgBouncer in transaction mode. asyncpg names
        # prepared statements numerically, which collides across pooled sessions
        # (DuplicatePreparedStatementError), and cached statements go stale.
        # Disable the cache and use unique names. See SQLAlchemy's asyncpg docs,
        # "Prepared Statement Name with PGBouncer".
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
    },
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,  # keep attributes readable after commit in request handlers
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a request-scoped AsyncSession."""
    async with AsyncSessionLocal() as session:
        yield session
