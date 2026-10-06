from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import get_settings

settings = get_settings()


def _build_engine_url(raw_url: str) -> str:
    try:
        url = make_url(raw_url)
    except Exception:
        return raw_url

    driver = url.drivername.split("+", 1)[0].lower()
    if driver not in {"postgresql", "postgres"}:
        return raw_url

    # Render and other providers often supply DATABASE_URL as `postgres://...` or
    # `postgresql://...` without a specific DBAPI driver. We ship `psycopg`
    # (not psycopg2), so normalize to the psycopg driver to avoid runtime errors.
    if "+" not in url.drivername:
        url = url.set(drivername="postgresql+psycopg")

    query = dict(url.query)
    if "connect_timeout" not in query:
        # Keep request latency predictable when DB host is unreachable.
        query["connect_timeout"] = "5"
    return url.set(query=query).render_as_string(hide_password=False)


try:
    engine = create_engine(_build_engine_url(settings.database_url), pool_pre_ping=True, future=True)
except ModuleNotFoundError:  # pragma: no cover - local test fallback when postgres driver is unavailable
    engine = create_engine("sqlite+pysqlite:///:memory:", pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
