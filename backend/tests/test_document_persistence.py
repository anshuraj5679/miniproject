from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.api import routes


class _FakeExecuteResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self) -> None:
        self._execute_values = [None, 0]
        self.added: list[object] = []

    def execute(self, _stmt):
        value = self._execute_values.pop(0) if self._execute_values else 0
        return _FakeExecuteResult(value)

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime.now(timezone.utc)
        self.added.append(obj)

    def flush(self):
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                obj.id = uuid.uuid4()

    def commit(self):
        return None

    def refresh(self, _obj):
        return None


class _TrackingMetadataGenerator:
    def __init__(self) -> None:
        self.generate_calls = 0

    @staticmethod
    def _fallback_metadata(content: str, chunk_type: str):
        return {
            "summary": f"{chunk_type}:{content[:32]}",
            "keywords": [chunk_type, "fallback"],
            "hypothetical_questions": ["q1", "q2", "q3"],
        }

    def generate(self, **_kwargs):
        self.generate_calls += 1
        raise AssertionError("chunk metadata generation should be bypassed for fast-ingest sources")


@pytest.mark.parametrize("source", ["merchant_manual", "image_ocr_async"])
def test_persist_structured_document_uses_fast_chunk_metadata_for_nonblocking_sources(
    monkeypatch: pytest.MonkeyPatch,
    source: str,
) -> None:
    metadata_generator = _TrackingMetadataGenerator()
    fake_services = SimpleNamespace(
        ingestion=SimpleNamespace(metadata_generator=metadata_generator),
        object_store=None,
        dynamodb_store=None,
    )
    fake_db = _FakeDB()

    monkeypatch.setattr(routes, "_store_ocr_text_snapshot", lambda **kwargs: {})
    monkeypatch.setattr(routes, "_sync_document_mirror", lambda *_args, **_kwargs: None)

    document, chunk_count = routes._persist_structured_document(
        db=fake_db,
        services=fake_services,
        filename="invoice.txt",
        source=source,
        user_id="consumer-1",
        extracted_text="Invoice Number: INV-100\nVendor: Samsung\nProduct: Television\nTotal Amount: INR 1000",
        extracted_metadata={
            "bill_id": "INV-100",
            "vendor": "Samsung",
            "date": "2026-03-07",
            "total_amount": 1000.0,
            "product_name": "Television",
            "line_items": [{"name": "Television", "amount": 1000.0}],
        },
        bill_id="INV-100",
        vendor="Samsung",
        total_amount=1000.0,
        extraction_engines=["manual_override"],
    )

    assert metadata_generator.generate_calls == 0
    assert document.bill_id.startswith("INV-100")
    assert document.references["source"] == source
    assert chunk_count >= 2


def test_persist_structured_document_prefers_extracted_metadata_over_upload_hints_for_scanned_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    metadata_generator = _TrackingMetadataGenerator()
    fake_services = SimpleNamespace(
        ingestion=SimpleNamespace(metadata_generator=metadata_generator),
        object_store=None,
        dynamodb_store=None,
    )
    fake_db = _FakeDB()

    monkeypatch.setattr(routes, "_store_ocr_text_snapshot", lambda **kwargs: {})
    monkeypatch.setattr(routes, "_sync_document_mirror", lambda *_args, **_kwargs: None)

    document, _chunk_count = routes._persist_structured_document(
        db=fake_db,
        services=fake_services,
        filename="apple-tax-invoice.png",
        source="image_ocr_router",
        user_id="consumer-1",
        extracted_text=(
            "Apple India Private Limited\n"
            "Tax Invoice Number: 9222000002664974\n"
            "Tax Invoice Date: 10.06.2025\n"
            "Total Amount After Tax INR 32900.00\n"
            "IPAD WIFI 128GB BLU-HIN"
        ),
        extracted_metadata={
            "bill_id": "9222000002664974",
            "vendor": "Apple India Private Limited",
            "date": "2025-06-10",
            "total_amount": 32900.0,
            "product_name": "IPAD WIFI 128GB BLU-HIN",
        },
        bill_id="TEST23",
        vendor="Override Merchant",
        document_date=datetime(2026, 3, 9, tzinfo=timezone.utc).date(),
        total_amount=128.0,
        extraction_engines=["aws_bedrock_vision"],
    )

    assert document.bill_id == "9222000002664974"
    assert document.vendor == "Apple India Private Limited"
    assert document.date.isoformat() == "2025-06-10"
    assert float(document.total_amount) == 32900.0
