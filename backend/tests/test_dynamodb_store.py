from __future__ import annotations

from types import SimpleNamespace

from app.services.dynamodb_store import DynamoDBMirrorStore


class _FakeDynamoTable:
    def __init__(self, key_name: str) -> None:
        self.key_name = key_name
        self.items: dict[str, dict] = {}

    def put_item(self, Item):  # noqa: N803 - boto3 shape
        self.items[str(Item[self.key_name])] = dict(Item)

    def get_item(self, Key):  # noqa: N803 - boto3 shape
        item = self.items.get(str(Key[self.key_name]))
        return {"Item": dict(item)} if item else {}

    def delete_item(self, Key):  # noqa: N803 - boto3 shape
        self.items.pop(str(Key[self.key_name]), None)

    def scan(self, Limit):  # noqa: N803 - boto3 shape
        items = list(self.items.values())
        return {"Items": items[:Limit]}

    def query(self, **_kwargs):
        raise RuntimeError("query not implemented in fake table; service should fall back to scan")


class _FakeDynamoResource:
    def __init__(self) -> None:
        self.tables = {
            "docs-table": _FakeDynamoTable("doc_id"),
            "jobs-table": _FakeDynamoTable("job_id"),
        }

    def Table(self, name: str):  # noqa: N802 - boto3 shape
        return self.tables[name]


class _FakeSession:
    def __init__(self, resource: _FakeDynamoResource) -> None:
        self._resource = resource

    def resource(self, service_name: str):
        assert service_name == "dynamodb"
        return self._resource


def _settings():
    return SimpleNamespace(
        aws_region="ap-south-1",
        dynamodb_mirror_enabled=True,
        dynamodb_read_fallback_enabled=True,
        dynamodb_documents_table_name="docs-table",
        dynamodb_extraction_jobs_table_name="jobs-table",
        dynamodb_user_created_at_index_name="user_id-created_at-index",
        dynamodb_merchant_created_at_index_name="merchant_user_id-created_at-index",
    )


def test_dynamodb_store_round_trips_document_payload(monkeypatch) -> None:
    resource = _FakeDynamoResource()
    fake_boto3 = SimpleNamespace(session=SimpleNamespace(Session=lambda region_name=None: _FakeSession(resource)))
    monkeypatch.setattr("app.services.dynamodb_store.get_settings", _settings)
    monkeypatch.setattr("app.services.dynamodb_store.boto3", fake_boto3)
    monkeypatch.setattr("app.services.dynamodb_store.Key", None)

    store = DynamoDBMirrorStore()
    ok = store.upsert_document_record(
        payload={
            "docId": "doc-1",
            "userId": "u-1",
            "assignedByMerchantId": "m-1",
            "title": "Invoice One",
            "sellerName": "Acme",
            "createdAt": "2026-03-08T00:00:00+00:00",
            "updatedAt": "2026-03-08T00:01:00+00:00",
            "items": [],
        }
    )

    assert ok is True
    record = store.get_document_record("doc-1")
    assert record is not None
    assert record.user_id == "u-1"
    assert record.merchant_user_id == "m-1"
    assert record.payload["title"] == "Invoice One"

    records = store.list_document_records(user_id="u-1", limit=10)
    assert len(records) == 1
    assert records[0].payload["docId"] == "doc-1"


def test_dynamodb_store_round_trips_extraction_job_payload(monkeypatch) -> None:
    resource = _FakeDynamoResource()
    fake_boto3 = SimpleNamespace(session=SimpleNamespace(Session=lambda region_name=None: _FakeSession(resource)))
    monkeypatch.setattr("app.services.dynamodb_store.get_settings", _settings)
    monkeypatch.setattr("app.services.dynamodb_store.boto3", fake_boto3)

    store = DynamoDBMirrorStore()
    ok = store.upsert_extraction_job_record(
        payload={
            "jobId": "job-1",
            "status": "completed",
            "filename": "bill.png",
            "documentId": "doc-1",
            "enginesUsed": ["google_vision", "bedrock"],
            "createdAt": "2026-03-08T00:00:00+00:00",
            "updatedAt": "2026-03-08T00:01:00+00:00",
            "completedAt": "2026-03-08T00:01:00+00:00",
        },
        user_id="u-1",
        merchant_user_id="m-1",
    )

    assert ok is True
    record = store.get_extraction_job_record("job-1")
    assert record is not None
    assert record.status == "completed"
    assert record.document_id == "doc-1"
    assert record.payload["filename"] == "bill.png"
