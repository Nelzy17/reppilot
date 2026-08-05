from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

# backend/ — resolved from this file so the .env is found regardless of CWD.
BACKEND_DIR = Path(__file__).resolve().parent.parent

# libpq spells TLS options one way; asyncpg spells them another. Neon hands out
# libpq-style URLs, so translate rather than making the operator hand-edit them.
_SSLMODE_TO_ASYNCPG_SSL = {
    "disable": None,
    "allow": "prefer",
    "prefer": "prefer",
    "require": "require",
    "verify-ca": "verify-ca",
    "verify-full": "verify-full",
}


def to_asyncpg_url(raw: str) -> str:
    """Normalize a libpq/Neon connection string for SQLAlchemy's asyncpg driver.

    Two things break otherwise:
      * the scheme must be ``postgresql+asyncpg://``, not ``postgresql://``
      * SQLAlchemy forwards unknown query params straight to ``asyncpg.connect()``,
        which accepts ``ssl=`` but not libpq's ``sslmode=``/``channel_binding=``
        and raises TypeError on them.
    """
    url = make_url(raw)

    if url.drivername in ("postgres", "postgresql"):
        url = url.set(drivername="postgresql+asyncpg")

    query = dict(url.query)
    sslmode = query.pop("sslmode", None)
    query.pop("channel_binding", None)  # libpq-only; asyncpg has no equivalent

    if sslmode is not None and "ssl" not in query:
        ssl_value = _SSLMODE_TO_ASYNCPG_SSL.get(str(sslmode), "require")
        if ssl_value is not None:
            query["ssl"] = ssl_value

    return url.set(query=query).render_as_string(hide_password=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Pooled endpoint — the app's runtime connection.
    DATABASE_URL: str
    # Direct endpoint — Alembic migrations (DDL should not go through a pooler).
    DATABASE_URL_DIRECT: str

    # Clerk (M3). CLERK_JWT_KEY is the PEM public key; when present, session-token
    # verification is networkless. Without it the SDK fetches the JWKS over HTTP
    # (once per signing key, then cached) using CLERK_SECRET_KEY.
    CLERK_SECRET_KEY: str = ""
    CLERK_JWT_KEY: str | None = None

    # Svix signing secret for the Clerk webhook (M4). Comes from the Clerk
    # dashboard's webhook endpoint, NOT the API Keys page — it is per-endpoint,
    # so each ngrok/production URL has its own value.
    CLERK_WEBHOOK_SECRET: str = ""

    @property
    def async_database_url(self) -> str:
        return to_asyncpg_url(self.DATABASE_URL)

    @property
    def async_database_url_direct(self) -> str:
        return to_asyncpg_url(self.DATABASE_URL_DIRECT)

    @property
    def clerk_jwt_key(self) -> str | None:
        """The PEM, with literal ``\\n`` escapes turned into real newlines.

        A PEM cannot survive in a .env file as-is (dotenv stops at the first
        newline), so it is stored single-line and unescaped here.
        """
        if not self.CLERK_JWT_KEY:
            return None
        return self.CLERK_JWT_KEY.replace("\\n", "\n")


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
