from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app


class _FakeExecuteResult:
    def __init__(self, docs: list[SimpleNamespace]) -> None:
        self._docs = docs

    def scalars(self) -> list[SimpleNamespace]:
        return list(self._docs)

    def scalar_one_or_none(self):
        return None


class _FakeDB:
    def __init__(self, docs: list[SimpleNamespace]) -> None:
        self.docs = docs

    def execute(self, _stmt):
        return _FakeExecuteResult(self.docs)

    def get(self, _model, doc_id):
        for doc in self.docs:
            if doc.id == doc_id:
                return doc
        return None

    def delete(self, document):
        self.docs = [doc for doc in self.docs if doc.id != document.id]

    def add(self, _obj):
        return None

    def commit(self):
        return None

    def refresh(self, _obj):
        return None


def _doc(
    *,
    user_id: str,
    title: str,
    bill_id: str,
    created_at: datetime,
    warranty_end: date,
    purchase_date: date,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        bill_id=bill_id,
        vendor="Acme Store",
        date=purchase_date,
        total_amount=12999.0,
        version=1,
        references={
            "user_id": user_id,
            "title": title,
            "product_name": title,
            "category": "Gadgets",
            "warranty_start": purchase_date.isoformat(),
            "warranty_end": warranty_end.isoformat(),
            "warranty_months": 12,
            "serial_number": "SN-123",
            "is_verified": True,
            "raw_text": "Sample OCR text",
        },
        created_at=created_at,
    )


@pytest.fixture()
def docs_client():
    now = datetime.now(timezone.utc)
    today = date.today()
    docs = [
        _doc(
            user_id="u-1",
            title="Laptop Pro",
            bill_id="INV-100",
            created_at=now,
            warranty_end=today + timedelta(days=10),
            purchase_date=today - timedelta(days=120),
        ),
        _doc(
            user_id="u-1",
            title="Headphones",
            bill_id="INV-101",
            created_at=now - timedelta(days=1),
            warranty_end=today - timedelta(days=2),
            purchase_date=today - timedelta(days=400),
        ),
        _doc(
            user_id="u-1",
            title="Microwave",
            bill_id="INV-102",
            created_at=now - timedelta(days=2),
            warranty_end=today + timedelta(days=180),
            purchase_date=today - timedelta(days=40),
        ),
        _doc(
            user_id="u-2",
            title="Camera",
            bill_id="INV-200",
            created_at=now - timedelta(days=3),
            warranty_end=today + timedelta(days=5),
            purchase_date=today - timedelta(days=30),
        ),
    ]
    fake_db = _FakeDB(docs)

    def override_db():
        yield fake_db

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as client:
        yield client, docs
    app.dependency_overrides.clear()


def test_documents_list_filters_by_user(docs_client) -> None:
    client, _docs = docs_client
    response = client.get(
        "/api/v1/documents",
        params={"user_id": "u-1"},
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["documents"]) == 3
    assert all(item["userId"] == "u-1" for item in payload["documents"])


def test_document_get_and_delete_flow(docs_client) -> None:
    client, docs = docs_client
    target = docs[0]

    get_response = client.get(
        f"/api/v1/documents/{target.id}",
        params={"user_id": "u-1"},
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert get_response.status_code == 200
    assert get_response.json()["docId"] == str(target.id)

    delete_response = client.delete(
        f"/api/v1/documents/{target.id}",
        params={"user_id": "u-1"},
        headers={"Authorization": "Bearer safebill-analyst-token"},
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["status"] == "deleted"

    list_response = client.get(
        "/api/v1/documents",
        params={"user_id": "u-1"},
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    doc_ids = {doc["docId"] for doc in list_response.json()["documents"]}
    assert str(target.id) not in doc_ids
    assert "claimReadiness" in get_response.json()
    assert "compliance" in get_response.json()


def test_reminders_only_returns_upcoming_and_expired_for_user(docs_client) -> None:
    client, docs = docs_client
    response = client.get(
        "/api/v1/reminders",
        params={"user_id": "u-1", "days_ahead": 45},
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert response.status_code == 200

    reminders = response.json()["reminders"]
    reminder_doc_ids = {item["docId"] for item in reminders}

    assert str(docs[0].id) in reminder_doc_ids  # expires soon
    assert str(docs[1].id) in reminder_doc_ids  # already expired
    assert str(docs[2].id) not in reminder_doc_ids  # far in future
    assert str(docs[3].id) not in reminder_doc_ids  # different user


def test_document_calendar_links_and_claim_packet(docs_client) -> None:
    client, docs = docs_client
    target = docs[0]

    links_response = client.get(
        f"/api/v1/documents/{target.id}/calendar-links",
        params={"user_id": "u-1"},
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert links_response.status_code == 200
    links = links_response.json()
    assert links["googleCalendarUrl"].startswith("https://calendar.google.com")
    assert links["icsDownloadUrl"].endswith(".ics")

    claim_response = client.get(
        f"/api/v1/documents/{target.id}/claim-packet",
        params={"user_id": "u-1"},
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert claim_response.status_code == 200
    payload = claim_response.json()
    assert payload["docId"] == str(target.id)
    assert payload["attachmentChecklist"]
