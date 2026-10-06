from __future__ import annotations

import base64
import io
import json
import logging
import mimetypes
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from datetime import date
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.orm import Session

try:
    import httpx
except Exception:  # pragma: no cover - optional runtime dependency
    httpx = None  # type: ignore[assignment]

from app.api.dependencies import ServiceRegistry, get_services
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import Principal, enforce_safe_query, require_roles
from app.models import (
    Chunk,
    Document,
    ExtractionReview,
    MerchantAssignmentAudit,
    NotificationDelivery,
    NotificationJob,
    SecurityAuditLog,
)
from app.parsers.pdf_parser import extract_invoice_metadata
from app.schemas import (
    AskRequest,
    AskResponse,
    CalendarLinkResponse,
    ClaimPacketResponse,
    Citation,
    ExtractionReviewConfirmRequest,
    ExtractionReviewQueueResponse,
    ExtractionReviewView,
    ExtractionTraceStep,
    MerchantAssignmentAcceptRequest,
    MerchantAssignmentAuditResponse,
    MerchantAssignmentAuditView,
    MerchantActivityItem,
    MerchantActivityResponse,
    MerchantAssignRequest,
    MerchantIssueBillResponse,
    MerchantManualBillRequest,
    DocumentsResponse,
    DocumentView,
    IngestPDFResponse,
    IngestVendorTableResponse,
    NotificationAnalyticsResponse,
    NotificationDeliverabilityDashboardResponse,
    NotificationItem,
    NotificationPreferenceUpdateRequest,
    NotificationPreferenceView,
    NotificationProviderEventIngestRequest,
    NotificationProcessResult,
    NotificationsResponse,
    PlannerOutput,
    PlannerStep,
    RemindersResponse,
    ReminderView,
    SearchRequest,
    SearchResponse,
    SearchResult,
    ServiceCenterView,
    WarrantyItemView,
)
from app.services.embeddings import build_embedding_text
from app.services.date_utils import add_months
from app.services.extraction_pipeline import (
    build_review_fields,
    compute_field_confidences,
    ensure_strict_extraction,
    estimate_claim_readiness,
    estimate_text_quality,
    extraction_fingerprint,
    merge_engine_results,
)
from app.services.gst_compliance import validate_invoice_compliance
from app.services.notifications import NotificationService
from app.services.qa_logging import create_qa_log
from app.services.rate_limiter import rate_limiter
from app.services.service_centers import ServiceCenterCandidate

try:
    import pytesseract
except Exception:  # pragma: no cover - optional runtime dependency
    pytesseract = None

try:
    from PIL import Image
except Exception:  # pragma: no cover - optional runtime dependency
    Image = None  # type: ignore[assignment]

router = APIRouter(prefix="/api/v1", tags=["safebill-rag"])
_notification_service = NotificationService()
logger = logging.getLogger(__name__)


def _safe_session_commit(db: Session) -> None:
    if hasattr(db, "commit"):
        db.commit()


def _resolve_client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",", 1)[0].strip()[:128]
    if request.client and request.client.host:
        return str(request.client.host)[:128]
    return None


def _log_security_event(
    db: Session,
    *,
    event_type: str,
    principal: Principal | None,
    resource: str | None,
    request: Request | None,
    metadata: dict[str, object] | None = None,
) -> None:
    safe_metadata = metadata or {}
    try:
        entry = SecurityAuditLog(
            event_type=event_type[:64],
            actor_role=(principal.role[:64] if principal else None),
            user_id=(principal.subject[:128] if principal and principal.subject else None),
            resource=(resource[:255] if resource else None),
            client_ip=_resolve_client_ip(request),
            event_metadata=safe_metadata,
        )
        db.add(entry)
        _safe_session_commit(db)
    except Exception:
        logger.exception("Failed to write security audit event=%s", event_type)
        if hasattr(db, "rollback"):
            try:
                db.rollback()
            except Exception:
                pass


def _rate_limit_or_429(
    *,
    request: Request | None,
    principal: Principal,
    bucket: str,
    limit: int,
) -> None:
    settings = get_settings()
    window_seconds = max(1, int(settings.api_rate_limit_window_seconds))
    identity = principal.subject or _resolve_client_ip(request) or "anonymous"
    allowed, retry_after = rate_limiter.allow(
        bucket=bucket,
        key=identity,
        limit=max(1, limit),
        window_seconds=window_seconds,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "message": "Too many requests. Please retry shortly.",
                "bucket": bucket,
                "retry_after_seconds": retry_after,
            },
        )


def _coerce_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _coerce_int(value: object, default: int | None = None) -> int | None:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_float(value: object, default: float | None = None) -> float | None:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_bool(value: object, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "y"}:
            return True
        if lowered in {"false", "0", "no", "n"}:
            return False
    return bool(value)


def _first_meaningful_line(text: str, fallback: str) -> str:
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if len(line) < 4:
            continue
        if len(line) > 120:
            continue
        if re.fullmatch(r"[\W_]+", line):
            continue
        return line
    return fallback


def _ocr_image_bytes(image_bytes: bytes) -> str:
    if not image_bytes or Image is None or pytesseract is None:
        return ""

    settings = get_settings()
    if settings.tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd

    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            return (pytesseract.image_to_string(image) or "").strip()
    except Exception:
        return ""


def _looks_like_ui_screenshot(text: str) -> bool:
    lowered = (text or "").lower()
    ui_markers = [
        "merchant dashboard",
        "consumer sync",
        "assign uploaded bill",
        "generate manual bill",
        "digital locker",
        "all warranties",
        "scan invoice",
    ]
    hits = sum(1 for marker in ui_markers if marker in lowered)
    return hits >= 2


def _is_meaningful_metadata_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True


def _merge_invoice_metadata(
    preferred: dict[str, object] | None,
    fallback: dict[str, object],
) -> dict[str, object]:
    merged = dict(fallback)
    if not preferred:
        return merged
    for key, value in preferred.items():
        if not _is_meaningful_metadata_value(value):
            continue
        merged[key] = value
    return merged


def _normalize_openai_invoice_metadata(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict):
        return {}

    normalized: dict[str, object] = {}
    textual_keys = {
        "bill_id",
        "vendor",
        "date",
        "vendor_tax_id",
        "product_name",
        "brand",
        "serial_number",
        "warranty_start",
        "warranty_end",
        "category",
    }
    numeric_keys = {
        "total_amount",
        "taxable_amount",
        "gst_amount",
        "gst_rate",
        "cgst_amount",
        "sgst_amount",
        "igst_amount",
    }

    for key in textual_keys:
        value = raw.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            normalized[key] = text

    for key in numeric_keys:
        value = _coerce_float(raw.get(key))
        if value is not None:
            normalized[key] = value

    warranty_months = _coerce_int(raw.get("warranty_months"))
    if warranty_months is not None and warranty_months > 0:
        normalized["warranty_months"] = warranty_months

    line_items_value = raw.get("line_items")
    if isinstance(line_items_value, list):
        filtered_items: list[dict[str, object]] = []
        for item in line_items_value:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            amount = _coerce_float(item.get("amount"))
            quantity = _coerce_float(item.get("quantity"))
            unit_price = _coerce_float(item.get("unit_price"))
            normalized_item: dict[str, object] = {}
            if name:
                normalized_item["name"] = name[:255]
            if amount is not None:
                normalized_item["amount"] = amount
            if quantity is not None:
                normalized_item["quantity"] = quantity
            if unit_price is not None:
                normalized_item["unit_price"] = unit_price
            if normalized_item:
                filtered_items.append(normalized_item)
        if filtered_items:
            normalized["line_items"] = filtered_items[:50]

    return normalized


def _metadata_to_canonical_text(metadata: dict[str, object]) -> str:
    lines: list[str] = []
    bill_id = str(metadata.get("bill_id") or "").strip()
    vendor = str(metadata.get("vendor") or "").strip()
    invoice_date = str(metadata.get("date") or "").strip()
    total_amount = _coerce_float(metadata.get("total_amount"))
    product_name = str(metadata.get("product_name") or "").strip()
    vendor_tax_id = str(metadata.get("vendor_tax_id") or "").strip()

    if bill_id:
        lines.append(f"Invoice Number: {bill_id}")
    if vendor:
        lines.append(f"Vendor: {vendor}")
    if invoice_date:
        lines.append(f"Invoice Date: {invoice_date}")
    if total_amount is not None:
        lines.append(f"Total Amount: INR {total_amount:.2f}")
    if product_name:
        lines.append(f"Product Name: {product_name}")
    if vendor_tax_id:
        lines.append(f"GST Registration No: {vendor_tax_id}")

    line_items = metadata.get("line_items")
    if isinstance(line_items, list) and line_items:
        lines.append("Line Items:")
        for item in line_items[:20]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            amount = _coerce_float(item.get("amount"))
            if not name and amount is None:
                continue
            if amount is None:
                lines.append(f"- {name}")
            else:
                lines.append(f"- {name or 'Item'}: INR {amount:.2f}")

    return "\n".join(lines).strip()


def _normalize_locker_category(value: object) -> str | None:
    if value is None:
        return None
    raw = str(value).strip().lower()
    if not raw:
        return None

    direct = {
        "gadgets": "Gadgets",
        "gadget": "Gadgets",
        "electronics": "Gadgets",
        "electronic": "Gadgets",
        "appliances": "Appliances",
        "appliance": "Appliances",
        "home appliance": "Appliances",
        "home appliances": "Appliances",
        "vehicle": "Vehicle",
        "vehicles": "Vehicle",
        "automotive": "Vehicle",
        "others": "Others",
        "other": "Others",
    }
    if raw in direct:
        return direct[raw]
    return None


def _infer_locker_category(
    *,
    product_name: str | None,
    brand: str | None,
    vendor: str | None,
    line_items: list[dict[str, object]] | None,
    source_category: object = None,
) -> str:
    normalized_source = _normalize_locker_category(source_category)
    if normalized_source and normalized_source != "Others":
        return normalized_source

    combined_parts = [product_name or "", brand or "", vendor or ""]
    if line_items:
        for item in line_items[:30]:
            if not isinstance(item, dict):
                continue
            combined_parts.append(str(item.get("name") or ""))
    combined = " ".join(combined_parts).lower()
    combined = re.sub(r"\s+", " ", combined).strip()

    vehicle_tokens = (
        "car",
        "bike",
        "scooter",
        "motorcycle",
        "vehicle",
        "automotive",
        "tractor",
        "tyre",
        "helmet",
    )
    if any(token in combined for token in vehicle_tokens):
        return "Vehicle"

    appliance_tokens = (
        "refrigerator",
        "fridge",
        "washing machine",
        "microwave",
        "oven",
        "air conditioner",
        "airconditioner",
        "ac ",
        "geyser",
        "dishwasher",
        "television",
        "smart tv",
        "tv ",
        "vacuum",
        "water purifier",
        "chimney",
        "appliance",
    )
    if any(token in combined for token in appliance_tokens):
        return "Appliances"

    gadget_tokens = (
        "phone",
        "mobile",
        "smartphone",
        "iphone",
        "pixel",
        "tablet",
        "ipad",
        "laptop",
        "notebook",
        "ultrabook",
        "macbook",
        "desktop",
        "monitor",
        "camera",
        "dslr",
        "headphone",
        "earbud",
        "watch",
        "smartwatch",
        "printer",
        "router",
        "ssd",
        "hdd",
        "gpu",
        "processor",
        "hsn:8517",
    )
    gadget_brands = (
        "nokia",
        "samsung",
        "apple",
        "oneplus",
        "xiaomi",
        "redmi",
        "realme",
        "oppo",
        "vivo",
        "motorola",
        "google",
        "sony",
        "lenovo",
        "dell",
        "hp",
        "asus",
        "acer",
        "msi",
        "canon",
        "nikon",
        "boat",
        "jbl",
        "logitech",
    )
    if any(token in combined for token in gadget_tokens) or any(brand_token in combined for brand_token in gadget_brands):
        return "Gadgets"

    return "Others"


def _extract_image_metadata_with_openai(image_bytes: bytes, filename: str) -> dict[str, object]:
    settings = get_settings()
    if not image_bytes:
        return {}
    if not settings.openai_api_key or httpx is None:
        return {}
    if os.getenv("PYTEST_CURRENT_TEST"):
        return {}

    model = (settings.openai_chat_model or "").strip() or "gpt-4.1-mini"
    mime_type = mimetypes.guess_type(filename)[0] or "image/png"
    encoded = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{encoded}"
    system_prompt = (
        "You are an invoice data extraction engine. "
        "Return only JSON. Do not guess missing values. Use null for missing fields. "
        "Dates must be ISO 8601 format (YYYY-MM-DD). Convert from formats like 10-Feb-2026 if present. "
        "Only set monetary fields when they are explicitly shown as money (currency symbol/code or labels like TOTAL/AMOUNT/MRP/PRICE). "
        "Never treat product dimensions (e.g., '42-inch'), model numbers, serial numbers, warranty months, phone numbers, or addresses as amounts. "
        "Extract these keys exactly: "
        "bill_id, vendor, date, total_amount, vendor_tax_id, taxable_amount, gst_amount, gst_rate, "
        "cgst_amount, sgst_amount, igst_amount, product_name, brand, serial_number, warranty_months, "
        "warranty_start, warranty_end, category, line_items. "
        "For line_items, return an array of objects with keys: name, quantity, unit_price, amount."
    )
    user_prompt = (
        "Extract invoice fields from this bill image. "
        "Keep original invoice number formatting and correct decimal amounts. "
        "If multiple totals appear, prefer grand total/final total."
    )
    payload = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
    }
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
        if response.status_code >= 400:
            return {}
        response_payload = response.json()
        raw_content = (
            response_payload.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "{}")
        )
        if not isinstance(raw_content, str):
            return {}
        parsed = json.loads(raw_content)
    except Exception:
        return {}

    return _normalize_openai_invoice_metadata(parsed)


