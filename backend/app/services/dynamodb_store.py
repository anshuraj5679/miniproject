from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

try:
    import boto3
except Exception:  # pragma: no cover - optional runtime dependency
    boto3 = None  # type: ignore[assignment]

try:
    from boto3.dynamodb.conditions import Key
except Exception:  # pragma: no cover - optional runtime dependency
    Key = None  # type: ignore[assignment]

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def _json_default(value: object) -> object:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Unsupported JSON value: {value!r}")


def _payload_to_json_text(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"), default=_json_default)


def _coerce_payload_dict(payload: object) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    normalized = json.loads(_payload_to_json_text(payload))
    return normalized if isinstance(normalized, dict) else {}


@dataclass
class DynamoDBStoredRecord:
    payload: dict[str, Any]
    user_id: str | None = None
    merchant_user_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    status: str | None = None
    document_id: str | None = None


class DynamoDBMirrorStore:
    def __init__(self) -> None:
        settings = get_settings()
        self.region = settings.aws_region
        self.documents_table_name = str(settings.dynamodb_documents_table_name or "").strip()
        self.extraction_jobs_table_name = str(settings.dynamodb_extraction_jobs_table_name or "").strip()
        self.user_created_at_index_name = str(settings.dynamodb_user_created_at_index_name or "").strip()
        self.merchant_created_at_index_name = str(settings.dynamodb_merchant_created_at_index_name or "").strip()
        self.enabled = bool(
            settings.dynamodb_mirror_enabled
            and boto3 is not None
            and self.documents_table_name
            and self.extraction_jobs_table_name
        )
        self.read_fallback_enabled = bool(settings.dynamodb_read_fallback_enabled)
        self.resource = None
        self.documents_table = None
        self.extraction_jobs_table = None

        if not self.enabled:
            return

        try:
            session = boto3.session.Session(region_name=self.region)
            self.resource = session.resource("dynamodb")
            self.documents_table = self.resource.Table(self.documents_table_name)
            self.extraction_jobs_table = self.resource.Table(self.extraction_jobs_table_name)
        except Exception:
            logger.exception("Failed to initialize DynamoDB mirror store.")
            self.enabled = False
            self.resource = None
            self.documents_table = None
            self.extraction_jobs_table = None

    def _put_item(self, table: object, item: dict[str, Any]) -> bool:
        if not self.enabled or table is None:
            return False
        try:
            table.put_item(Item=item)
            return True
        except Exception:
            logger.exception("Failed to put DynamoDB mirror item.")
            return False

    def _get_item(self, table: object, key_name: str, key_value: str) -> dict[str, Any] | None:
        if not self.enabled or table is None or not key_value:
            return None
        try:
            response = table.get_item(Key={key_name: key_value})
        except Exception:
            logger.exception("Failed to get DynamoDB mirror item key=%s", key_value)
            return None
        item = response.get("Item")
        return item if isinstance(item, dict) else None

    def _delete_item(self, table: object, key_name: str, key_value: str) -> bool:
        if not self.enabled or table is None or not key_value:
            return False
        try:
            table.delete_item(Key={key_name: key_value})
            return True
        except Exception:
            logger.exception("Failed to delete DynamoDB mirror item key=%s", key_value)
            return False

    def _query_by_partition(
        self,
        table: object,
        *,
        partition_key: str,
        partition_value: str,
        index_name: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        if not self.enabled or table is None or not partition_value:
            return []
        if not index_name or Key is None:
            return self._scan_records(
                table,
                predicate=lambda item: str(item.get(partition_key) or "").strip() == partition_value,
                limit=limit,
            )
        try:
            response = table.query(
                IndexName=index_name,
                KeyConditionExpression=Key(partition_key).eq(partition_value),
                ScanIndexForward=False,
                Limit=max(1, int(limit)),
            )
            items = response.get("Items", [])
            return [item for item in items if isinstance(item, dict)]
        except Exception:
            logger.exception(
                "Failed to query DynamoDB mirror partition=%s index=%s; falling back to scan.",
                partition_key,
                index_name,
            )
            return self._scan_records(
                table,
                predicate=lambda item: str(item.get(partition_key) or "").strip() == partition_value,
                limit=limit,
            )

    def _scan_records(
        self,
        table: object,
        *,
        predicate,
        limit: int,
    ) -> list[dict[str, Any]]:
        if not self.enabled or table is None:
            return []
        try:
            response = table.scan(Limit=max(1, int(limit * 4)))
        except Exception:
            logger.exception("Failed to scan DynamoDB mirror table.")
            return []
        items = [item for item in response.get("Items", []) if isinstance(item, dict)]
        filtered = [item for item in items if predicate(item)]
        filtered.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        return filtered[: max(1, int(limit))]

    @staticmethod
    def _record_from_item(item: dict[str, Any] | None) -> DynamoDBStoredRecord | None:
        if not isinstance(item, dict):
            return None
        payload_json = item.get("payload_json")
        payload: dict[str, Any] = {}
        if isinstance(payload_json, str) and payload_json.strip():
            try:
                parsed = json.loads(payload_json)
                if isinstance(parsed, dict):
                    payload = parsed
            except Exception:
                logger.exception("Failed to parse mirrored payload_json.")
                payload = {}
        elif isinstance(item.get("payload"), dict):
            payload = dict(item["payload"])
        if not payload:
            return None
        return DynamoDBStoredRecord(
            payload=payload,
            user_id=(str(item.get("user_id")).strip() if item.get("user_id") else None),
            merchant_user_id=(str(item.get("merchant_user_id")).strip() if item.get("merchant_user_id") else None),
            created_at=(str(item.get("created_at")).strip() if item.get("created_at") else None),
            updated_at=(str(item.get("updated_at")).strip() if item.get("updated_at") else None),
            status=(str(item.get("status")).strip() if item.get("status") else None),
            document_id=(str(item.get("document_id")).strip() if item.get("document_id") else None),
        )

    def upsert_document_record(self, *, payload: dict[str, Any]) -> bool:
        normalized = _coerce_payload_dict(payload)
        doc_id = str(normalized.get("docId") or "").strip()
        if not doc_id:
            return False
        item = {
            "doc_id": doc_id,
            "user_id": str(normalized.get("userId") or "").strip(),
            "merchant_user_id": str(normalized.get("assignedByMerchantId") or "").strip(),
            "created_at": str(normalized.get("createdAt") or "").strip(),
            "updated_at": str(normalized.get("updatedAt") or normalized.get("createdAt") or "").strip(),
            "seller_name": str(normalized.get("sellerName") or "").strip(),
            "title": str(normalized.get("title") or "").strip(),
            "status": str(normalized.get("status") or "").strip(),
            "payload_json": _payload_to_json_text(normalized),
        }
        return self._put_item(self.documents_table, item)

    def get_document_record(self, doc_id: str) -> DynamoDBStoredRecord | None:
        item = self._get_item(self.documents_table, "doc_id", str(doc_id or "").strip())
        return self._record_from_item(item)

    def list_document_records(
        self,
        *,
        user_id: str | None = None,
        merchant_user_id: str | None = None,
        limit: int = 100,
    ) -> list[DynamoDBStoredRecord]:
        safe_limit = max(1, int(limit))
        items: list[dict[str, Any]]
        if merchant_user_id:
            items = self._query_by_partition(
                self.documents_table,
                partition_key="merchant_user_id",
                partition_value=merchant_user_id,
                index_name=self.merchant_created_at_index_name,
                limit=safe_limit,
            )
        elif user_id:
            items = self._query_by_partition(
                self.documents_table,
                partition_key="user_id",
                partition_value=user_id,
                index_name=self.user_created_at_index_name,
                limit=safe_limit,
            )
        else:
            items = self._scan_records(self.documents_table, predicate=lambda _item: True, limit=safe_limit)

        records = [record for record in (self._record_from_item(item) for item in items) if record is not None]
        if user_id:
            records = [record for record in records if str(record.user_id or "") == user_id]
        if merchant_user_id:
            records = [record for record in records if str(record.merchant_user_id or "") == merchant_user_id]
        records.sort(key=lambda record: str(record.created_at or ""), reverse=True)
        return records[:safe_limit]

    def delete_document_record(self, doc_id: str) -> bool:
        return self._delete_item(self.documents_table, "doc_id", str(doc_id or "").strip())

    def upsert_extraction_job_record(
        self,
        *,
        payload: dict[str, Any],
        user_id: str | None = None,
        merchant_user_id: str | None = None,
    ) -> bool:
        normalized = _coerce_payload_dict(payload)
        job_id = str(normalized.get("jobId") or "").strip()
        if not job_id:
            return False
        item = {
            "job_id": job_id,
            "user_id": str(user_id or "").strip(),
            "merchant_user_id": str(merchant_user_id or "").strip(),
            "status": str(normalized.get("status") or "").strip(),
            "filename": str(normalized.get("filename") or "").strip(),
            "document_id": str(normalized.get("documentId") or "").strip(),
            "created_at": str(normalized.get("createdAt") or "").strip(),
            "updated_at": str(normalized.get("updatedAt") or normalized.get("createdAt") or "").strip(),
            "completed_at": str(normalized.get("completedAt") or "").strip(),
            "payload_json": _payload_to_json_text(normalized),
        }
        return self._put_item(self.extraction_jobs_table, item)

    def get_extraction_job_record(self, job_id: str) -> DynamoDBStoredRecord | None:
        item = self._get_item(self.extraction_jobs_table, "job_id", str(job_id or "").strip())
        return self._record_from_item(item)
