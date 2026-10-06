from __future__ import annotations

import logging
from typing import Any
from urllib.parse import unquote_plus

try:
    import boto3
except Exception:  # pragma: no cover - optional runtime dependency
    boto3 = None  # type: ignore[assignment]

try:
    import requests
except Exception:  # pragma: no cover - optional runtime dependency
    requests = None  # type: ignore[assignment]

from app.api.routes import _run_image_extraction_router
from app.core.config import get_settings

logger = logging.getLogger(__name__)


def _callback_url(job_id: str) -> str:
    settings = get_settings()
    base = str(settings.async_extraction_backend_callback_url or "").strip().rstrip("/")
    if not base:
        raise RuntimeError("ASYNC_EXTRACTION_BACKEND_CALLBACK_URL is not configured.")
    return f"{base}/api/v1/extraction-jobs/{job_id}/callback"


def _post_callback(job_id: str, payload: dict[str, Any]) -> None:
    settings = get_settings()
    token = str(settings.async_extraction_callback_token or "").strip()
    if not token:
        raise RuntimeError("ASYNC_EXTRACTION_CALLBACK_TOKEN is not configured.")
    if requests is None:
        raise RuntimeError("requests dependency is unavailable.")

    response = requests.post(
        _callback_url(job_id),
        headers={
            "Content-Type": "application/json",
            "X-Async-Extraction-Token": token,
        },
        json=payload,
        timeout=60,
    )
    response.raise_for_status()


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    settings = get_settings()
    if boto3 is None:
        raise RuntimeError("boto3 dependency is unavailable.")

    s3 = boto3.client("s3", region_name=settings.aws_region)
    processed: list[dict[str, str]] = []

    for record in event.get("Records", []) if isinstance(event, dict) else []:
        if not isinstance(record, dict):
            continue
        s3_record = record.get("s3")
        if not isinstance(s3_record, dict):
            continue
        bucket = str(((s3_record.get("bucket") or {}) if isinstance(s3_record.get("bucket"), dict) else {}).get("name") or "").strip()
        key = str(((s3_record.get("object") or {}) if isinstance(s3_record.get("object"), dict) else {}).get("key") or "").strip()
        if not bucket or not key:
            continue
        decoded_key = unquote_plus(key)
        metadata: dict[str, Any] = {}
        try:
            obj = s3.get_object(Bucket=bucket, Key=decoded_key)
            body = obj["Body"].read()
            metadata = obj.get("Metadata", {}) if isinstance(obj, dict) else {}
            if not isinstance(metadata, dict):
                metadata = {}
            job_id = str(metadata.get("job_id") or "").strip()
            filename = str(metadata.get("filename") or decoded_key.rsplit("/", 1)[-1] or "uploaded-image").strip()
            if not job_id:
                logger.warning("Skipping S3 object without job_id metadata: s3://%s/%s", bucket, decoded_key)
                continue

            routed = _run_image_extraction_router(
                image_bytes=body,
                filename=filename,
                supplied_ocr_text="",
                ocr_mode_override=(settings.async_extraction_ocr_mode or "hybrid"),
                bill_id=None,
                vendor=None,
                document_date=None,
                total_amount=None,
            )
            callback_payload = {
                "status": "completed",
                "extracted_text": str(routed.get("resolved_text") or ""),
                "extracted_metadata": (
                    routed.get("metadata") if isinstance(routed.get("metadata"), dict) else {}
                ),
                "field_confidences": (
                    routed.get("field_confidences") if isinstance(routed.get("field_confidences"), dict) else {}
                ),
                "field_sources": (
                    routed.get("field_sources") if isinstance(routed.get("field_sources"), dict) else {}
                ),
                "low_confidence_fields": (
                    routed.get("low_confidence_fields") if isinstance(routed.get("low_confidence_fields"), list) else []
                ),
                "engines_used": (
                    routed.get("engines_used") if isinstance(routed.get("engines_used"), list) else []
                ),
            }
        except Exception as exc:
            job_id = str(metadata.get("job_id") or "").strip() if isinstance(metadata, dict) else ""
            if job_id:
                _post_callback(
                    job_id,
                    {
                        "status": "failed",
                        "error_message": str(exc)[:2000],
                        "engines_used": ["async_s3_lambda"],
                    },
                )
                processed.append({"job_id": job_id, "status": "failed"})
            else:
                logger.exception("Async extraction failed before job_id resolution for s3://%s/%s", bucket, decoded_key)
            continue

        _post_callback(job_id, callback_payload)
        processed.append({"job_id": job_id, "status": "completed"})

    return {
        "processed": processed,
        "count": len(processed),
    }
