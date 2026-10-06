from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.api.dependencies import get_services
from app.core.database import get_db
from app.main import app
from app.models import ExtractionJob


class _FakeObjectStore:
    enabled = True
    bucket = "test-bucket"
    region = "ap-south-1"

    @staticmethod
    def guess_content_type(_filename: str) -> str:
        return "image/png"

    @staticmethod
    def build_object_key(*, filename: str, source: str) -> str:
        return f"documents/{source}/{filename}"

    @staticmethod
    def put_bytes(*, key: str, payload: bytes, filename: str, content_type: str | None = None, metadata=None):
        _ = payload, filename, content_type, metadata
        return {
            "storage_key": key,
            "storage_bucket": "test-bucket",
            "storage_region": "ap-south-1",
        }


class _FakeAsyncDB:
    def __init__(self) -> None:
        self.jobs: dict[uuid.UUID, ExtractionJob] = {}

    def add(self, obj):
        if isinstance(obj, ExtractionJob):
            if obj.created_at is None:
                obj.created_at = datetime.now(timezone.utc)
            obj.updated_at = datetime.now(timezone.utc)
            self.jobs[obj.id] = obj

    def commit(self):
        return None

    def refresh(self, obj):
        if isinstance(obj, ExtractionJob):
            obj.created_at = obj.created_at or datetime.now(timezone.utc)
            obj.updated_at = obj.updated_at or obj.created_at

    def get(self, model, key):
        if model is ExtractionJob:
            return self.jobs.get(key)
        return None


class _FakeDynamoMirrorStore:
    enabled = True
    read_fallback_enabled = True

    def __init__(self, payload: dict, *, user_id: str | None, merchant_user_id: str | None) -> None:
        self._payload = payload
        self._user_id = user_id
        self._merchant_user_id = merchant_user_id

    def get_extraction_job_record(self, _job_id: str):
        return SimpleNamespace(
            payload=self._payload,
            user_id=self._user_id,
            merchant_user_id=self._merchant_user_id,
        )


def test_async_extraction_job_create_and_status(monkeypatch) -> None:
    fake_db = _FakeAsyncDB()
    fake_services = SimpleNamespace(object_store=_FakeObjectStore())

    def override_db():
        yield fake_db

    monkeypatch.setattr(
        "app.api.routes.get_settings",
        lambda: SimpleNamespace(
            api_rate_limit_ingest_per_window=20,
            api_rate_limit_window_seconds=60,
            async_extraction_enabled=True,
            async_extraction_source_prefix="async-extraction",
            async_extraction_callback_token="secret",
            async_extraction_ocr_mode="hybrid",
            local_async_extraction_worker_enabled=True,
        ),
    )
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_services] = lambda: fake_services

    with TestClient(app) as client:
        create_response = client.post(
            "/api/v1/extraction-jobs/image",
            headers={"Authorization": "Bearer safebill-analyst-token"},
            files={"file": ("bill.png", b"fake-image-bytes", "image/png")},
            data={"user_id": "u-1"},
        )
        assert create_response.status_code == 200
        job_id = create_response.json()["jobId"]

        status_response = client.get(
            f"/api/v1/extraction-jobs/{job_id}",
            headers={"Authorization": "Bearer safebill-analyst-token"},
            params={"user_id": "u-1"},
        )
        assert status_response.status_code == 200
        assert status_response.json()["status"] == "queued"

    app.dependency_overrides.clear()


def test_async_extraction_job_callback_persists_document(monkeypatch) -> None:
    fake_db = _FakeAsyncDB()
    now = datetime.now(timezone.utc)
    job = ExtractionJob(
        id=uuid.uuid4(),
        status="queued",
        filename="bill.png",
        content_type="image/png",
        source_object_key="documents/async-extraction/bill.png",
        source_bucket="test-bucket",
        source_region="ap-south-1",
        user_id="u-1",
        request_metadata={
            "bill_id": "",
            "vendor": "",
            "document_date": None,
            "total_amount": None,
            "consumer_email": "user@example.com",
            "consumer_name": "Aryan",
        },
        created_at=now,
        updated_at=now,
    )
    fake_db.jobs[job.id] = job
    fake_services = SimpleNamespace(object_store=_FakeObjectStore())

    def override_db():
        yield fake_db

    monkeypatch.setattr(
        "app.api.routes.get_settings",
        lambda: SimpleNamespace(
            async_extraction_enabled=True,
            async_extraction_callback_token="secret",
        ),
    )
    monkeypatch.setattr(
        "app.api.routes._persist_structured_document",
        lambda **kwargs: (
            SimpleNamespace(id=uuid.uuid4(), bill_id="GST-3525-26", vendor="Gujarat Freight Tools"),
            2,
        ),
    )
    monkeypatch.setattr("app.api.routes._schedule_document_notifications", lambda *args, **kwargs: None)
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_services] = lambda: fake_services

    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/extraction-jobs/{job.id}/callback",
            headers={"X-Async-Extraction-Token": "secret"},
            json={
                "status": "completed",
                "extracted_text": "Invoice Number: GST-3525-26\nVendor: Gujarat Freight Tools\nTotal Amount: INR 4490.00",
                "extracted_metadata": {
                    "bill_id": "GST-3525-26",
                    "vendor": "Gujarat Freight Tools",
                    "total_amount": 4490.0,
                },
                "engines_used": ["google_vision", "aws_bedrock_vision"],
            },
        )
        assert response.status_code == 200
        assert fake_db.jobs[job.id].status == "completed"
        assert fake_db.jobs[job.id].document_id is not None

    app.dependency_overrides.clear()


def test_async_extraction_job_status_falls_back_to_dynamodb() -> None:
    job_id = uuid.uuid4()
    fake_db = _FakeAsyncDB()
    payload = {
        "jobId": str(job_id),
        "status": "completed",
        "filename": "bill.png",
        "documentId": str(uuid.uuid4()),
        "enginesUsed": ["google_vision", "bedrock"],
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "completedAt": datetime.now(timezone.utc).isoformat(),
    }
    fake_services = SimpleNamespace(
        object_store=_FakeObjectStore(),
        dynamodb_store=_FakeDynamoMirrorStore(payload, user_id="u-1", merchant_user_id=None),
    )

    def override_db():
        yield fake_db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_services] = lambda: fake_services

    with TestClient(app) as client:
        status_response = client.get(
            f"/api/v1/extraction-jobs/{job_id}",
            headers={"Authorization": "Bearer safebill-analyst-token"},
            params={"user_id": "u-1"},
        )
        assert status_response.status_code == 200
        assert status_response.json()["status"] == "completed"
        assert status_response.json()["filename"] == "bill.png"

    app.dependency_overrides.clear()
