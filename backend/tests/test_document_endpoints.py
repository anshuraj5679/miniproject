from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.routes import _serialize_document
from app.api.dependencies import get_services
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


class _FakeServiceLocator:
    @staticmethod
    def parse_radius_km(_query: str, default_km: float | None = None) -> float:
        return float(default_km or 30.0)

    @staticmethod
    def find_service_centers(**_kwargs):
        return [
            SimpleNamespace(
                name="Acme Authorized Service Center",
                address="MG Road, Bengaluru",
                latitude=12.9716,
                longitude=77.5946,
                distance_km=3.2,
                source="brand_directory",
                confidence="verified",
                map_url="https://maps.example/acme",
                city="Bengaluru",
                phone="+91-9000000000",
                website="https://acme.example/service",
                pincode="560001",
                pickup_available=True,
                estimated_tat_days=4,
            )
        ]


class _FakeDynamoMirrorStore:
    def __init__(self, payloads: list[dict]) -> None:
        self.enabled = True
        self.read_fallback_enabled = True
        self.payloads = {str(payload["docId"]): dict(payload) for payload in payloads}

    def list_document_records(self, *, user_id=None, merchant_user_id=None, limit=100):
        records = []
        for payload in self.payloads.values():
            if user_id and payload.get("userId") != user_id:
                continue
            if merchant_user_id and payload.get("assignedByMerchantId") != merchant_user_id:
                continue
            records.append(
                SimpleNamespace(
                    payload=payload,
                    user_id=payload.get("userId"),
                    merchant_user_id=payload.get("assignedByMerchantId"),
                    created_at=payload.get("createdAt"),
                )
            )
        return records[:limit]

    def get_document_record(self, doc_id: str):
        payload = self.payloads.get(str(doc_id))
        if payload is None:
            return None
        return SimpleNamespace(
            payload=payload,
            user_id=payload.get("userId"),
            merchant_user_id=payload.get("assignedByMerchantId"),
            created_at=payload.get("createdAt"),
        )

    def delete_document_record(self, doc_id: str):
        self.payloads.pop(str(doc_id), None)
        return True


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

    fake_services = SimpleNamespace(service_center_locator=_FakeServiceLocator(), object_store=None)
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_services] = lambda: fake_services
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
    assert all("recommendedAction" in reminder for reminder in reminders)


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
    assert links["googleCalendarUrl"].startswith("https://calendar.google.com/calendar/render")
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


