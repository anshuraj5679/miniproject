from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import get_db
from app.main import app

MERCHANT_HEADERS = {"Authorization": "Bearer safebill-analyst-token"}


def _profiles_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE user_profiles (id TEXT, user_id TEXT, custom_id TEXT, email TEXT, "
                "full_name TEXT, user_type TEXT, created_at TEXT)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO user_profiles VALUES "
                "('p1', 'user-1', 'CON-1A2B3C4D', 'asha@example.com', 'Asha', 'consumer', '2026-01-01'),"
                "('p2', 'user-2', 'MER-99887766', 'shop@example.com', 'Shop', 'merchant', '2026-01-01')"
            )
        )
    session_factory = sessionmaker(bind=engine)

    def override():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    return override


def test_lookup_id_reads_supabase_user_profiles() -> None:
    app.dependency_overrides[get_db] = _profiles_db()
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/auth/lookup-id",
            json={"customId": "con-1a2b3c4d", "userType": "consumer"},
            headers=MERCHANT_HEADERS,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["userId"] == "user-1"
        assert body["customId"] == "CON-1A2B3C4D"
        assert body["fullName"] == "Asha"

        wrong_type = client.post(
            "/api/v1/auth/lookup-id",
            json={"customId": "MER-99887766", "userType": "consumer"},
            headers=MERCHANT_HEADERS,
        )
        assert wrong_type.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_lookup_id_requires_authentication() -> None:
    app.dependency_overrides[get_db] = _profiles_db()
    try:
        response = TestClient(app).post(
            "/api/v1/auth/lookup-id",
            json={"customId": "CON-1A2B3C4D", "userType": "consumer"},
        )
        assert response.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_recover_id_explains_when_email_delivery_is_disabled() -> None:
    app.dependency_overrides[get_db] = _profiles_db()
    try:
        response = TestClient(app).post(
            "/api/v1/auth/recover-id",
            json={"email": "asha@example.com", "userType": "consumer"},
        )
        assert response.status_code == 503
        assert "Settings" in str(response.json()["detail"])
    finally:
        app.dependency_overrides.clear()
