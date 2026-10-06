from __future__ import annotations

import uuid
from types import SimpleNamespace

from app.services.ingestion import IngestionService


class _FakeExecuteResult:
    def __init__(self, latest_version: int | None) -> None:
        self._latest_version = latest_version

    def scalar_one_or_none(self):
        return self._latest_version


class _FakeDB:
    def __init__(self, latest_version: int | None) -> None:
        self.latest_version = latest_version
        self.added: list[object] = []

    def execute(self, _stmt):
        return _FakeExecuteResult(self.latest_version)

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                obj.id = uuid.uuid4()

    def commit(self):
        return None

    def refresh(self, _obj):
        return None


def test_ingest_pdf_auto_increments_version_on_bill_id_collision(monkeypatch) -> None:
    parsed = SimpleNamespace(
        metadata={
            "bill_id": "sample_warranty_card",
            "vendor": "Acme Store",
            "date": None,
            "total_amount": 12000.0,
        },
        is_scanned=False,
    )
    chunk_draft = SimpleNamespace(chunk_type="body_section", content="Invoice details", metadata={})

    monkeypatch.setattr("app.services.ingestion.parse_pdf_document", lambda **kwargs: parsed)
    monkeypatch.setattr("app.services.ingestion.structure_aware_chunking", lambda _parsed: [chunk_draft])

    service = IngestionService(
        metadata_generator=SimpleNamespace(
            generate=lambda **kwargs: {
                "summary": "summary",
                "keywords": ["invoice"],
                "hypothetical_questions": ["what is invoice number?"],
            }
        ),
        embedding_service=SimpleNamespace(embed_batch=lambda texts: [[0.1, 0.2] for _ in texts]),
        vector_store=SimpleNamespace(enabled=False),
    )

    db = _FakeDB(latest_version=1)
    document, chunk_count = service.ingest_pdf(
        db=db,
        file_bytes=b"%PDF-1.4",
        filename="sample_warranty_card.pdf",
        version=1,
    )

    assert document.bill_id == "sample_warranty_card"
    assert document.version == 2
    assert chunk_count == 1