def test_document_claim_assistant_and_service_centers(docs_client) -> None:
    client, docs = docs_client
    target = docs[0]

    claim_assistant_response = client.get(
        f"/api/v1/documents/{target.id}/claim-assistant",
        params={"user_id": "u-1"},
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert claim_assistant_response.status_code == 200
    claim_assistant = claim_assistant_response.json()
    assert claim_assistant["docId"] == str(target.id)
    assert claim_assistant["nextBestActions"]
    assert claim_assistant["claimPacketUrl"].endswith("/claim-packet")
    assert claim_assistant["serviceCentersUrl"].endswith("/service-centers")

    centers_response = client.get(
        f"/api/v1/documents/{target.id}/service-centers",
        params={"user_id": "u-1", "user_location_text": "Bengaluru", "radius_km": 25},
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert centers_response.status_code == 200
    centers_payload = centers_response.json()
    assert centers_payload["docId"] == str(target.id)
    assert centers_payload["count"] >= 1
    assert centers_payload["centers"]


def test_document_share_and_shared_vault_listing(docs_client) -> None:
    client, docs = docs_client
    target = docs[0]

    share_response = client.post(
        f"/api/v1/documents/{target.id}/share",
        json={"target_user_id": "u-2", "permission": "view"},
        headers={"Authorization": "Bearer safebill-analyst-token"},
    )
    assert share_response.status_code == 200
    share_payload = share_response.json()
    assert share_payload["docId"] == str(target.id)
    assert any(member["userId"] == "u-2" for member in share_payload["sharedWith"])

    shared_list_response = client.get(
        "/api/v1/vault/shared-with-me",
        params={"user_id": "u-2"},
        headers={"Authorization": "Bearer safebill-analyst-token"},
    )
    assert shared_list_response.status_code == 200
    shared_docs = shared_list_response.json()["documents"]
    assert any(doc["docId"] == str(target.id) for doc in shared_docs)

    unshare_response = client.delete(
        f"/api/v1/documents/{target.id}/share/u-2",
        headers={"Authorization": "Bearer safebill-analyst-token"},
    )
    assert unshare_response.status_code == 200
    assert all(member["userId"] != "u-2" for member in unshare_response.json()["sharedWith"])


def test_claim_whatsapp_draft_endpoint(docs_client) -> None:
    client, docs = docs_client
    target = docs[0]
    response = client.get(
        f"/api/v1/documents/{target.id}/claim-whatsapp-draft",
        params={"user_id": "u-1"},
        headers={"Authorization": "Bearer safebill-analyst-token"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["docId"] == str(target.id)
    assert "Invoice:" in payload["message"]
    assert "nextSteps" in payload


def test_fraud_check_and_renewal_options_endpoints(docs_client) -> None:
    client, docs = docs_client
    target = docs[0]
    target.references["duplicate_suspected"] = True
    target.references["duplicate_match_count"] = 2
    target.references["extraction_fingerprint"] = "abc123"

    fraud_response = client.get(
        f"/api/v1/documents/{target.id}/fraud-check",
        params={"user_id": "u-1"},
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert fraud_response.status_code == 200
    fraud_payload = fraud_response.json()
    assert fraud_payload["docId"] == str(target.id)
    assert fraud_payload["riskScore"] >= 0
    assert fraud_payload["signals"]

    renewal_response = client.get(
        f"/api/v1/documents/{target.id}/renewal-options",
        params={"user_id": "u-1", "currency": "INR"},
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert renewal_response.status_code == 200
    renewal_payload = renewal_response.json()
    assert renewal_payload["docId"] == str(target.id)
    assert len(renewal_payload["options"]) >= 3
    assert any(option["recommended"] for option in renewal_payload["options"])
    assert all(option["quoteUrl"] for option in renewal_payload["options"])
    assert all(option["purchaseUrl"] for option in renewal_payload["options"])
    assert all(option["webhookRef"] for option in renewal_payload["options"])


def test_marketplace_quote_purchase_and_provider_event_hooks(docs_client) -> None:
    client, docs = docs_client
    target = docs[0]

    options_response = client.get(
        f"/api/v1/documents/{target.id}/renewal-options",
        params={"user_id": "u-1", "currency": "INR"},
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert options_response.status_code == 200
    option = options_response.json()["options"][0]

    quote_response = client.get(
        "/api/v1/marketplace/renewal/quote",
        params={
            "doc_id": str(target.id),
            "plan_id": option["planId"],
            "partner_code": option["partnerCode"],
            "currency": "INR",
            "user_id": "u-1",
        },
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert quote_response.status_code == 200
    quote_payload = quote_response.json()
    assert quote_payload["docId"] == str(target.id)
    assert quote_payload["totalPremium"] >= quote_payload["basePremium"]
    assert quote_payload["quoteRef"]

    purchase_response = client.post(
        "/api/v1/marketplace/renewal/purchase-intent",
        json={
            "doc_id": str(target.id),
            "plan_id": option["planId"],
            "partner_code": option["partnerCode"],
            "user_id": "u-1",
            "return_url": "https://example.com/return",
        },
        headers={"Authorization": "Bearer safebill-viewer-token"},
    )
    assert purchase_response.status_code == 200
    purchase_payload = purchase_response.json()
    assert purchase_payload["docId"] == str(target.id)
    assert purchase_payload["checkoutUrl"]
    assert purchase_payload["webhookRef"]

    event_response = client.post(
        "/api/v1/marketplace/renewal/provider-events",
        json={
            "webhook_ref": purchase_payload["webhookRef"],
            "status": "paid",
            "provider": option["partnerCode"],
            "payload": {"tx_id": "tx-123"},
        },
        headers={"Authorization": "Bearer safebill-analyst-token"},
    )
    assert event_response.status_code == 200
    assert event_response.json()["status"] == "acknowledged"


def test_serialize_document_skips_identifier_line_items() -> None:
    today = date.today()
    document = SimpleNamespace(
        id=uuid.uuid4(),
        bill_id="MB78190631",
        vendor="Apple India Private Limited",
        date=today,
        total_amount=27881.36,
        version=1,
        references={
            "user_id": "u-1",
            "title": "iPad WiFi 128GB",
            "product_name": "iPad WiFi 128GB",
            "category": "Gadgets",
            "warranty_start": today.isoformat(),
            "warranty_end": (today + timedelta(days=365)).isoformat(),
            "warranty_months": 12,
            "is_verified": True,
            "line_items": [
                {"name": "Customer Number", "amount": 919115},
                {"name": "iPad WiFi 128GB", "amount": 27881.36},
            ],
        },
        created_at=datetime.now(timezone.utc),
    )

    view = _serialize_document(document)
    assert view.items
    assert all("customer number" not in (item.productName or "").lower() for item in view.items)
    assert view.items[0].productName == "iPad WiFi 128GB"


def test_serialize_document_single_line_item_uses_invoice_total_for_amount() -> None:
    today = date.today()
    document = SimpleNamespace(
        id=uuid.uuid4(),
        bill_id="MB78190631",
        vendor="Apple India Private Limited",
        date=today,
        total_amount=32900.0,
        version=1,
        references={
            "user_id": "u-1",
            "title": "000010 PD4A4HN/A IPAD WIFI 128GB BLU-HIN 84713090 1 27881.36",
            "product_name": "000010 PD4A4HN/A IPAD WIFI 128GB BLU-HIN 84713090 1 27881.36",
            "category": "Gadgets",
            "warranty_start": today.isoformat(),
            "warranty_end": (today + timedelta(days=365)).isoformat(),
            "warranty_months": 12,
            "is_verified": True,
            "line_items": [
                {"name": "000010 PD4A4HN/A IPAD WIFI 128GB BLU-HIN 84713090 1 27881.36", "amount": 27881.36},
            ],
        },
        created_at=datetime.now(timezone.utc),
    )

    view = _serialize_document(document)
    assert view.items
    assert view.items[0].productName == "IPAD WIFI 128GB BLU-HIN"
    assert view.items[0].purchasePrice == 32900.0


def test_documents_list_and_get_fall_back_to_dynamodb() -> None:
    now = datetime.now(timezone.utc)
    today = date.today()
    source_doc = _doc(
        user_id="u-1",
        title="Fallback Blender",
        bill_id="INV-FALLBACK",
        created_at=now,
        warranty_end=today + timedelta(days=90),
        purchase_date=today - timedelta(days=10),
    )
    mirrored_view = _serialize_document(source_doc)
    mirrored_payload = (
        mirrored_view.model_dump(mode="json")
        if hasattr(mirrored_view, "model_dump")
        else mirrored_view.dict()
    )
    fake_db = _FakeDB([])

    def override_db():
        yield fake_db

    fake_services = SimpleNamespace(
        service_center_locator=_FakeServiceLocator(),
        object_store=None,
        dynamodb_store=_FakeDynamoMirrorStore([mirrored_payload]),
    )
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_services] = lambda: fake_services

    with TestClient(app) as client:
        list_response = client.get(
            "/api/v1/documents",
            params={"user_id": "u-1"},
            headers={"Authorization": "Bearer safebill-viewer-token"},
        )
        assert list_response.status_code == 200
        assert list_response.json()["documents"][0]["docId"] == str(source_doc.id)

        get_response = client.get(
            f"/api/v1/documents/{source_doc.id}",
            params={"user_id": "u-1"},
            headers={"Authorization": "Bearer safebill-viewer-token"},
        )
        assert get_response.status_code == 200
        assert get_response.json()["title"] == "Fallback Blender"

        delete_response = client.delete(
            f"/api/v1/documents/{source_doc.id}",
            params={"user_id": "u-1"},
            headers={"Authorization": "Bearer safebill-analyst-token"},
        )
        assert delete_response.status_code == 200

    app.dependency_overrides.clear()