def _extract_image_metadata_with_proxy(
    *,
    image_bytes: bytes,
    filename: str,
    proxy_url: str,
    proxy_api_key: str,
) -> tuple[dict[str, object], str]:
    if not image_bytes or not proxy_url or httpx is None:
        return {}, ""
    if os.getenv("PYTEST_CURRENT_TEST"):
        return {}, ""

    encoded = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "filename": filename,
        "image_base64": encoded,
    }
    headers = {"Content-Type": "application/json"}
    token = (proxy_api_key or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(proxy_url, headers=headers, json=payload)
        if response.status_code >= 400:
            return {}, ""
        parsed = response.json()
    except Exception:
        return {}, ""

    metadata: dict[str, object] = {}
    text = ""
    if isinstance(parsed, dict):
        raw_metadata = parsed.get("metadata")
        if isinstance(raw_metadata, dict):
            metadata = raw_metadata
        elif isinstance(parsed.get("result"), dict):
            metadata = parsed["result"]  # type: ignore[index]
        raw_text = parsed.get("text")
        if isinstance(raw_text, str):
            text = raw_text.strip()
    return ensure_strict_extraction(metadata), text


def _manual_override_metadata(
    *,
    bill_id: str | None,
    vendor: str | None,
    document_date: date | None,
    total_amount: float | None,
) -> dict[str, object]:
    payload: dict[str, object] = {}
    if bill_id:
        payload["bill_id"] = bill_id.strip()[:128]
    if vendor:
        payload["vendor"] = vendor.strip()[:255]
    if document_date:
        payload["date"] = document_date.isoformat()
    if total_amount is not None:
        payload["total_amount"] = total_amount
    return payload


def _run_image_extraction_router(
    *,
    image_bytes: bytes,
    filename: str,
    supplied_ocr_text: str,
    bill_id: str | None,
    vendor: str | None,
    document_date: date | None,
    total_amount: float | None,
) -> dict[str, object]:
    settings = get_settings()
    engine_results: list[dict[str, object]] = []

    supplied_text = supplied_ocr_text.strip()
    if supplied_text:
        metadata = ensure_strict_extraction(extract_invoice_metadata(supplied_text, filename))
        engine_results.append(
            {
                "engine": "tesseract_regex",
                "metadata": metadata,
                "text": supplied_text,
                "field_confidences": compute_field_confidences(
                    metadata=metadata,
                    engine="tesseract_regex",
                    text_quality=estimate_text_quality(supplied_text),
                ),
            }
        )

    tesseract_text = _ocr_image_bytes(image_bytes)
    if tesseract_text and tesseract_text.strip() and tesseract_text.strip() != supplied_text:
        tesseract_metadata = ensure_strict_extraction(extract_invoice_metadata(tesseract_text, filename))
        engine_results.append(
            {
                "engine": "tesseract_regex",
                "metadata": tesseract_metadata,
                "text": tesseract_text,
                "field_confidences": compute_field_confidences(
                    metadata=tesseract_metadata,
                    engine="tesseract_regex",
                    text_quality=estimate_text_quality(tesseract_text),
                ),
            }
        )

    openai_metadata = ensure_strict_extraction(_extract_image_metadata_with_openai(image_bytes, filename))
    if any(_is_meaningful_metadata_value(openai_metadata.get(key)) for key in ("bill_id", "vendor", "total_amount", "date")):
        canonical_text = _metadata_to_canonical_text(openai_metadata)
        engine_results.append(
            {
                "engine": "openai_vision",
                "metadata": openai_metadata,
                "text": canonical_text,
                "field_confidences": compute_field_confidences(
                    metadata=openai_metadata,
                    engine="openai_vision",
                    text_quality=estimate_text_quality(canonical_text),
                ),
            }
        )

    if settings.textract_proxy_url:
        textract_metadata, textract_text = _extract_image_metadata_with_proxy(
            image_bytes=image_bytes,
            filename=filename,
            proxy_url=settings.textract_proxy_url.strip(),
            proxy_api_key=settings.textract_proxy_api_key,
        )
        if any(
            _is_meaningful_metadata_value(textract_metadata.get(key))
            for key in ("bill_id", "vendor", "total_amount", "date")
        ):
            engine_results.append(
                {
                    "engine": "aws_textract",
                    "metadata": textract_metadata,
                    "text": (textract_text or _metadata_to_canonical_text(textract_metadata)),
                    "field_confidences": compute_field_confidences(
                        metadata=textract_metadata,
                        engine="aws_textract",
                        text_quality=estimate_text_quality(textract_text),
                    ),
                }
            )

    if settings.docai_proxy_url:
        docai_metadata, docai_text = _extract_image_metadata_with_proxy(
            image_bytes=image_bytes,
            filename=filename,
            proxy_url=settings.docai_proxy_url.strip(),
            proxy_api_key=settings.docai_proxy_api_key,
        )
        if any(_is_meaningful_metadata_value(docai_metadata.get(key)) for key in ("bill_id", "vendor", "total_amount", "date")):
            engine_results.append(
                {
                    "engine": "google_docai",
                    "metadata": docai_metadata,
                    "text": (docai_text or _metadata_to_canonical_text(docai_metadata)),
                    "field_confidences": compute_field_confidences(
                        metadata=docai_metadata,
                        engine="google_docai",
                        text_quality=estimate_text_quality(docai_text),
                    ),
                }
            )

    manual_overrides = _manual_override_metadata(
        bill_id=bill_id,
        vendor=vendor,
        document_date=document_date,
        total_amount=total_amount,
    )
    if manual_overrides:
        engine_results.append(
            {
                "engine": "manual_override",
                "metadata": ensure_strict_extraction(manual_overrides),
                "text": _metadata_to_canonical_text(manual_overrides),
                "field_confidences": compute_field_confidences(
                    metadata=manual_overrides,
                    engine="manual_override",
                    text_quality=1.0,
                ),
            }
        )

    merged_metadata, field_confidences, field_sources = merge_engine_results(
        engine_results,
        manual_overrides=manual_overrides,
    )
    low_conf_fields = build_review_fields(
        field_confidences,
        threshold=float(settings.extraction_review_required_threshold),
    )
    candidate_texts = [
        str(result.get("text") or "").strip()
        for result in engine_results
        if str(result.get("text") or "").strip()
    ]
    resolved_text = supplied_text or (max(candidate_texts, key=len) if candidate_texts else "")
    if not resolved_text:
        resolved_text = _metadata_to_canonical_text(merged_metadata)

    return {
        "metadata": merged_metadata,
        "resolved_text": resolved_text,
        "field_confidences": field_confidences,
        "field_sources": field_sources,
        "low_confidence_fields": low_conf_fields,
        "engines_used": [str(result.get("engine") or "unknown") for result in engine_results],
        "engine_results": engine_results,
    }


def _persist_structured_document(
    db: Session,
    services: ServiceRegistry,
    *,
    filename: str,
    source: str,
    user_id: str | None,
    extracted_text: str,
    extracted_metadata: dict[str, object] | None = None,
    bill_id: str | None = None,
    vendor: str | None = None,
    document_date: date | None = None,
    total_amount: float | None = None,
    version: int = 1,
    field_confidences: dict[str, float] | None = None,
    field_sources: dict[str, str] | None = None,
    low_confidence_fields: list[str] | None = None,
    extraction_engines: list[str] | None = None,
    additional_references: dict[str, object] | None = None,
) -> tuple[Document, int]:
    settings = get_settings()
    fallback_metadata = ensure_strict_extraction(extract_invoice_metadata(extracted_text, filename))
    preferred_metadata = ensure_strict_extraction(extracted_metadata or {})
    metadata = ensure_strict_extraction(_merge_invoice_metadata(preferred_metadata, fallback_metadata))

    if bill_id:
        metadata["bill_id"] = bill_id.strip()[:128]
    if vendor:
        metadata["vendor"] = vendor.strip()[:255]
    if document_date:
        metadata["date"] = document_date.isoformat()
    if total_amount is not None:
        metadata["total_amount"] = total_amount

    fallback_bill = f"{source.upper()}-{int(time.time() * 1000)}"
    resolved_bill_id = str(bill_id or metadata.get("bill_id") or fallback_bill)[:128]
    resolved_vendor = str(vendor or metadata.get("vendor") or "UNKNOWN_VENDOR")[:256]
    resolved_date = document_date if document_date is not None else _coerce_date(metadata.get("date"))
    resolved_total = total_amount if total_amount is not None else _coerce_float(metadata.get("total_amount"))

    title_fallback = filename.rsplit(".", 1)[0] if filename else "Uploaded Document"
    extracted_product_name = str(metadata.get("product_name") or "").strip()
    title = extracted_product_name or _first_meaningful_line(extracted_text, fallback=title_fallback)
    existing_id = (
        db.execute(select(Document.id).where(Document.bill_id == resolved_bill_id, Document.version == version).limit(1))
        .scalar_one_or_none()
    )
    if existing_id:
        suffix = int(time.time() * 1000) % 1_000_000
        base = resolved_bill_id[:120]
        resolved_bill_id = f"{base}-{suffix}"

    extracted_warranty_months = _coerce_int(metadata.get("warranty_months"), default=12) or 12
    extracted_warranty_start = _coerce_date(metadata.get("warranty_start")) or resolved_date
    extracted_warranty_end = _coerce_date(metadata.get("warranty_end"))
    if extracted_warranty_end is None and extracted_warranty_start:
        extracted_warranty_end = add_months(extracted_warranty_start, extracted_warranty_months)
    metadata_line_items = metadata.get("line_items")
    inferred_category = _infer_locker_category(
        product_name=(extracted_product_name or title),
        brand=str(metadata.get("brand") or resolved_vendor),
        vendor=resolved_vendor,
        line_items=(
            [item for item in metadata_line_items if isinstance(item, dict)]
            if isinstance(metadata_line_items, list)
            else None
        ),
        source_category=metadata.get("category"),
    )
    extraction_confidences = dict(field_confidences or {})
    if not extraction_confidences:
        extraction_confidences = compute_field_confidences(
            metadata=metadata,
            engine="tesseract_regex",
            text_quality=estimate_text_quality(extracted_text),
        )
    extraction_sources = dict(field_sources or {})
    if not extraction_sources:
        extraction_sources = {field: source for field in extraction_confidences}
    extracted_low_confidence = list(low_confidence_fields or [])
    if not extracted_low_confidence:
        extracted_low_confidence = build_review_fields(
            extraction_confidences,
            threshold=float(settings.extraction_review_required_threshold),
        )

    fingerprint = extraction_fingerprint(metadata, extracted_text)
    duplicate_count = 0
    if user_id:
        duplicate_stmt = select(func.count(Document.id)).where(
            Document.references["user_id"].as_string() == (user_id or "anonymous"),
            or_(
                Document.bill_id == resolved_bill_id,
                Document.references["extraction_fingerprint"].as_string() == fingerprint,
            ),
        )
        duplicate_count = int(db.execute(duplicate_stmt).scalar_one_or_none() or 0)
    duplicate_flag = duplicate_count > 0

    references: dict[str, object] = {
        "filename": filename,
        "source": source,
        "user_id": user_id or "anonymous",
        "title": title,
        "product_name": title,
        "brand": str(metadata.get("brand") or resolved_vendor),
        "category": inferred_category,
        "is_verified": True,
        "raw_text": extracted_text[:50000],
        "ocr_confidence": (
            round(sum(extraction_confidences.values()) / max(len(extraction_confidences), 1), 4)
            if extraction_confidences
            else (0.7 if source == "image_ocr" else 1.0)
        ),
        "warranty_months": extracted_warranty_months,
        "extraction_confidence": extraction_confidences,
        "extraction_field_sources": extraction_sources,
        "low_confidence_fields": extracted_low_confidence,
        "extraction_review_required": len(extracted_low_confidence) > 0,
        "extraction_engines": extraction_engines or [source],
        "extraction_fingerprint": fingerprint,
        "duplicate_suspected": duplicate_flag,
        "duplicate_match_count": duplicate_count,
        "strict_schema_version": "invoice.v1",
    }
    if additional_references:
        for key, value in additional_references.items():
            if value is None or value == "":
                continue
            references[key] = value
    if metadata.get("vendor_tax_id"):
        references["vendor_tax_id"] = str(metadata["vendor_tax_id"])
    for tax_key in ("taxable_amount", "gst_amount", "gst_rate", "cgst_amount", "sgst_amount", "igst_amount"):
        tax_value = _coerce_float(metadata.get(tax_key))
        if tax_value is not None and references.get(tax_key) is None:
            references[tax_key] = tax_value
    if isinstance(metadata_line_items, list) and metadata_line_items and not references.get("line_items"):
        references["line_items"] = [item for item in metadata_line_items if isinstance(item, dict)][:50]
    if metadata.get("serial_number") and not references.get("serial_number"):
        references["serial_number"] = str(metadata["serial_number"])
    if extracted_warranty_start and not references.get("warranty_start"):
        references["warranty_start"] = extracted_warranty_start.isoformat()
    if extracted_warranty_end and not references.get("warranty_end"):
        references["warranty_end"] = extracted_warranty_end.isoformat()

    compliance_input = {
        "bill_id": resolved_bill_id,
        "vendor": resolved_vendor,
        "date": (resolved_date.isoformat() if resolved_date else None),
        "total_amount": resolved_total,
        "vendor_tax_id": references.get("vendor_tax_id"),
        "taxable_amount": references.get("taxable_amount"),
        "gst_amount": references.get("gst_amount"),
        "gst_rate": references.get("gst_rate"),
        "cgst_amount": references.get("cgst_amount"),
        "sgst_amount": references.get("sgst_amount"),
        "igst_amount": references.get("igst_amount"),
        "line_items": references.get("line_items"),
    }
    compliance_payload = validate_invoice_compliance(
        metadata=compliance_input,
        raw_text=str(references.get("raw_text") or ""),
    )
    references["compliance"] = compliance_payload
    references["compliance_status"] = str(compliance_payload.get("status") or "watch")
    references["compliance_score"] = int(compliance_payload.get("score") or 0)
    if not references.get("vendor_tax_id"):
        gstin_payload = compliance_payload.get("gstin")
        if isinstance(gstin_payload, dict) and gstin_payload.get("value"):
            references["vendor_tax_id"] = str(gstin_payload["value"])

    document = Document(
        bill_id=resolved_bill_id,
        vendor=resolved_vendor,
        date=resolved_date,
        total_amount=resolved_total,
        version=version,
        references=references,
    )
    db.add(document)
    db.flush()

    metadata_content = {
        "bill_id": resolved_bill_id,
        "vendor": resolved_vendor,
        "date": resolved_date.isoformat() if resolved_date else None,
        "total_amount": resolved_total,
        "vendor_tax_id": references.get("vendor_tax_id"),
        "taxable_amount": references.get("taxable_amount"),
        "gst_amount": references.get("gst_amount"),
        "gst_rate": references.get("gst_rate"),
        "cgst_amount": references.get("cgst_amount"),
        "sgst_amount": references.get("sgst_amount"),
        "igst_amount": references.get("igst_amount"),
        "product_name": references.get("product_name"),
        "brand": references.get("brand"),
        "category": references.get("category"),
        "serial_number": references.get("serial_number"),
        "warranty_months": references.get("warranty_months"),
        "warranty_start": references.get("warranty_start"),
        "warranty_end": references.get("warranty_end"),
        "compliance_status": references.get("compliance_status"),
        "compliance_score": references.get("compliance_score"),
        "line_items": references.get("line_items"),
        "is_scanned": source == "image_ocr",
    }
    chunk_inputs: list[tuple[str, str, dict[str, str]]] = [
        ("invoice_metadata", json.dumps(metadata_content, ensure_ascii=True), {"section": "metadata", "source": source}),
    ]
    body_content = extracted_text.strip()
    if body_content:
        chunk_inputs.append(("body_section", body_content[:12000], {"section": "ocr_text", "source": source}))
    if isinstance(references.get("line_items"), list):
        line_items_content = json.dumps(references.get("line_items"), ensure_ascii=True)
        if line_items_content and line_items_content != "[]":
            chunk_inputs.append(("line_items", line_items_content[:12000], {"section": "line_items", "source": source}))

    chunk_records: list[Chunk] = []
    embedding_inputs: list[str] = []
    for chunk_type, content, metadata_json in chunk_inputs:
        chunk_id = uuid.uuid4()
        generated = services.ingestion.metadata_generator.generate(
            content=content,
            chunk_type=chunk_type,
            document_id=str(document.id),
            chunk_id=str(chunk_id),
        )
        embedding_inputs.append(
            build_embedding_text(
                content=content,
                summary=generated["summary"],
                keywords=generated["keywords"],
                hypothetical_questions=generated["hypothetical_questions"],
            )
        )
        chunk_records.append(
            Chunk(
                id=chunk_id,
                document_id=document.id,
                chunk_type=chunk_type,
                content=content,
                summary=generated["summary"],
                keywords=generated["keywords"],
                hypothetical_questions=generated["hypothetical_questions"],
                metadata_json=metadata_json,
            )
        )

    vectors = services.ingestion.embedding_service.embed_batch(embedding_inputs)
    for chunk, vector in zip(chunk_records, vectors):
        chunk.embedding_vector = vector
        db.add(chunk)

    review_record: ExtractionReview | None = None
    if references.get("user_id") and str(references.get("user_id")) != "anonymous":
        review_record = ExtractionReview(
            document_id=document.id,
            user_id=str(references["user_id"]),
            status=("pending" if extracted_low_confidence else "confirmed"),
            field_confidences=extraction_confidences,
            low_confidence_fields=extracted_low_confidence,
            extracted_fields=metadata,
            confirmed_fields={},
            reviewer_user_id=(str(references["user_id"]) if not extracted_low_confidence else None),
            reviewed_at=(datetime.now(timezone.utc) if not extracted_low_confidence else None),
        )
        db.add(review_record)

    merchant_user_id = str(references.get("merchant_user_id") or "").strip()
    consumer_user_id = str(references.get("user_id") or "").strip()
    assignment_source = str(references.get("assignment_source") or "").strip()
    if merchant_user_id and consumer_user_id and assignment_source in {"merchant_upload", "merchant_manual"}:
        assignment_audit = MerchantAssignmentAudit(
            document_id=document.id,
            merchant_user_id=merchant_user_id,
            consumer_user_id=consumer_user_id,
            status="assigned",
            assignment_source=assignment_source,
            notes="Auto-created during merchant ingestion workflow",
        )
        db.add(assignment_audit)

    db.commit()
    db.refresh(document)
    if review_record is not None:
        try:
            db.refresh(review_record)
        except Exception:
            pass
    try:
        services.ingestion._upsert_pinecone_vectors(document, chunk_records)  # type: ignore[attr-defined]
    except Exception:
        pass
    return document, len(chunk_records)


def _safe_references(document: Document) -> dict:
    references = getattr(document, "references", None)
    return references if isinstance(references, dict) else {}


def _schedule_document_notifications(
    db: Session,
    document: Document,
    *,
    consumer_user_id: str | None,
    consumer_email: str | None,
    consumer_name: str | None,
) -> None:
    references = _safe_references(document)
    resolved_user_id = str(consumer_user_id or references.get("user_id") or "").strip()
    resolved_email = str(consumer_email or references.get("consumer_email") or "").strip()
    resolved_name = str(consumer_name or references.get("consumer_name") or "").strip()
    resolved_merchant_user_id = str(references.get("merchant_user_id") or "").strip()
    if not resolved_user_id:
        return
    try:
        _notification_service.schedule_document_notifications(
            db,
            document=document,
            consumer_user_id=resolved_user_id,
            consumer_email=(resolved_email or None),
            consumer_name=(resolved_name or None),
            merchant_user_id=(resolved_merchant_user_id or None),
        )
    except Exception:
        logger.exception(
            "Notification scheduling failed for document_id=%s user_id=%s merchant_user_id=%s",
            str(document.id),
            resolved_user_id,
            resolved_merchant_user_id,
        )
        if hasattr(db, "rollback"):
            try:
                db.rollback()
            except Exception:
                pass


def _cancel_document_notifications(db: Session, *, document_id: UUID) -> None:
    try:
        _notification_service.cancel_document_jobs(db, document_id=document_id)
    except Exception:
        logger.exception(
            "Notification cancel failed for document_id=%s",
            str(document_id),
        )
        if hasattr(db, "rollback"):
            try:
                db.rollback()
            except Exception:
                pass


def _ensure_extraction_review_for_document(db: Session, *, document: Document) -> None:
    existing = db.execute(
        select(ExtractionReview)
        .where(ExtractionReview.document_id == document.id)
        .limit(1)
    ).scalar_one_or_none()
    if existing is not None:
        return

    references = _safe_references(document).copy()
    user_id = str(references.get("user_id") or "").strip()
    if not user_id or user_id == "anonymous":
        return

    extracted_fields = ensure_strict_extraction(
        {
            "bill_id": document.bill_id,
            "vendor": document.vendor,
            "date": (document.date.isoformat() if document.date else None),
            "total_amount": (float(document.total_amount) if document.total_amount is not None else None),
            "vendor_tax_id": references.get("vendor_tax_id"),
            "taxable_amount": references.get("taxable_amount"),
            "gst_amount": references.get("gst_amount"),
            "gst_rate": references.get("gst_rate"),
            "cgst_amount": references.get("cgst_amount"),
            "sgst_amount": references.get("sgst_amount"),
            "igst_amount": references.get("igst_amount"),
            "product_name": references.get("product_name"),
            "brand": references.get("brand"),
            "serial_number": references.get("serial_number"),
            "warranty_months": references.get("warranty_months"),
            "warranty_start": references.get("warranty_start"),
            "warranty_end": references.get("warranty_end"),
            "category": references.get("category"),
            "line_items": references.get("line_items"),
        }
    )
    confidence_map = (
        references.get("extraction_confidence")
        if isinstance(references.get("extraction_confidence"), dict)
        else {}
    )
    if not confidence_map:
        confidence_map = compute_field_confidences(
            metadata=extracted_fields,
            engine="tesseract_regex",
            text_quality=estimate_text_quality(str(references.get("raw_text") or "")),
        )
    low_conf = build_review_fields(
        confidence_map,
        threshold=float(get_settings().extraction_review_required_threshold),
    )
    review = ExtractionReview(
        document_id=document.id,
        user_id=user_id,
        status=("pending" if low_conf else "confirmed"),
        field_confidences=confidence_map,
        low_confidence_fields=low_conf,
        extracted_fields=extracted_fields,
        confirmed_fields={},
        reviewer_user_id=(user_id if not low_conf else None),
        reviewed_at=(datetime.now(timezone.utc) if not low_conf else None),
    )
    db.add(review)

    references["extraction_confidence"] = confidence_map
    references["low_confidence_fields"] = low_conf
    references["extraction_review_required"] = bool(low_conf)
    references["extraction_review_status"] = ("pending" if low_conf else "confirmed")
    document.references = references
    db.add(document)
    db.commit()
    db.refresh(document)


def _mark_document_consumer_activated(db: Session, *, document: Document, consumer_user_id: str) -> None:
    references = _safe_references(document).copy()
    if str(references.get("user_id") or "").strip() != consumer_user_id:
        return
    if references.get("consumer_activated_at"):
        return
    references["consumer_activated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    references["assignment_status"] = "accepted"
    document.references = references

    assignment_row = db.execute(
        select(MerchantAssignmentAudit)
        .where(MerchantAssignmentAudit.document_id == document.id)
        .where(MerchantAssignmentAudit.consumer_user_id == consumer_user_id)
        .order_by(desc(MerchantAssignmentAudit.created_at))
        .limit(1)
    ).scalar_one_or_none()
    if assignment_row is not None:
        assignment_row.status = "accepted"
        assignment_row.accepted_at = datetime.now(timezone.utc)
        db.add(assignment_row)

    db.add(document)
    db.commit()
    db.refresh(document)


def _normalize_scope_value(value: str | None) -> str | None:
    cleaned = (value or "").strip()
    return cleaned or None


def _resolve_notification_user_scope(
    principal: Principal,
    *,
    user_id: str | None = None,
) -> str:
    requested_user_id = _normalize_scope_value(user_id)
    if principal.role in {"consumer", "merchant"}:
        principal_subject = _normalize_scope_value(principal.subject)
        if requested_user_id and principal_subject and requested_user_id != principal_subject:
            raise HTTPException(status_code=403, detail="User scope mismatch.")
        if principal_subject:
            return principal_subject
    if requested_user_id:
        return requested_user_id
    if principal.subject:
        return principal.subject
    raise HTTPException(status_code=400, detail="user_id is required.")


def _notification_preference_hints(
    principal: Principal,
    *,
    user_scope: str,
) -> tuple[str | None, str | None]:
    if not principal.subject or principal.subject != user_scope:
        return None, None
    email_hint = _normalize_scope_value(principal.email)
    full_name_hint = _normalize_scope_value(principal.full_name)
    return email_hint, full_name_hint


def _resolve_document_scope(
    principal: Principal,
    *,
    user_id: str | None = None,
    merchant_user_id: str | None = None,
) -> tuple[str | None, str | None]:
    requested_user_id = _normalize_scope_value(user_id)
    requested_merchant_id = _normalize_scope_value(merchant_user_id)

    if not principal.subject:
        return requested_user_id, requested_merchant_id

    if principal.role == "consumer":
        if requested_merchant_id:
            raise HTTPException(status_code=403, detail="Consumers cannot query merchant scope.")
        if requested_user_id and requested_user_id != principal.subject:
            raise HTTPException(status_code=403, detail="User scope mismatch.")
        return principal.subject, None

    if principal.role == "merchant":
        if requested_merchant_id and requested_merchant_id != principal.subject:
            raise HTTPException(status_code=403, detail="Merchant scope mismatch.")
        return requested_user_id, principal.subject

    return requested_user_id, requested_merchant_id


def _scoped_metadata_filter(principal: Principal, base_filter) -> tuple[str | None, str | None]:
    user_scope, merchant_scope = _resolve_document_scope(
        principal,
        user_id=getattr(base_filter, "user_id", None),
        merchant_user_id=getattr(base_filter, "merchant_user_id", None),
    )
    base_filter.user_id = user_scope
    base_filter.merchant_user_id = merchant_scope
    return user_scope, merchant_scope


def _apply_document_scope(stmt, *, user_id: str | None, merchant_user_id: str | None):
    if user_id:
        stmt = stmt.where(Document.references["user_id"].as_string() == user_id)
    if merchant_user_id:
        stmt = stmt.where(Document.references["merchant_user_id"].as_string() == merchant_user_id)
    return stmt


def _document_in_scope(document: Document, *, user_id: str | None, merchant_user_id: str | None) -> bool:
    references = _safe_references(document)
    if user_id and str(references.get("user_id") or "") != user_id:
        return False
    if merchant_user_id and str(references.get("merchant_user_id") or "") != merchant_user_id:
        return False
    return True


def _serialize_extraction_review(review: ExtractionReview) -> ExtractionReviewView:
    return ExtractionReviewView(
        reviewId=str(review.id),
        documentId=str(review.document_id),
        userId=review.user_id,
        status=review.status,
        fieldConfidences=(review.field_confidences if isinstance(review.field_confidences, dict) else {}),
        lowConfidenceFields=(
            review.low_confidence_fields if isinstance(review.low_confidence_fields, list) else []
        ),
        extractedFields=(review.extracted_fields if isinstance(review.extracted_fields, dict) else {}),
        confirmedFields=(review.confirmed_fields if isinstance(review.confirmed_fields, dict) else {}),
        reviewerUserId=review.reviewer_user_id,
        reviewNotes=review.review_notes,
        reviewedAt=(review.reviewed_at.isoformat() if review.reviewed_at else None),
        createdAt=review.created_at.isoformat(),
        updatedAt=review.updated_at.isoformat(),
    )


def _serialize_assignment_audit(audit: MerchantAssignmentAudit) -> MerchantAssignmentAuditView:
    return MerchantAssignmentAuditView(
        assignmentId=str(audit.id),
        documentId=str(audit.document_id),
        merchantUserId=audit.merchant_user_id,
        consumerUserId=audit.consumer_user_id,
        status=audit.status,
        assignmentSource=audit.assignment_source,
        acceptedAt=(audit.accepted_at.isoformat() if audit.accepted_at else None),
        escalatedAt=(audit.escalated_at.isoformat() if audit.escalated_at else None),
        notes=audit.notes,
        createdAt=audit.created_at.isoformat(),
        updatedAt=audit.updated_at.isoformat(),
    )


def _deadline_band(*, warranty_end: date | None, today: date) -> str | None:
    if warranty_end is None:
        return None
    days_left = (warranty_end - today).days
    if days_left <= 0:
        return "expired"
    if days_left <= 7:
        return "critical"
    if days_left <= 30:
        return "watch"
    return "stable"


def _serialize_document(document: Document) -> DocumentView:
    references = _safe_references(document)
    purchase_date = document.date
    purchase_price = float(document.total_amount) if document.total_amount is not None else None

    warranty_months = _coerce_int(references.get("warranty_months"), default=12)
    warranty_start = _coerce_date(references.get("warranty_start")) or purchase_date
    warranty_end = _coerce_date(references.get("warranty_end"))
    if warranty_end is None and warranty_start and warranty_months:
        warranty_end = add_months(warranty_start, warranty_months)

    purchase_date_iso = purchase_date.isoformat() if purchase_date else None
    warranty_start_iso = warranty_start.isoformat() if warranty_start else None
    warranty_end_iso = warranty_end.isoformat() if warranty_end else None

    product_name = str(references.get("product_name") or references.get("title") or document.bill_id)
    items: list[WarrantyItemView] = []
    reference_items = references.get("line_items")
    if isinstance(reference_items, list):
        for index, entry in enumerate(reference_items[:50], start=1):
            if not isinstance(entry, dict):
                continue
            entry_name = str(entry.get("name") or entry.get("product_name") or "").strip()
            entry_amount = _coerce_float(entry.get("amount"))
            if not entry_name and entry_amount is None:
                continue
            items.append(
                WarrantyItemView(
                    itemId=f"{document.id}:{index}",
                    productName=(entry_name or product_name),
                    model=str(references.get("brand") or document.vendor),
                    invoiceNo=document.bill_id,
                    purchaseDate=purchase_date_iso,
                    purchasePrice=entry_amount,
                    quantity=_coerce_float(entry.get("quantity")),
                    unitPrice=_coerce_float(entry.get("unit_price")),
                    gstAmount=_coerce_float(entry.get("gst_amount")),
                    warrantyMonths=warranty_months,
                    warrantyStart=warranty_start_iso,
                    warrantyEnd=warranty_end_iso,
                    serialNumber=(str(references["serial_number"]) if references.get("serial_number") else None),
                    serviceCenters=(
                        references.get("service_centers") if isinstance(references.get("service_centers"), list) else []
                    ),
                    extendedWarrantyPurchased=_coerce_bool(references.get("extended_warranty_purchased"), default=False),
                    notes=(str(references["notes"]) if references.get("notes") else None),
                )
            )

    if not items:
        items = [
            WarrantyItemView(
                itemId=str(document.id),
                productName=product_name,
                model=str(references.get("brand") or document.vendor),
                invoiceNo=document.bill_id,
                purchaseDate=purchase_date_iso,
                purchasePrice=purchase_price,
                gstAmount=_coerce_float(references.get("gst_amount")),
                warrantyMonths=warranty_months,
                warrantyStart=warranty_start_iso,
                warrantyEnd=warranty_end_iso,
                serialNumber=(str(references["serial_number"]) if references.get("serial_number") else None),
                serviceCenters=(
                    references.get("service_centers") if isinstance(references.get("service_centers"), list) else []
                ),
                extendedWarrantyPurchased=_coerce_bool(references.get("extended_warranty_purchased"), default=False),
                notes=(str(references["notes"]) if references.get("notes") else None),
            )
        ]

    today = date.today()
    status = "expired" if warranty_end and warranty_end < today else "active"
    extraction_confidence = (
        references.get("extraction_confidence")
        if isinstance(references.get("extraction_confidence"), dict)
        else {}
    )
    low_confidence_fields = (
        references.get("low_confidence_fields")
        if isinstance(references.get("low_confidence_fields"), list)
        else []
    )
    review_required = bool(
        references.get("extraction_review_required")
        or (isinstance(low_confidence_fields, list) and len(low_confidence_fields) > 0)
    )
    review_status = str(
        references.get("extraction_review_status")
        or ("pending" if review_required else "confirmed")
    )
    service_centers = references.get("service_centers") if isinstance(references.get("service_centers"), list) else []
    claim_readiness_payload = estimate_claim_readiness(
        warranty_end=warranty_end,
        now=today,
        has_invoice_number=bool(document.bill_id.strip()),
        has_vendor=bool(document.vendor and document.vendor != "UNKNOWN_VENDOR"),
        has_purchase_date=bool(purchase_date),
        has_amount=(purchase_price is not None and purchase_price > 0),
        has_serial=bool(references.get("serial_number")),
        has_service_centers=bool(service_centers),
    )
    deadline_band = _deadline_band(warranty_end=warranty_end, today=today)
    compliance_payload = references.get("compliance") if isinstance(references.get("compliance"), dict) else None
    if compliance_payload is None:
        compliance_payload = validate_invoice_compliance(
            metadata={
                "bill_id": document.bill_id,
                "vendor": document.vendor,
                "date": (purchase_date.isoformat() if purchase_date else None),
                "total_amount": purchase_price,
                "vendor_tax_id": references.get("vendor_tax_id"),
                "taxable_amount": references.get("taxable_amount"),
                "gst_amount": references.get("gst_amount"),
                "gst_rate": references.get("gst_rate"),
                "cgst_amount": references.get("cgst_amount"),
                "sgst_amount": references.get("sgst_amount"),
                "igst_amount": references.get("igst_amount"),
                "line_items": references.get("line_items"),
            },
            raw_text=str(references.get("raw_text") or ""),
        )

    return DocumentView(
        docId=str(document.id),
        userId=str(references.get("user_id") or "anonymous"),
        title=str(references.get("title") or product_name),
        items=items,
        createdAt=document.created_at.isoformat(),
        updatedAt=document.created_at.isoformat(),
        rawText=(str(references["raw_text"]) if references.get("raw_text") else None),
        status=status,
        sellerName=document.vendor,
        ocrConfidence=_coerce_float(references.get("ocr_confidence")),
        isVerified=_coerce_bool(references.get("is_verified"), default=True),
        category=str(references.get("category") or "Others"),
        source=(str(references["source"]) if references.get("source") else None),
        assignedByMerchantId=(str(references["merchant_user_id"]) if references.get("merchant_user_id") else None),
        assignedByMerchantName=(str(references["merchant_name"]) if references.get("merchant_name") else None),
        assignedByMerchantCustomId=(
            str(references["merchant_custom_id"]) if references.get("merchant_custom_id") else None
        ),
        consumerCustomId=(str(references["consumer_custom_id"]) if references.get("consumer_custom_id") else None),
        taxableAmount=_coerce_float(references.get("taxable_amount")),
        gstAmount=_coerce_float(references.get("gst_amount")),
        gstRate=_coerce_float(references.get("gst_rate")),
        cgstAmount=_coerce_float(references.get("cgst_amount")),
        sgstAmount=_coerce_float(references.get("sgst_amount")),
        igstAmount=_coerce_float(references.get("igst_amount")),
        extractionConfidence={
            str(key): float(value)
            for key, value in extraction_confidence.items()
            if _coerce_float(value) is not None
        },
        reviewStatus=review_status,
        reviewRequired=review_required,
        lowConfidenceFields=[str(field) for field in low_confidence_fields],
        claimReadiness=claim_readiness_payload,
        deadlineBand=deadline_band,
        compliance=compliance_payload,
    )


def _manual_bill_text_payload(request: MerchantManualBillRequest, resolved_bill_id: str, resolved_vendor: str) -> str:
    lines = [
        f"Invoice Number: {resolved_bill_id}",
        f"Merchant: {resolved_vendor}",
        f"Product: {request.product_name}",
    ]
    if request.consumer_name:
        lines.append(f"Consumer: {request.consumer_name}")
    if request.purchase_date:
        lines.append(f"Purchase Date: {request.purchase_date.isoformat()}")
    if request.total_amount is not None:
        lines.append(f"Total Amount: {request.total_amount:.2f}")
    if request.warranty_months:
        lines.append(f"Warranty Months: {request.warranty_months}")
    if request.serial_number:
        lines.append(f"Serial Number: {request.serial_number}")
    if request.notes:
        lines.append(f"Notes: {request.notes}")
    return "\n".join(lines)


def _merchant_activity_action(source: str, assignment_source: str) -> str:
    if source == "merchant_manual":
        return "generated"
    if assignment_source == "merchant_reassign":
        return "reassigned"
    return "uploaded"


def _ics_timestamp(dt: datetime) -> str:
    utc = dt.astimezone(timezone.utc)
    return utc.strftime("%Y%m%dT%H%M%SZ")


def _build_google_calendar_url(*, title: str, description: str, start_at: datetime, end_at: datetime) -> str:
    payload = {
        "action": "TEMPLATE",
        "text": title,
        "details": description,
        "dates": f"{_ics_timestamp(start_at)}/{_ics_timestamp(end_at)}",
    }
    query = "&".join(f"{quote(key)}={quote(value)}" for key, value in payload.items())
    return f"https://calendar.google.com/calendar/render?{query}"


def _build_warranty_ics(*, uid: str, title: str, description: str, start_at: datetime, end_at: datetime) -> str:
    stamp = _ics_timestamp(datetime.now(timezone.utc))
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//SafeBill//Warranty Reminder//EN",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{stamp}",
        f"DTSTART:{_ics_timestamp(start_at)}",
        f"DTEND:{_ics_timestamp(end_at)}",
        f"SUMMARY:{title}",
        f"DESCRIPTION:{description.replace(chr(10), '\\n')}",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ]
    return "\r\n".join(lines)


def _build_claim_packet_payload(document: Document, view: DocumentView) -> ClaimPacketResponse:
    references = _safe_references(document)
    item = view.items[0] if view.items else None
    warranty_end = _coerce_date(item.warrantyEnd if item else None)
    purchase_date = _coerce_date(item.purchaseDate if item else None)
    timeline: list[str] = []
    if purchase_date:
        timeline.append(f"{purchase_date.isoformat()}: Product purchased.")
    if item and item.warrantyStart:
        timeline.append(f"{item.warrantyStart}: Warranty coverage started.")
    if warranty_end:
        timeline.append(f"{warranty_end.isoformat()}: Warranty coverage ends.")
    if view.createdAt:
        timeline.append(f"{view.createdAt[:10]}: Bill indexed in SafeBill.")

    facts = {
        "invoice_number": item.invoiceNo if item else None,
        "product_name": item.productName if item else view.title,
        "brand": item.model if item else references.get("brand"),
        "vendor": view.sellerName,
        "purchase_date": item.purchaseDate if item else None,
        "purchase_price": item.purchasePrice if item else None,
        "serial_number": item.serialNumber if item else references.get("serial_number"),
        "warranty_end": item.warrantyEnd if item else None,
        "consumer_id": view.userId,
    }

    issue_template = (
        "Issue Summary:\n"
        "- Device/Product: {product}\n"
        "- Problem observed: <describe malfunction>\n"
        "- First observed date: <YYYY-MM-DD>\n"
        "- Troubleshooting already tried: <steps>\n"
        "- Preferred resolution: repair / replacement / refund"
    ).format(product=facts.get("product_name") or "Product")

    email_template = (
        "Subject: Warranty Claim Request - {invoice}\n\n"
        "Hello {vendor_team},\n\n"
        "I am raising a warranty claim for {product} (Invoice: {invoice}). "
        "The product was purchased on {purchase_date} and is within coverage until {warranty_end}.\n\n"
        "Issue details:\n<add issue summary>\n\n"
        "Please guide me with next steps and required service center/process.\n\n"
        "Regards,\n{consumer_id}"
    ).format(
        invoice=facts.get("invoice_number") or "N/A",
        vendor_team=facts.get("vendor") or "Support Team",
        product=facts.get("product_name") or "Product",
        purchase_date=facts.get("purchase_date") or "N/A",
        warranty_end=facts.get("warranty_end") or "N/A",
        consumer_id=facts.get("consumer_id") or "Consumer",
    )

    checklist = [
        "Invoice copy with invoice number clearly visible",
        "Product serial number photo",
        "Issue photos/videos",
        "Original packaging details (if available)",
        "Previous service ticket references (if any)",
        "Government ID proof (if requested by vendor)",
    ]

    return ClaimPacketResponse(
        docId=view.docId,
        generatedAt=datetime.now(timezone.utc).isoformat(),
        facts=facts,
        timeline=timeline,
        issueSummaryTemplate=issue_template,
        emailTemplate=email_template,
        attachmentChecklist=checklist,
    )


def _clean_company_token(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = re.sub(r"(?i)^\s*(?:name|brand|company)\s*[:=\-]\s*", "", text)
    text = text.split(",", 1)[0].strip()
    text = re.sub(r"\s+", " ", text).strip(" .,:;-'\"!?")
    text = re.sub(r"^[`'\"]+|[`'\"]+$", "", text).strip()
    if not text:
        return None

    leading_stopwords = {
        "this",
        "my",
        "our",
        "the",
        "a",
        "an",
        "is",
        "of",
        "for",
        "from",
        "find",
        "show",
        "where",
        "nearest",
        "nearby",
        "product",
        "item",
        "device",
        "name",
        "brand",
        "company",
        "model",
    }
    trailing_stopwords = {
        "company",
        "brand",
        "product",
        "item",
        "device",
        "service",
        "repair",
        "support",
        "center",
        "centre",
        "nearest",
        "nearby",
        "which",
        "where",
        "is",
        "in",
        "near",
        "around",
        "within",
        "range",
        "radius",
    }
    words = text.split(" ")
    while words and words[0].lower() in leading_stopwords:
        words = words[1:]
    while words and words[-1].lower() in trailing_stopwords:
        words = words[:-1]
    text = " ".join(words).strip(" .,:;-'\"!?")
    if not text:
        return None

    lowered = text.lower()
    invalid = {
        "",
        "unknown",
        "unknown_vendor",
        "service center",
        "service centre",
        "repair center",
        "repair centre",
        "authorized service center",
    }
    if lowered in invalid:
        return None
    if len(text) < 2:
        return None
    return text[:120]


def _query_company_candidates(query: str) -> list[str]:
    candidates: list[str] = []
    patterns = [
        r"(?i)\b([a-z0-9][a-z0-9&.\-\s]{1,80})\s+service\s+cent(?:er|re)\b",
        r"(?i)\b(?:product|item|device|brand|company(?:\s+name)?)\s*(?:is|=|:|of|from)\s+([a-z0-9][a-z0-9&.\-\s]{1,80}?)(?=\b(?:and|nearest|nearby|service|repair|support|in|near|within|around|range|distance|for|where|which|city|km|miles)\b|[?.!,]|$)",
        r"(?i)\b(?:of|for|from)\s+([a-z0-9][a-z0-9&.\-\s]{1,80}?)(?=\b(?:service|repair|support|center|centre|in|near|within|around|range|distance|where|which|city|km|miles)\b|[?.!,]|$)",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, query):
            candidate = _clean_company_token(match.group(1))
            if candidate:
                candidates.append(candidate)
    return candidates


def _query_location_hint(query: str) -> str | None:
    pincode_match = re.search(r"\b([1-9][0-9]{5})\b", query)
    if pincode_match:
        return pincode_match.group(1)
    patterns = [
        r"(?i)\b(?:in|near|around|at)\s+([a-z][a-z.\-\s]{1,60})(?=\b(?:for|within|range|radius|km|miles|service|center|centre|repair|support)\b|[?.!,]|$)",
        r"(?i)\bcity(?:\s+name)?\s*(?:is|:)?\s*([a-z][a-z.\-\s]{1,60})(?=[?.!,]|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, query)
        if not match:
            continue
        candidate = re.sub(r"\s+", " ", match.group(1)).strip(" .,:;-")
        if len(candidate) >= 2:
            return candidate[:80]
    return None


def _hit_company_candidates(hits: list) -> list[str]:
    candidates: list[str] = []
    for hit in hits[:12]:
        vendor = _clean_company_token(getattr(hit, "vendor", None))
        if vendor:
            candidates.append(vendor)

        metadata = getattr(hit, "metadata", {})
        if isinstance(metadata, dict):
            for key in ("brand", "vendor", "product_name", "seller", "store"):
                candidate = _clean_company_token(metadata.get(key))
                if candidate:
                    candidates.append(candidate)

        if getattr(hit, "chunk_type", "") == "invoice_metadata":
            try:
                payload = json.loads(getattr(hit, "content", "") or "{}")
            except json.JSONDecodeError:
                payload = {}
            if isinstance(payload, dict):
                for key in ("brand", "vendor", "product_name"):
                    candidate = _clean_company_token(payload.get(key))
                    if candidate:
                        candidates.append(candidate)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _resolve_company_name(query: str, hits: list, filter_vendor: str | None = None) -> str | None:
    query_sources = _query_company_candidates(query)
    if query_sources:
        return query_sources[0]

    sources: list[str] = []
    filter_candidate = _clean_company_token(filter_vendor)
    if filter_candidate:
        sources.append(filter_candidate)
    sources.extend(_hit_company_candidates(hits))

    deduped: list[str] = []
    seen: set[str] = set()
    for source in sources:
        key = source.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(source)
    return deduped[0] if deduped else None


def _format_service_centers_block(
    base_answer: str,
    *,
    company_name: str | None,
    centers: list[ServiceCenterCandidate],
    has_user_location: bool,
    radius_km: float | None,
) -> str:
    if centers:
        cleaned_label = re.sub(r"(?i)^\s*(?:name|brand|company)\s*[:=\-]\s*", "", (company_name or "")).strip()
        company_label = cleaned_label if cleaned_label else (company_name if company_name else "the requested")
        header = f"Found service centers for {company_label}"
        if radius_km is not None:
            header = f"{header} (range: {radius_km:.0f} km)"
        lines: list[str] = [f"{header}:"]
        for index, center in enumerate(centers, start=1):
            distance_text = (
                f" ({center.distance_km:.2f} km away)"
                if center.distance_km is not None
                else " (distance unavailable)"
            )
            confidence_text = f"[{center.confidence}]"
            contact_parts: list[str] = []
            if center.phone:
                contact_parts.append(f"Phone: {center.phone}")
            if center.website:
                contact_parts.append(f"Website: {center.website}")
            if center.map_url:
                contact_parts.append(f"Maps: {center.map_url}")
            service_parts: list[str] = []
            if center.pincode:
                service_parts.append(f"Pincode: {center.pincode}")
            if center.pickup_available is True:
                service_parts.append("Pickup: Available")
            elif center.pickup_available is False:
                service_parts.append("Pickup: Call center to confirm")
            if center.estimated_tat_days is not None:
                service_parts.append(f"Estimated TAT: ~{center.estimated_tat_days} day(s)")
            lines.append(f"{index}. {center.name} {confidence_text}")
            lines.append(f"   Address: {center.address}{distance_text}")
            if service_parts:
                lines.append(f"   {' | '.join(service_parts)}")
            if contact_parts:
                lines.append(f"   {' | '.join(contact_parts)}")
        return "\n".join(lines)

    if company_name:
        if has_user_location:
            guidance = (
                f"I could not find nearby {company_name} service centers in the selected range. "
                "Try a larger range or share city name with correct spelling."
            )
        else:
            guidance = (
                f"I could not find {company_name} service centers for this place yet. "
                "Try adding state/city or 6-digit pincode clearly (for example: Delhi, 560001) or increase range."
            )
    else:
        guidance = "Please include the company name (for example: Samsung, LG, Sony) and city/state."
    return guidance


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/examples/queries")
def example_queries() -> dict[str, list[str]]:
    return {
        "examples": [
            "Show invoices where GST was incorrectly calculated above ₹50,000",
            "Compare Q3 marketing bills with Q2 and highlight outliers",
            "List all invoices missing vendor tax IDs",
        ]
    }


@router.post("/ingest/pdf", response_model=IngestPDFResponse)
async def ingest_pdf(
    request: Request,
    file: UploadFile = File(...),
    bill_id: str | None = Form(default=None),
    vendor: str | None = Form(default=None),
    document_date: date | None = Form(default=None),
    total_amount: float | None = Form(default=None),
    user_id: str | None = Form(default=None),
    consumer_custom_id: str | None = Form(default=None),
    consumer_name: str | None = Form(default=None),
    consumer_email: str | None = Form(default=None),
    merchant_user_id: str | None = Form(default=None),
    merchant_name: str | None = Form(default=None),
    merchant_custom_id: str | None = Form(default=None),
    version: int = Form(default=1),
    principal: Principal = Depends(require_roles("admin", "analyst", "merchant", "consumer")),
    db: Session = Depends(get_db),
    services: ServiceRegistry = Depends(get_services),
) -> IngestPDFResponse:
    _rate_limit_or_429(
        request=request,
        principal=principal,
        bucket="ingest_pdf",
        limit=get_settings().api_rate_limit_ingest_per_window,
    )
    user_id, merchant_user_id = _resolve_document_scope(
        principal,
        user_id=user_id,
        merchant_user_id=merchant_user_id,
    )

    if principal.role == "consumer":
        user_id = principal.subject
    if principal.role == "merchant":
        merchant_user_id = principal.subject
        if not user_id:
            raise HTTPException(status_code=400, detail="consumer user_id is required for merchant ingestion.")

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Upload a PDF document.")
    payload = await file.read()
    references: dict[str, object] = {
        "filename": file.filename,
        "source": "pdf",
        "is_verified": True,
    }
    if user_id:
        references["user_id"] = user_id
    if consumer_custom_id:
        references["consumer_custom_id"] = consumer_custom_id
    if consumer_name:
        references["consumer_name"] = consumer_name
    if consumer_email:
        references["consumer_email"] = consumer_email
    if merchant_user_id:
        references["merchant_user_id"] = merchant_user_id
    if merchant_name:
        references["merchant_name"] = merchant_name
    if merchant_custom_id:
        references["merchant_custom_id"] = merchant_custom_id
    if principal.role == "merchant" and principal.email:
        references["merchant_email"] = principal.email
    if merchant_user_id and user_id:
        references["assignment_source"] = "merchant_upload"
    document, chunk_count = services.ingestion.ingest_pdf(
        db=db,
        file_bytes=payload,
        filename=file.filename,
        bill_id=bill_id,
        vendor=vendor,
        document_date=document_date,
        total_amount=total_amount,
        version=version,
        references=references,
    )
    _ensure_extraction_review_for_document(db, document=document)
    _schedule_document_notifications(
        db,
        document,
        consumer_user_id=user_id,
        consumer_email=consumer_email,
        consumer_name=consumer_name,
    )
    _log_security_event(
        db,
        event_type="document.ingest_pdf",
        principal=principal,
        resource=f"documents/{document.id}",
        request=request,
        metadata={
            "bill_id": document.bill_id,
            "merchant_user_id": merchant_user_id,
            "user_id": user_id,
        },
    )
    return IngestPDFResponse(
        document_id=document.id,
        chunk_count=chunk_count,
        bill_id=document.bill_id,
        vendor=document.vendor,
        created_at=document.created_at,
    )


@router.post("/ingest/image", response_model=IngestPDFResponse)
async def ingest_image(
    request: Request,
    file: UploadFile = File(...),
    bill_id: str | None = Form(default=None),
    vendor: str | None = Form(default=None),
    document_date: date | None = Form(default=None),
    total_amount: float | None = Form(default=None),
    ocr_text: str | None = Form(default=None),
    user_id: str | None = Form(default=None),
    consumer_custom_id: str | None = Form(default=None),
    consumer_name: str | None = Form(default=None),
    consumer_email: str | None = Form(default=None),
    merchant_user_id: str | None = Form(default=None),
    merchant_name: str | None = Form(default=None),
    merchant_custom_id: str | None = Form(default=None),
    version: int = Form(default=1),
    principal: Principal = Depends(require_roles("admin", "analyst", "merchant", "consumer")),
    db: Session = Depends(get_db),
    services: ServiceRegistry = Depends(get_services),
) -> IngestPDFResponse:
    _rate_limit_or_429(
        request=request,
        principal=principal,
        bucket="ingest_image",
        limit=get_settings().api_rate_limit_ingest_per_window,
    )
    user_id, merchant_user_id = _resolve_document_scope(
        principal,
        user_id=user_id,
        merchant_user_id=merchant_user_id,
    )

    if principal.role == "consumer":
        user_id = principal.subject
    if principal.role == "merchant":
        merchant_user_id = principal.subject
        if not user_id:
            raise HTTPException(status_code=400, detail="consumer user_id is required for merchant ingestion.")

    filename = file.filename or "uploaded-image"
    lowered = filename.lower()
    is_image = lowered.endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"))
    if file.content_type and file.content_type.lower().startswith("image/"):
        is_image = True
    if not is_image:
        raise HTTPException(status_code=400, detail="Upload an image document.")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")

    routed = _run_image_extraction_router(
        image_bytes=payload,
        filename=filename,
        supplied_ocr_text=(ocr_text or ""),
        bill_id=bill_id,
        vendor=vendor,
        document_date=document_date,
        total_amount=total_amount,
    )
    strict_metadata = routed.get("metadata")
    if not isinstance(strict_metadata, dict):
        strict_metadata = {}
    resolved_ocr_text = str(routed.get("resolved_text") or "").strip()
    if not resolved_ocr_text:
        resolved_ocr_text = _metadata_to_canonical_text(strict_metadata)
    if not resolved_ocr_text:
        raise HTTPException(
            status_code=422,
            detail=(
                "Unable to extract readable text from this image. "
                "Retry with a clearer bill image. "
                "If OCR still fails, add invoice fields manually."
            ),
        )

    has_invoice_signals = any(
        _is_meaningful_metadata_value(strict_metadata.get(key))
        for key in ("bill_id", "vendor", "total_amount", "date")
    )
    engines_used = [str(name) for name in routed.get("engines_used") or []]
    has_strong_invoice_engine = any(
        name in {"openai_vision", "aws_textract", "google_docai", "manual_override"}
        for name in engines_used
    )
    if _looks_like_ui_screenshot(resolved_ocr_text) and not has_strong_invoice_engine:
        raise HTTPException(
            status_code=422,
            detail=(
                "Uploaded image appears to be an app screenshot, not a bill/invoice. "
                "Upload the actual invoice photo/PDF."
            ),
        )
    if not has_invoice_signals:
        raise HTTPException(
            status_code=422,
            detail=(
                "Invoice fields were not extracted with confidence. "
                "Provide clearer bill image or enter invoice details manually."
            ),
        )

    additional_references: dict[str, object] = {}
    if consumer_custom_id:
        additional_references["consumer_custom_id"] = consumer_custom_id
    if consumer_name:
        additional_references["consumer_name"] = consumer_name
    if consumer_email:
        additional_references["consumer_email"] = consumer_email
    if merchant_user_id:
        additional_references["merchant_user_id"] = merchant_user_id
    if merchant_name:
        additional_references["merchant_name"] = merchant_name
    if merchant_custom_id:
        additional_references["merchant_custom_id"] = merchant_custom_id
    if principal.role == "merchant" and principal.email:
        additional_references["merchant_email"] = principal.email
    if merchant_user_id and user_id:
        additional_references["assignment_source"] = "merchant_upload"
    additional_references["metadata_source"] = (
        ",".join(engines_used) if engines_used else "ocr_router"
    )

    document, chunk_count = _persist_structured_document(
        db=db,
        services=services,
        filename=filename,
        source="image_ocr_router",
        user_id=user_id,
        extracted_text=resolved_ocr_text,
        extracted_metadata=strict_metadata,
        bill_id=bill_id,
        vendor=vendor,
        document_date=document_date,
        total_amount=total_amount,
        version=version,
        field_confidences=(
            routed.get("field_confidences")
            if isinstance(routed.get("field_confidences"), dict)
            else None
        ),
        field_sources=(
            routed.get("field_sources")
            if isinstance(routed.get("field_sources"), dict)
            else None
        ),
        low_confidence_fields=(
            routed.get("low_confidence_fields")
            if isinstance(routed.get("low_confidence_fields"), list)
            else None
        ),
        extraction_engines=engines_used or None,
        additional_references=additional_references,
    )
    _schedule_document_notifications(
        db,
        document,
        consumer_user_id=user_id,
        consumer_email=consumer_email,
        consumer_name=consumer_name,
    )
    _log_security_event(
        db,
        event_type="document.ingest_image",
        principal=principal,
        resource=f"documents/{document.id}",
        request=request,
        metadata={
            "bill_id": document.bill_id,
            "engines_used": engines_used,
            "user_id": user_id,
            "merchant_user_id": merchant_user_id,
        },
    )
    return IngestPDFResponse(
        document_id=document.id,
        chunk_count=chunk_count,
        bill_id=document.bill_id,
        vendor=document.vendor,
        created_at=document.created_at,
    )


@router.post("/ingest/vendor-table", response_model=IngestVendorTableResponse)
async def ingest_vendor_table(
    file: UploadFile = File(...),
    version: int = Form(default=1),
    principal: Principal = Depends(require_roles("admin", "analyst")),
    db: Session = Depends(get_db),
    services: ServiceRegistry = Depends(get_services),
) -> IngestVendorTableResponse:
    _ = principal
    if not file.filename or not file.filename.lower().endswith((".csv", ".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Upload CSV/XLSX/XLS vendor table.")
    payload = await file.read()
    documents, row_count = services.ingestion.ingest_vendor_table(
        db=db, file_bytes=payload, filename=file.filename, version=version
    )
    created_at = documents[0].created_at if documents else None
    return IngestVendorTableResponse(
        document_ids=[doc.id for doc in documents],
        row_count=row_count,
        created_at=created_at,  # type: ignore[arg-type]
    )


@router.post("/merchant/manual-bill", response_model=MerchantIssueBillResponse)
def create_merchant_manual_bill(
    request: MerchantManualBillRequest,
    http_request: Request,
    principal: Principal = Depends(require_roles("admin", "analyst", "merchant")),
    db: Session = Depends(get_db),
    services: ServiceRegistry = Depends(get_services),
) -> MerchantIssueBillResponse:
    _rate_limit_or_429(
        request=http_request,
        principal=principal,
        bucket="merchant_manual_bill",
        limit=get_settings().api_rate_limit_ingest_per_window,
    )
    if principal.role == "merchant":
        if request.merchant_user_id != principal.subject:
            raise HTTPException(status_code=403, detail="Merchant scope mismatch.")
    resolved_vendor = (request.vendor or request.merchant_name or "UNKNOWN_VENDOR").strip()[:256]
    fallback_bill_id = f"MB-{int(time.time() * 1000)}"
    resolved_bill_id = (request.bill_id or fallback_bill_id).strip()[:128]
    warranty_start = request.purchase_date
    warranty_end = add_months(warranty_start, request.warranty_months) if warranty_start else None
    extracted_text = _manual_bill_text_payload(
        request=request,
        resolved_bill_id=resolved_bill_id,
        resolved_vendor=resolved_vendor,
    )

    references: dict[str, object] = {
        "title": request.product_name,
        "product_name": request.product_name,
        "brand": resolved_vendor,
        "category": request.category or "Others",
        "warranty_months": request.warranty_months,
        "merchant_user_id": request.merchant_user_id,
        "merchant_name": request.merchant_name or resolved_vendor,
        "assignment_source": "merchant_manual",
    }
    if principal.role == "merchant" and principal.email:
        references["merchant_email"] = principal.email
    if request.merchant_custom_id:
        references["merchant_custom_id"] = request.merchant_custom_id
    if request.consumer_custom_id:
        references["consumer_custom_id"] = request.consumer_custom_id
    if request.consumer_name:
        references["consumer_name"] = request.consumer_name
    if request.consumer_email:
        references["consumer_email"] = request.consumer_email
    else:
        references.pop("consumer_email", None)
    if request.serial_number:
        references["serial_number"] = request.serial_number
    if request.notes:
        references["notes"] = request.notes
    if warranty_start:
        references["warranty_start"] = warranty_start.isoformat()
    if warranty_end:
        references["warranty_end"] = warranty_end.isoformat()

    manual_metadata = ensure_strict_extraction(
        {
            "bill_id": resolved_bill_id,
            "vendor": resolved_vendor,
            "date": (request.purchase_date.isoformat() if request.purchase_date else None),
            "total_amount": request.total_amount,
            "product_name": request.product_name,
            "brand": resolved_vendor,
            "serial_number": request.serial_number,
            "warranty_months": request.warranty_months,
            "warranty_start": (warranty_start.isoformat() if warranty_start else None),
            "warranty_end": (warranty_end.isoformat() if warranty_end else None),
            "category": request.category or "Others",
        }
    )
    manual_conf = compute_field_confidences(
        metadata=manual_metadata,
        engine="manual_override",
        text_quality=1.0,
    )

    document, chunk_count = _persist_structured_document(
        db=db,
        services=services,
        filename=f"{resolved_bill_id}.txt",
        source="merchant_manual",
        user_id=request.consumer_user_id,
        extracted_text=extracted_text,
        extracted_metadata=manual_metadata,
        bill_id=resolved_bill_id,
        vendor=resolved_vendor,
        document_date=request.purchase_date,
        total_amount=request.total_amount,
        field_confidences=manual_conf,
        field_sources={field: "manual_override" for field in manual_conf},
        low_confidence_fields=[],
        extraction_engines=["manual_override"],
        additional_references=references,
    )
    _schedule_document_notifications(
        db,
        document,
        consumer_user_id=request.consumer_user_id,
        consumer_email=request.consumer_email,
        consumer_name=request.consumer_name,
    )
    _log_security_event(
        db,
        event_type="document.manual_bill",
        principal=principal,
        resource=f"documents/{document.id}",
        request=http_request,
        metadata={
            "merchant_user_id": request.merchant_user_id,
            "consumer_user_id": request.consumer_user_id,
        },
    )
    return MerchantIssueBillResponse(
        document=_serialize_document(document),
        chunk_count=chunk_count,
    )


@router.post("/merchant/documents/{doc_id}/assign", response_model=DocumentView)
def assign_document_to_consumer(
    doc_id: UUID,
    request: MerchantAssignRequest,
    http_request: Request,
    principal: Principal = Depends(require_roles("admin", "analyst", "merchant")),
    db: Session = Depends(get_db),
) -> DocumentView:
    if principal.role == "merchant":
        if request.merchant_user_id != principal.subject:
            raise HTTPException(status_code=403, detail="Merchant scope mismatch.")
    document = db.get(Document, doc_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    references = _safe_references(document).copy()
    references["user_id"] = request.consumer_user_id
    references["merchant_user_id"] = request.merchant_user_id
    references["assignment_source"] = "merchant_reassign"
    references["assignment_status"] = "assigned"
    references["assigned_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    if request.consumer_custom_id:
        references["consumer_custom_id"] = request.consumer_custom_id
    if request.consumer_name:
        references["consumer_name"] = request.consumer_name
    if request.consumer_email:
        references["consumer_email"] = request.consumer_email
    else:
        references.pop("consumer_email", None)
    if request.merchant_name:
        references["merchant_name"] = request.merchant_name
    if request.merchant_custom_id:
        references["merchant_custom_id"] = request.merchant_custom_id
    if principal.role == "merchant" and principal.email:
        references["merchant_email"] = principal.email
    document.references = references

    audit_entry = MerchantAssignmentAudit(
        document_id=document.id,
        merchant_user_id=request.merchant_user_id,
        consumer_user_id=request.consumer_user_id,
        status="assigned",
        assignment_source="merchant_reassign",
        notes="Assigned from merchant dashboard",
    )

    db.add(document)
    db.add(audit_entry)
    db.commit()
    db.refresh(document)
    _cancel_document_notifications(db, document_id=doc_id)
    _schedule_document_notifications(
        db,
        document,
        consumer_user_id=request.consumer_user_id,
        consumer_email=request.consumer_email,
        consumer_name=request.consumer_name,
    )
    _log_security_event(
        db,
        event_type="document.assigned",
        principal=principal,
        resource=f"documents/{document.id}",
        request=http_request,
        metadata={
            "merchant_user_id": request.merchant_user_id,
            "consumer_user_id": request.consumer_user_id,
            "assignment_source": "merchant_reassign",
        },
    )
    return _serialize_document(document)


@router.get("/merchant/activity", response_model=MerchantActivityResponse)
def list_merchant_activity(
    merchant_user_id: str | None = None,
    limit: int = 100,
    principal: Principal = Depends(require_roles("admin", "analyst", "viewer", "merchant")),
    db: Session = Depends(get_db),
) -> MerchantActivityResponse:
    _, merchant_scope = _resolve_document_scope(
        principal,
        merchant_user_id=merchant_user_id,
    )
    if not merchant_scope:
        raise HTTPException(status_code=400, detail="merchant_user_id is required.")
    merchant_user_id = merchant_scope

    safe_limit = max(1, min(limit, 500))
    stmt = (
        select(Document)
        .where(Document.references["merchant_user_id"].as_string() == merchant_user_id)
        .order_by(desc(Document.created_at))
        .limit(safe_limit)
    )
    filtered = [
        document
        for document in list(db.execute(stmt).scalars())
        if _document_in_scope(document, user_id=None, merchant_user_id=merchant_user_id)
    ]

    activities: list[MerchantActivityItem] = []
    for document in filtered:
        references = _safe_references(document)
        view = _serialize_document(document)
        source = str(references.get("source") or "unknown")
        assignment_source = str(references.get("assignment_source") or "")
        activities.append(
            MerchantActivityItem(
                activityId=f"{document.id}:{int(document.created_at.timestamp())}",
                merchantUserId=merchant_user_id,
                consumerUserId=(str(references["user_id"]) if references.get("user_id") else None),
                consumerCustomId=(
                    str(references["consumer_custom_id"]) if references.get("consumer_custom_id") else None
                ),
                consumerName=(str(references["consumer_name"]) if references.get("consumer_name") else None),
                documentId=str(document.id),
                billId=document.bill_id,
                title=view.title,
                vendor=document.vendor,
                amount=(float(document.total_amount) if document.total_amount is not None else None),
                category=view.category,
                source=source,
                action=_merchant_activity_action(source, assignment_source),
                createdAt=document.created_at.isoformat(),
            )
        )
    return MerchantActivityResponse(activities=activities)


@router.post("/search", response_model=SearchResponse)
def search(
    request: SearchRequest,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
    services: ServiceRegistry = Depends(get_services),
) -> SearchResponse:
    safe_query = enforce_safe_query(request.query)
    scoped_filters = request.filters.model_copy(deep=True)
    _scoped_metadata_filter(principal, scoped_filters)
    hits = services.retrieval_agent.retrieve(db=db, query=safe_query, filters=scoped_filters, top_k=request.top_k)
    return SearchResponse(
        results=[
            SearchResult(
                chunk_id=hit.chunk_id,
                document_id=hit.document_id,
                bill_id=hit.bill_id,
                vendor=hit.vendor,
                date=hit.date,
                total_amount=hit.total_amount,
                chunk_type=hit.chunk_type,
                content=hit.content,
                summary=hit.summary,
                score=hit.score,
                vector_score=hit.vector_score,
                keyword_score=hit.keyword_score,
                metadata=hit.metadata,
            )
            for hit in hits
        ]
    )


@router.post("/ask", response_model=AskResponse)
def ask(
    request: AskRequest,
    http_request: Request,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
    services: ServiceRegistry = Depends(get_services),
) -> AskResponse:
    _rate_limit_or_429(
        request=http_request,
        principal=principal,
        bucket="ask",
        limit=get_settings().api_rate_limit_ask_per_window,
    )
    start = time.perf_counter()
    safe_query = enforce_safe_query(request.query)
    is_service_center_query = services.service_center_locator.is_service_center_query(safe_query)
    scoped_filters = request.filters.model_copy(deep=True)
    _scoped_metadata_filter(principal, scoped_filters)

    plan = services.planner.plan(safe_query)
    hits = services.retrieval_agent.retrieve(db=db, query=safe_query, filters=scoped_filters, top_k=request.top_k)
    calculations = services.calculation_agent.execute(safe_query, hits)
    policy = services.policy_agent.evaluate(safe_query, hits, calculations)
    answer_payload = services.generator.generate(safe_query, plan, hits, calculations, policy)
    math_validation = services.calculation_agent.validate_answer_math(answer_payload, calculations)
    audit = services.auditor_agent.audit(answer_payload=answer_payload, hits=hits, math_validation=math_validation)

    service_center_company: str | None = None
    service_center_candidates: list[ServiceCenterCandidate] = []
    service_centers: list[ServiceCenterView] = []
    has_user_location = request.user_latitude is not None and request.user_longitude is not None
    service_center_radius_km: float | None = None
    service_center_location_hint: str | None = request.user_location_text
    if is_service_center_query:
        service_center_radius_km = services.service_center_locator.parse_radius_km(
            safe_query,
            default_km=request.service_radius_km,
        )
        if not service_center_location_hint:
            service_center_location_hint = _query_location_hint(safe_query)

        service_center_company = _resolve_company_name(
            safe_query,
            hits,
            filter_vendor=scoped_filters.vendor,
        )
        if service_center_company:
            service_center_candidates = services.service_center_locator.find_service_centers(
                company_name=service_center_company,
                user_latitude=request.user_latitude,
                user_longitude=request.user_longitude,
                location_hint=service_center_location_hint,
                radius_km=service_center_radius_km,
                limit=8,
            )
            service_centers = [
                ServiceCenterView(
                    name=center.name,
                    address=center.address,
                    latitude=center.latitude,
                    longitude=center.longitude,
                    distance_km=center.distance_km,
                    source=center.source,
                    confidence=center.confidence,
                    map_url=center.map_url,
                    city=center.city,
                    phone=center.phone,
                    website=center.website,
                    pincode=center.pincode,
                    pickup_available=center.pickup_available,
                    estimated_tat_days=center.estimated_tat_days,
                )
                for center in service_center_candidates
            ]

    citation_map = {str(hit.chunk_id): hit for hit in hits}
    citation_ids = [str(item) for item in answer_payload.get("citation_chunk_ids", [])]
    deduped_ids = []
    seen = set()
    for cid in citation_ids:
        if cid in seen:
            continue
        seen.add(cid)
        deduped_ids.append(cid)

    citations: list[Citation] = []
    for chunk_id in deduped_ids:
        hit = citation_map.get(chunk_id)
        if not hit:
            continue
        citations.append(
            Citation(
                chunk_id=hit.chunk_id,
                document_id=hit.document_id,
                bill_id=hit.bill_id,
                vendor=hit.vendor,
                score=hit.score,
                keyword_score=hit.keyword_score,
                excerpt=hit.content[:280],
            )
        )

    extraction_trace: list[ExtractionTraceStep] = []
    for citation in citations[:10]:
        hit = citation_map.get(str(citation.chunk_id))
        if hit is None:
            continue
        extraction_trace.append(
            ExtractionTraceStep(
                field="retrieval",
                value=f"{hit.bill_id}:{hit.chunk_type}",
                confidence=max(0.0, min(hit.score, 1.0)),
                source="hybrid_retrieval",
                reason=(
                    f"Selected because semantic score={hit.vector_score:.3f} and keyword score={hit.keyword_score:.3f}."
                ),
                citations=[str(hit.chunk_id)],
            )
        )
        if hit.chunk_type == "invoice_metadata":
            try:
                payload = json.loads(hit.content or "{}")
            except json.JSONDecodeError:
                payload = {}
            if isinstance(payload, dict):
                for key in ("bill_id", "vendor", "date", "total_amount", "warranty_end", "product_name"):
                    if not _is_meaningful_metadata_value(payload.get(key)):
                        continue
                    extraction_trace.append(
                        ExtractionTraceStep(
                            field=key,
                            value=payload.get(key),
                            confidence=max(0.0, min(hit.score, 1.0)),
                            source="invoice_metadata_chunk",
                            reason="Value present in structured invoice metadata chunk used by answer grounding.",
                            citations=[str(hit.chunk_id)],
                        )
                    )

    runtime_ms = int((time.perf_counter() - start) * 1000)
    qa_log = create_qa_log(
        db=db,
        query=safe_query,
        runtime_ms=runtime_ms,
        precision=audit.precision,
        recall=audit.recall,
        hallucination_flag=audit.hallucination_flag,
        confidence_score=audit.confidence_score,
        citations=[citation.model_dump(mode="json") for citation in citations],
        diagnostics={
            "planner_complexity": plan.complexity,
            "calculation_summary": calculations,
            "policy_summary": policy,
            "service_center_query": is_service_center_query,
            "service_center_company": service_center_company,
            "service_center_count": len(service_centers),
            "service_center_radius_km": service_center_radius_km,
            "service_center_location_hint": service_center_location_hint,
            "service_center_sources": [center.source for center in service_center_candidates],
            "extraction_trace_size": len(extraction_trace),
            **audit.diagnostics,
            "runtime_ms": runtime_ms,
        },
    )

    answer_text = str(answer_payload.get("answer", ""))
    if is_service_center_query:
        answer_text = _format_service_centers_block(
            answer_text,
            company_name=service_center_company,
            centers=service_center_candidates,
            has_user_location=has_user_location,
            radius_km=service_center_radius_km,
        )

    planner_output = PlannerOutput(
        complexity=plan.complexity,
        steps=[PlannerStep(name=step.name, action=step.action, completed=True) for step in plan.steps],
    )
    _log_security_event(
        db,
        event_type="rag.ask",
        principal=principal,
        resource="rag/ask",
        request=http_request,
        metadata={
            "query_length": len(safe_query),
            "citations": len(citations),
            "qa_log_id": str(qa_log.id),
        },
    )
    return AskResponse(
        answer=answer_text,
        confidence_score=audit.confidence_score,
        hallucination_flag=audit.hallucination_flag,
        planner=planner_output,
        citations=citations,
        extraction_trace=extraction_trace,
        service_centers=service_centers,
        qa_log_id=qa_log.id,
        qa_metrics={
            "precision": audit.precision,
            "recall": audit.recall,
            "runtime_ms": float(runtime_ms),
        },
    )


@router.get("/documents", response_model=DocumentsResponse)
def list_documents(
    user_id: str | None = None,
    merchant_user_id: str | None = None,
    limit: int = 100,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> DocumentsResponse:
    user_id, merchant_user_id = _resolve_document_scope(
        principal,
        user_id=user_id,
        merchant_user_id=merchant_user_id,
    )
    safe_limit = max(1, min(limit, 500))
    stmt = select(Document).order_by(desc(Document.created_at))
    stmt = _apply_document_scope(stmt, user_id=user_id, merchant_user_id=merchant_user_id).limit(safe_limit)
    documents = [
        document
        for document in list(db.execute(stmt).scalars())
        if _document_in_scope(document, user_id=user_id, merchant_user_id=merchant_user_id)
    ][:safe_limit]
    return DocumentsResponse(documents=[_serialize_document(document) for document in documents])


@router.get("/documents/{doc_id}", response_model=DocumentView)
def get_document(
    doc_id: UUID,
    user_id: str | None = None,
    merchant_user_id: str | None = None,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> DocumentView:
    user_id, merchant_user_id = _resolve_document_scope(
        principal,
        user_id=user_id,
        merchant_user_id=merchant_user_id,
    )
    document = db.get(Document, doc_id)
    if not document or not _document_in_scope(document, user_id=user_id, merchant_user_id=merchant_user_id):
        raise HTTPException(status_code=404, detail="Document not found")
    if principal.role == "consumer" and principal.subject:
        try:
            _mark_document_consumer_activated(db, document=document, consumer_user_id=principal.subject)
        except Exception:
            if hasattr(db, "rollback"):
                try:
                    db.rollback()
                except Exception:
                    pass
    return _serialize_document(document)


@router.get("/documents/{doc_id}/calendar-links", response_model=CalendarLinkResponse)
def get_document_calendar_links(
    doc_id: UUID,
    user_id: str | None = None,
    merchant_user_id: str | None = None,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> CalendarLinkResponse:
    user_id, merchant_user_id = _resolve_document_scope(
        principal,
        user_id=user_id,
        merchant_user_id=merchant_user_id,
    )
    document = db.get(Document, doc_id)
    if not document or not _document_in_scope(document, user_id=user_id, merchant_user_id=merchant_user_id):
        raise HTTPException(status_code=404, detail="Document not found")
    view = _serialize_document(document)
    if not view.items or not view.items[0].warrantyEnd:
        raise HTTPException(status_code=422, detail="Warranty end date is missing for calendar reminder.")

    warranty_end = _coerce_date(view.items[0].warrantyEnd)
    if warranty_end is None:
        raise HTTPException(status_code=422, detail="Warranty end date is invalid for calendar reminder.")
    start_at = datetime.combine(warranty_end, datetime.min.time(), tzinfo=timezone.utc).replace(hour=9)
    end_at = start_at + timedelta(hours=1)
    title = f"Warranty deadline: {view.title}"
    description = (
        f"Invoice: {view.items[0].invoiceNo or document.bill_id}\n"
        f"Vendor: {view.sellerName or document.vendor}\n"
        f"Warranty end: {warranty_end.isoformat()}"
    )
    ics_url = f"/api/documents/{view.docId}/calendar.ics"
    google_url = _build_google_calendar_url(
        title=title,
        description=description,
        start_at=start_at,
        end_at=end_at,
    )
    return CalendarLinkResponse(
        docId=view.docId,
        googleCalendarUrl=google_url,
        icsDownloadUrl=ics_url,
    )


@router.get("/documents/{doc_id}/calendar.ics")
def download_document_calendar_ics(
    doc_id: UUID,
    user_id: str | None = None,
    merchant_user_id: str | None = None,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> Response:
    user_id, merchant_user_id = _resolve_document_scope(
        principal,
        user_id=user_id,
        merchant_user_id=merchant_user_id,
    )
    document = db.get(Document, doc_id)
    if not document or not _document_in_scope(document, user_id=user_id, merchant_user_id=merchant_user_id):
        raise HTTPException(status_code=404, detail="Document not found")
    view = _serialize_document(document)
    if not view.items or not view.items[0].warrantyEnd:
        raise HTTPException(status_code=422, detail="Warranty end date is missing for calendar reminder.")
    warranty_end = _coerce_date(view.items[0].warrantyEnd)
    if warranty_end is None:
        raise HTTPException(status_code=422, detail="Warranty end date is invalid for calendar reminder.")

    start_at = datetime.combine(warranty_end, datetime.min.time(), tzinfo=timezone.utc).replace(hour=9)
    end_at = start_at + timedelta(hours=1)
    title = f"Warranty deadline: {view.title}"
    description = (
        f"Invoice: {view.items[0].invoiceNo or document.bill_id}\n"
        f"Vendor: {view.sellerName or document.vendor}\n"
        f"Warranty end: {warranty_end.isoformat()}"
    )
    ics = _build_warranty_ics(
        uid=f"{view.docId}@safebill",
        title=title,
        description=description,
        start_at=start_at,
        end_at=end_at,
    )
    headers = {
        "Content-Disposition": f'attachment; filename="warranty-{view.docId}.ics"',
    }
    return Response(content=ics, media_type="text/calendar; charset=utf-8", headers=headers)


@router.get("/documents/{doc_id}/claim-packet", response_model=ClaimPacketResponse)
def generate_claim_packet(
    doc_id: UUID,
    user_id: str | None = None,
    merchant_user_id: str | None = None,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> ClaimPacketResponse:
    user_id, merchant_user_id = _resolve_document_scope(
        principal,
        user_id=user_id,
        merchant_user_id=merchant_user_id,
    )
    document = db.get(Document, doc_id)
    if not document or not _document_in_scope(document, user_id=user_id, merchant_user_id=merchant_user_id):
        raise HTTPException(status_code=404, detail="Document not found")
    view = _serialize_document(document)
    packet = _build_claim_packet_payload(document, view)
    references = _safe_references(document).copy()
    references["claim_packet_generated_at"] = packet.generatedAt
    document.references = references
    db.add(document)
    db.commit()
    return packet


@router.get("/extraction-reviews", response_model=ExtractionReviewQueueResponse)
def list_extraction_reviews(
    user_id: str | None = None,
    status: str | None = None,
    limit: int = 100,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> ExtractionReviewQueueResponse:
    safe_limit = max(1, min(limit, 500))
    if principal.role in {"consumer", "merchant"}:
        scoped_user = principal.subject
    else:
        scoped_user = _normalize_scope_value(user_id)
    stmt = select(ExtractionReview).order_by(desc(ExtractionReview.created_at)).limit(safe_limit)
    if scoped_user:
        stmt = stmt.where(ExtractionReview.user_id == scoped_user)
    if status:
        stmt = stmt.where(ExtractionReview.status == status.strip().lower())
    rows = list(db.execute(stmt).scalars())
    return ExtractionReviewQueueResponse(reviews=[_serialize_extraction_review(review) for review in rows])


@router.get("/extraction-reviews/{review_id}", response_model=ExtractionReviewView)
def get_extraction_review(
    review_id: UUID,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> ExtractionReviewView:
    review = db.get(ExtractionReview, review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Extraction review not found")
    if principal.role in {"consumer", "merchant"} and principal.subject and review.user_id != principal.subject:
        raise HTTPException(status_code=403, detail="Forbidden")
    return _serialize_extraction_review(review)


@router.put("/extraction-reviews/{review_id}", response_model=ExtractionReviewView)
def confirm_extraction_review(
    review_id: UUID,
    payload: ExtractionReviewConfirmRequest,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> ExtractionReviewView:
    review = db.get(ExtractionReview, review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Extraction review not found")
    if principal.role in {"consumer", "merchant"} and principal.subject and review.user_id != principal.subject:
        raise HTTPException(status_code=403, detail="Forbidden")

    confirmed_fields = payload.confirmed_fields if isinstance(payload.confirmed_fields, dict) else {}
    review.confirmed_fields = confirmed_fields
    review.status = payload.status
    review.review_notes = payload.review_notes
    review.reviewer_user_id = principal.subject
    review.reviewed_at = datetime.now(timezone.utc)
    db.add(review)

    document = db.get(Document, review.document_id)
    if document:
        references = _safe_references(document).copy()
        for field, value in confirmed_fields.items():
            references[field] = value
        references["extraction_review_status"] = payload.status
        references["extraction_review_required"] = payload.status != "confirmed"
        if payload.status == "confirmed":
            references["low_confidence_fields"] = []
        document.references = references
        db.add(document)

    db.commit()
    db.refresh(review)
    return _serialize_extraction_review(review)


@router.get("/merchant/assignment-audits", response_model=MerchantAssignmentAuditResponse)
def list_assignment_audits(
    merchant_user_id: str | None = None,
    consumer_user_id: str | None = None,
    status: str | None = None,
    limit: int = 200,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "merchant", "consumer")),
    db: Session = Depends(get_db),
) -> MerchantAssignmentAuditResponse:
    safe_limit = max(1, min(limit, 500))
    stmt = select(MerchantAssignmentAudit).order_by(desc(MerchantAssignmentAudit.created_at)).limit(safe_limit)
    if principal.role == "merchant" and principal.subject:
        stmt = stmt.where(MerchantAssignmentAudit.merchant_user_id == principal.subject)
    elif principal.role == "consumer" and principal.subject:
        stmt = stmt.where(MerchantAssignmentAudit.consumer_user_id == principal.subject)
    else:
        if merchant_user_id:
            stmt = stmt.where(MerchantAssignmentAudit.merchant_user_id == merchant_user_id)
        if consumer_user_id:
            stmt = stmt.where(MerchantAssignmentAudit.consumer_user_id == consumer_user_id)
    if status:
        stmt = stmt.where(MerchantAssignmentAudit.status == status.strip().lower())
    rows = list(db.execute(stmt).scalars())
    return MerchantAssignmentAuditResponse(assignments=[_serialize_assignment_audit(row) for row in rows])


@router.post("/documents/{doc_id}/assignment/ack", response_model=MerchantAssignmentAuditView)
def acknowledge_assignment(
    doc_id: UUID,
    payload: MerchantAssignmentAcceptRequest,
    principal: Principal = Depends(require_roles("admin", "analyst", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> MerchantAssignmentAuditView:
    document = db.get(Document, doc_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    references = _safe_references(document).copy()
    consumer_id = payload.consumer_user_id
    if principal.role in {"consumer", "merchant"} and principal.subject:
        consumer_id = principal.subject
    if str(references.get("user_id") or "") != consumer_id:
        raise HTTPException(status_code=403, detail="User scope mismatch.")

    row = db.execute(
        select(MerchantAssignmentAudit)
        .where(MerchantAssignmentAudit.document_id == doc_id)
        .where(MerchantAssignmentAudit.consumer_user_id == consumer_id)
        .order_by(desc(MerchantAssignmentAudit.created_at))
        .limit(1)
    ).scalar_one_or_none()
    if row is None:
        row = MerchantAssignmentAudit(
            document_id=doc_id,
            merchant_user_id=str(references.get("merchant_user_id") or "unknown"),
            consumer_user_id=consumer_id,
            status="assigned",
            assignment_source=str(references.get("assignment_source") or "unknown"),
        )

    row.status = payload.status
    row.notes = payload.notes
    now = datetime.now(timezone.utc)
    if payload.status == "accepted":
        row.accepted_at = now
        references["consumer_activated_at"] = now.replace(microsecond=0).isoformat()
    if payload.status == "escalated":
        row.escalated_at = now
    references["assignment_status"] = payload.status
    document.references = references

    db.add(row)
    db.add(document)
    db.commit()
    db.refresh(row)
    return _serialize_assignment_audit(row)


@router.delete("/documents/{doc_id}")
def delete_document(
    doc_id: UUID,
    request: Request,
    user_id: str | None = None,
    merchant_user_id: str | None = None,
    principal: Principal = Depends(require_roles("admin", "analyst", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    user_id, merchant_user_id = _resolve_document_scope(
        principal,
        user_id=user_id,
        merchant_user_id=merchant_user_id,
    )
    document = db.get(Document, doc_id)
    if not document or not _document_in_scope(document, user_id=user_id, merchant_user_id=merchant_user_id):
        raise HTTPException(status_code=404, detail="Document not found")
    _cancel_document_notifications(db, document_id=doc_id)
    db.delete(document)
    db.commit()
    _log_security_event(
        db,
        event_type="document.deleted",
        principal=principal,
        resource=f"documents/{doc_id}",
        request=request,
        metadata={"user_id": user_id, "merchant_user_id": merchant_user_id},
    )
    return {"status": "deleted", "docId": str(doc_id)}


@router.get("/reminders", response_model=RemindersResponse)
def list_reminders(
    user_id: str | None = None,
    days_ahead: int = 60,
    limit: int = 200,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> RemindersResponse:
    user_id, merchant_user_id = _resolve_document_scope(principal, user_id=user_id)
    safe_days = max(1, min(days_ahead, 3650))
    safe_limit = max(1, min(limit, 500))

    stmt = select(Document).order_by(desc(Document.created_at))
    stmt = _apply_document_scope(stmt, user_id=user_id, merchant_user_id=merchant_user_id).limit(safe_limit)
    filtered = [
        document
        for document in list(db.execute(stmt).scalars())
        if _document_in_scope(document, user_id=user_id, merchant_user_id=merchant_user_id)
    ]

    now = date.today()
    cutoff = now + timedelta(days=safe_days)
    reminders: list[ReminderView] = []
    for document in filtered:
        view = _serialize_document(document)
        if not view.items:
            continue
        warranty_end = _coerce_date(view.items[0].warrantyEnd)
        if warranty_end is None or warranty_end > cutoff:
            continue
        days_remaining = (warranty_end - now).days
        urgency_tone = "stable"
        if days_remaining <= 0:
            urgency_tone = "expired"
        elif days_remaining <= 7:
            urgency_tone = "critical"
        elif days_remaining <= 30:
            urgency_tone = "watch"
        reminders.append(
            ReminderView(
                reminderId=f"{view.docId}-expiry",
                docId=view.docId,
                title=f"{view.title} warranty expiry",
                triggerAt=f"{warranty_end.isoformat()}T09:00:00Z",
                triggerType="expiry",
                deliveryChannels=["push", "email"],
                status=("expired" if warranty_end < now else "scheduled"),
                daysRemaining=days_remaining,
                urgencyTone=urgency_tone,
            )
        )

    reminders.sort(key=lambda reminder: reminder.triggerAt)
    return RemindersResponse(reminders=reminders[:safe_limit])


@router.get("/notifications", response_model=NotificationsResponse)
def list_notifications(
    user_id: str | None = None,
    include_read: bool = False,
    limit: int = 100,
    offset: int = 0,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> NotificationsResponse:
    user_scope = _resolve_notification_user_scope(principal, user_id=user_id)
    items = _notification_service.list_in_app_notifications(
        db,
        user_id=user_scope,
        include_read=include_read,
        limit=limit,
        offset=offset,
    )
    return NotificationsResponse(notifications=[NotificationItem(**item) for item in items])


@router.get("/notifications/preferences", response_model=NotificationPreferenceView)
def get_notification_preferences(
    user_id: str | None = None,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> NotificationPreferenceView:
    user_scope = _resolve_notification_user_scope(principal, user_id=user_id)
    email_hint, full_name_hint = _notification_preference_hints(
        principal,
        user_scope=user_scope,
    )
    preference = _notification_service.get_preference(
        db,
        user_id=user_scope,
        email_hint=email_hint,
        full_name_hint=full_name_hint,
    )
    return NotificationPreferenceView(**_notification_service.serialize_preference(preference))


@router.put("/notifications/preferences", response_model=NotificationPreferenceView)
def update_notification_preferences(
    request: NotificationPreferenceUpdateRequest,
    user_id: str | None = None,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> NotificationPreferenceView:
    user_scope = _resolve_notification_user_scope(principal, user_id=user_id)
    email_hint, full_name_hint = _notification_preference_hints(
        principal,
        user_scope=user_scope,
    )
    preference = _notification_service.update_preference(
        db,
        user_id=user_scope,
        updates=request.model_dump(exclude_unset=True),
        email_hint=email_hint,
        full_name_hint=full_name_hint,
    )
    return NotificationPreferenceView(**_notification_service.serialize_preference(preference))


@router.post("/notifications/process-due", response_model=NotificationProcessResult)
def process_due_notifications(
    request: Request,
    limit: int | None = None,
    principal: Principal = Depends(require_roles("admin", "analyst")),
    db: Session = Depends(get_db),
) -> NotificationProcessResult:
    _rate_limit_or_429(
        request=request,
        principal=principal,
        bucket="notifications_process",
        limit=get_settings().api_rate_limit_notification_per_window,
    )
    result = _notification_service.process_due_jobs(db, limit=limit)
    return NotificationProcessResult(**result)


@router.get("/notifications/analytics", response_model=NotificationAnalyticsResponse)
def notifications_analytics(
    user_id: str | None = None,
    days: int = 30,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> NotificationAnalyticsResponse:
    user_scope: str | None
    if principal.role in {"admin", "analyst"} and not _normalize_scope_value(user_id):
        user_scope = None
    else:
        user_scope = _resolve_notification_user_scope(principal, user_id=user_id)
    metrics = _notification_service.get_delivery_analytics(
        db,
        user_id=user_scope,
        window_days=days,
    )
    return NotificationAnalyticsResponse(**metrics)


@router.get("/notifications/deliverability", response_model=NotificationDeliverabilityDashboardResponse)
def notification_deliverability_dashboard(
    user_id: str | None = None,
    days: int = 30,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> NotificationDeliverabilityDashboardResponse:
    safe_days = max(1, min(days, 365))
    since = datetime.now(timezone.utc) - timedelta(days=safe_days)

    if principal.role in {"admin", "analyst"} and not _normalize_scope_value(user_id):
        user_scope = None
    else:
        user_scope = _resolve_notification_user_scope(principal, user_id=user_id)

    stmt = (
        select(NotificationDelivery, NotificationJob)
        .join(NotificationJob, NotificationDelivery.job_id == NotificationJob.id)
        .where(NotificationDelivery.created_at >= since)
    )
    if user_scope:
        stmt = stmt.where(NotificationJob.user_id == user_scope)

    rows = list(db.execute(stmt).all())
    totals = {"attempts": 0, "sent": 0, "failed": 0, "dead_lettered": 0}
    channel_map: dict[str, dict[str, int]] = {}

    for delivery, job in rows:
        totals["attempts"] += 1
        channel = str(delivery.channel or job.channel or "unknown")
        channel_bucket = channel_map.setdefault(channel, {"attempts": 0, "sent": 0, "failed": 0, "dead_lettered": 0})
        channel_bucket["attempts"] += 1

        status = str(delivery.status or "").lower()
        if status == "sent":
            totals["sent"] += 1
            channel_bucket["sent"] += 1
        elif status in {"dead_letter", "deadletter", "dead-letter"}:
            totals["dead_lettered"] += 1
            channel_bucket["dead_lettered"] += 1
        else:
            totals["failed"] += 1
            channel_bucket["failed"] += 1

    channel_stats = []
    for channel, bucket in sorted(channel_map.items()):
        attempts = bucket["attempts"]
        success_rate = (bucket["sent"] / attempts) if attempts else 0.0
        channel_stats.append(
            {
                "channel": channel,
                "attempts": attempts,
                "sent": bucket["sent"],
                "failed": bucket["failed"],
                "deadLettered": bucket["dead_lettered"],
                "successRate": round(success_rate, 4),
            }
        )

    return NotificationDeliverabilityDashboardResponse(
        windowDays=safe_days,
        totals=totals,
        channelStats=channel_stats,
    )


@router.post("/notifications/provider-events")
def ingest_notification_provider_event(
    payload: NotificationProviderEventIngestRequest,
    principal: Principal = Depends(require_roles("admin", "analyst")),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    _ = principal
    settings = get_settings()
    now = datetime.now(timezone.utc)
    status = payload.status.strip().lower()

    job: NotificationJob | None = None
    if payload.job_id:
        job = db.get(NotificationJob, payload.job_id)

    delivery_match: NotificationDelivery | None = None
    if payload.provider_message_id:
        delivery_match = db.execute(
            select(NotificationDelivery)
            .where(NotificationDelivery.provider_message_id == payload.provider_message_id)
            .order_by(desc(NotificationDelivery.created_at))
            .limit(1)
        ).scalar_one_or_none()
        if delivery_match and job is None:
            job = db.get(NotificationJob, delivery_match.job_id)

    if job is None and payload.channel and payload.recipient:
        job = db.execute(
            select(NotificationJob)
            .where(NotificationJob.channel == payload.channel)
            .where(NotificationJob.recipient_email == payload.recipient)
            .order_by(desc(NotificationJob.created_at))
            .limit(1)
        ).scalar_one_or_none()

    resolved_channel = payload.channel or (job.channel if job else "email")
    attempt_number = 1
    if job is not None:
        attempt_number = max(1, int(job.retry_count or 0) + 1)

    normalized_delivery_status = "failed"
    if status in {"sent", "delivered", "success", "opened"}:
        normalized_delivery_status = "sent"
    elif status in {"dead_letter", "deadletter", "dead-letter"}:
        normalized_delivery_status = "dead_letter"

    provider_payload = {
        "provider": payload.provider,
        "event_type": payload.event_type,
        "status": status,
        **(payload.payload if isinstance(payload.payload, dict) else {}),
    }
    if job is not None:
        delivery_entry = NotificationDelivery(
            job_id=job.id,
            channel=str(resolved_channel),
            attempt_number=attempt_number,
            status=normalized_delivery_status,
            provider_message_id=payload.provider_message_id,
            provider_payload=provider_payload,
            error_message=payload.error_message,
            latency_ms=None,
        )
        db.add(delivery_entry)

        if normalized_delivery_status == "sent":
            job.status = "sent"
            job.sent_at = now
            job.last_error = None
        elif normalized_delivery_status == "dead_letter":
            job.status = "dead_letter"
            job.last_error = payload.error_message
        else:
            job.status = "failed"
            job.last_error = payload.error_message
            if (
                job.channel == "email"
                and settings.sms_notifications_enabled
                and job.fallback_channel is None
            ):
                job.fallback_channel = "sms"
        db.add(job)

    db.commit()
    return {"status": "acknowledged"}


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: UUID,
    user_id: str | None = None,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    user_scope = _resolve_notification_user_scope(principal, user_id=user_id)
    updated = _notification_service.mark_in_app_notification_read(
        db,
        notification_id=notification_id,
        user_id=user_scope,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"status": "read", "notificationId": str(notification_id)}


@router.delete("/notifications/{notification_id}")
def delete_notification(
    notification_id: UUID,
    user_id: str | None = None,
    principal: Principal = Depends(require_roles("admin", "analyst", "auditor", "viewer", "consumer", "merchant")),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    user_scope = _resolve_notification_user_scope(principal, user_id=user_id)
    deleted = _notification_service.delete_in_app_notification(
        db,
        notification_id=notification_id,
        user_id=user_scope,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"status": "deleted", "notificationId": str(notification_id)}
