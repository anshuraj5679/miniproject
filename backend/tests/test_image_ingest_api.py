from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_services
from app.core.database import get_db
from app.main import app


@pytest.fixture()
def image_client(monkeypatch: pytest.MonkeyPatch):
    fake_doc = SimpleNamespace(
        id=uuid.uuid4(),
        bill_id="IMG-100",
        vendor="Image Store",
        created_at=datetime.now(timezone.utc),
    )

    def fake_persist_structured_document(**kwargs):
        _ = kwargs
        return fake_doc, 2

    def fake_db():
        class _DB:
            pass

        yield _DB()

    monkeypatch.setattr("app.api.routes._persist_structured_document", fake_persist_structured_document)
    app.dependency_overrides[get_services] = lambda: object()
    app.dependency_overrides[get_db] = fake_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def test_ingest_image_accepts_image_upload(image_client: TestClient) -> None:
    response = image_client.post(
        "/api/v1/ingest/image",
        headers={"Authorization": "Bearer safebill-analyst-token"},
        files={"file": ("bill.png", b"fake-image-bytes", "image/png")},
        data={"user_id": "u-1", "ocr_text": "Invoice Number: INV-100\nTOTAL: INR 999"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["bill_id"] == "IMG-100"
    assert payload["vendor"] == "Image Store"
    assert payload["chunk_count"] == 2


def test_ingest_image_rejects_non_image(image_client: TestClient) -> None:
    response = image_client.post(
        "/api/v1/ingest/image",
        headers={"Authorization": "Bearer safebill-analyst-token"},
        files={"file": ("note.txt", b"plain-text", "text/plain")},
    )
    assert response.status_code == 400


def test_ingest_image_uses_supplied_ocr_text(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_text: dict[str, str] = {}
    fake_doc = SimpleNamespace(
        id=uuid.uuid4(),
        bill_id="IMG-100",
        vendor="Image Store",
        created_at=datetime.now(timezone.utc),
    )

    def fake_persist_structured_document(**kwargs):
        captured_text["value"] = str(kwargs.get("extracted_text") or "")
        return fake_doc, 2

    def fake_db():
        class _DB:
            pass

        yield _DB()

    monkeypatch.setattr("app.api.routes._persist_structured_document", fake_persist_structured_document)
    app.dependency_overrides[get_services] = lambda: object()
    app.dependency_overrides[get_db] = fake_db

    with TestClient(app) as test_client:
        response = test_client.post(
            "/api/v1/ingest/image",
            headers={"Authorization": "Bearer safebill-analyst-token"},
            files={"file": ("bill.png", b"fake-image-bytes", "image/png")},
            data={"user_id": "u-1", "ocr_text": "Invoice Number: INV-2001\nTOTAL: INR 1200"},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    assert captured_text["value"].startswith("Invoice Number: INV-2001")


def test_ingest_image_returns_422_when_no_ocr_text_available(image_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes._ocr_image_bytes", lambda _payload: "")
    response = image_client.post(
        "/api/v1/ingest/image",
        headers={"Authorization": "Bearer safebill-analyst-token"},
        files={"file": ("bill.png", b"fake-image-bytes", "image/png")},
        data={"user_id": "u-1"},
    )
    assert response.status_code == 422


def test_ingest_image_rejects_ui_screenshot_text(image_client: TestClient) -> None:
    response = image_client.post(
        "/api/v1/ingest/image",
        headers={"Authorization": "Bearer safebill-analyst-token"},
        files={"file": ("bill.png", b"fake-image-bytes", "image/png")},
        data={
            "user_id": "u-1",
            "ocr_text": "Merchant Dashboard\nConsumer Sync\nAssign Uploaded Bill",
        },
    )
    assert response.status_code == 422


def test_ingest_image_allows_manual_field_fallback_when_ocr_missing(
    image_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.routes._ocr_image_bytes", lambda _payload: "")
    response = image_client.post(
        "/api/v1/ingest/image",
        headers={"Authorization": "Bearer safebill-analyst-token"},
        files={"file": ("bill.png", b"fake-image-bytes", "image/png")},
        data={"user_id": "u-1", "bill_id": "INV-3001", "total_amount": "12999"},
    )
    assert response.status_code == 200


def test_ingest_image_uses_bedrock_metadata_fallback_when_ocr_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    fake_doc = SimpleNamespace(
        id=uuid.uuid4(),
        bill_id="IMG-100",
        vendor="Image Store",
        created_at=datetime.now(timezone.utc),
    )

    def fake_persist_structured_document(**kwargs):
        captured["text"] = kwargs.get("extracted_text")
        captured["metadata"] = kwargs.get("extracted_metadata")
        return fake_doc, 2

    def fake_db():
        class _DB:
            pass

        yield _DB()

    monkeypatch.setattr("app.api.routes._persist_structured_document", fake_persist_structured_document)
    monkeypatch.setattr(
        "app.api.routes._extract_image_metadata_with_bedrock",
        lambda _payload, _filename: {
            "bill_id": "QEAC-7547",
            "vendor": "Lalani Info Tech Limited",
            "date": "2018-03-30",
            "total_amount": 6180.0,
        },
    )
    monkeypatch.setattr("app.api.routes._ocr_image_bytes", lambda _payload: "")
    app.dependency_overrides[get_services] = lambda: object()
    app.dependency_overrides[get_db] = fake_db

    with TestClient(app) as test_client:
        response = test_client.post(
            "/api/v1/ingest/image",
            headers={"Authorization": "Bearer safebill-analyst-token"},
            files={"file": ("bill.png", b"fake-image-bytes", "image/png")},
            data={"user_id": "u-1"},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    assert isinstance(captured.get("text"), str)
    assert "QEAC-7547" in str(captured["text"])
    assert isinstance(captured.get("metadata"), dict)
    assert (captured["metadata"] or {}).get("vendor") == "Lalani Info Tech Limited"


def test_ingest_image_ui_text_allowed_when_bedrock_detects_invoice(
    image_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.api.routes._extract_image_metadata_with_bedrock",
        lambda _payload, _filename: {"bill_id": "QEAC-7547", "total_amount": 6180.0},
    )
    response = image_client.post(
        "/api/v1/ingest/image",
        headers={"Authorization": "Bearer safebill-analyst-token"},
        files={"file": ("bill.png", b"fake-image-bytes", "image/png")},
        data={
            "user_id": "u-1",
            "ocr_text": "Merchant Dashboard\nConsumer Sync\nAssign Uploaded Bill",
        },
    )
    assert response.status_code == 200


def test_ingest_image_hybrid_mode_uses_bedrock_without_textract(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    fake_doc = SimpleNamespace(
        id=uuid.uuid4(),
        bill_id="IMG-200",
        vendor="Hybrid Store",
        created_at=datetime.now(timezone.utc),
    )

    def fake_persist_structured_document(**kwargs):
        captured["metadata"] = kwargs.get("extracted_metadata")
        captured["text"] = kwargs.get("extracted_text")
        return fake_doc, 2

    def fake_db():
        class _DB:
            pass

        yield _DB()

    monkeypatch.setattr("app.api.routes._persist_structured_document", fake_persist_structured_document)
    monkeypatch.setattr("app.api.routes._extract_image_metadata_with_google_vision", lambda _payload, _filename: ({}, ""))
    monkeypatch.setattr(
        "app.api.routes._extract_image_metadata_with_bedrock",
        lambda _payload, _filename: {
            "bill_id": "INV-HYBRID-1",
            "vendor": "Hybrid Store",
            "date": "2026-03-07",
            "total_amount": 27881.36,
        },
    )

    def fail_textract(_payload, _filename):
        raise AssertionError("Textract path should not execute in hybrid mode")

    monkeypatch.setattr("app.api.routes._extract_image_metadata_with_textract", fail_textract)
    app.dependency_overrides[get_services] = lambda: object()
    app.dependency_overrides[get_db] = fake_db

    with TestClient(app) as test_client:
        response = test_client.post(
            "/api/v1/ingest/image",
            headers={"Authorization": "Bearer safebill-analyst-token"},
            files={"file": ("bill.png", b"fake-image-bytes", "image/png")},
            data={"user_id": "u-1", "ocr_mode": "hybrid"},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    metadata = captured.get("metadata")
    assert isinstance(metadata, dict)
    assert metadata.get("bill_id") == "INV-HYBRID-1"
    assert metadata.get("vendor") == "Hybrid Store"
