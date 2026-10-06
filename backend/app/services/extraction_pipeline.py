from __future__ import annotations

import hashlib
import re
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator


TEXT_FIELDS = {
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
NUMERIC_FIELDS = {
    "total_amount",
    "taxable_amount",
    "gst_amount",
    "gst_rate",
    "cgst_amount",
    "sgst_amount",
    "igst_amount",
}
ALL_FIELDS = [
    "bill_id",
    "vendor",
    "date",
    "total_amount",
    "vendor_tax_id",
    "taxable_amount",
    "gst_amount",
    "gst_rate",
    "cgst_amount",
    "sgst_amount",
    "igst_amount",
    "product_name",
    "brand",
    "serial_number",
    "warranty_months",
    "warranty_start",
    "warranty_end",
    "category",
    "line_items",
]
REVIEW_FIELDS = {
    "bill_id",
    "vendor",
    "date",
    "total_amount",
    "product_name",
    "warranty_end",
}
ENGINE_WEIGHTS = {
    "manual_override": 1.0,
    "openai_vision": 0.93,
    "aws_textract": 0.9,
    "google_docai": 0.9,
    "tesseract_regex": 0.72,
}


def _safe_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_date_iso(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return date.fromisoformat(text[:10]).isoformat()
        except ValueError:
            return None
    return None


def _normalize_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text


def _normalize_category(value: object) -> str | None:
    text = (_normalize_text(value) or "").lower()
    if not text:
        return None
    if text in {"gadget", "gadgets", "electronic", "electronics"}:
        return "Gadgets"
    if text in {"appliance", "appliances", "home appliance", "home appliances"}:
        return "Appliances"
    if text in {"vehicle", "vehicles", "automotive"}:
        return "Vehicle"
    if text in {"other", "others"}:
        return "Others"
    return None


class StrictLineItem(BaseModel):
    name: str | None = None
    quantity: float | None = None
    unit_price: float | None = None
    amount: float | None = None
    gst_amount: float | None = None

    @field_validator("quantity", "unit_price", "amount", "gst_amount", mode="before")
    @classmethod
    def _coerce_numeric(cls, value: object) -> float | None:
        return _safe_float(value)

    @field_validator("name", mode="before")
    @classmethod
    def _coerce_name(cls, value: object) -> str | None:
        text = _normalize_text(value)
        return text[:255] if text else None


class StrictInvoiceExtraction(BaseModel):
    bill_id: str | None = None
    vendor: str | None = None
    date: str | None = None
    total_amount: float | None = None
    vendor_tax_id: str | None = None
    taxable_amount: float | None = None
    gst_amount: float | None = None
    gst_rate: float | None = None
    cgst_amount: float | None = None
    sgst_amount: float | None = None
    igst_amount: float | None = None
    product_name: str | None = None
    brand: str | None = None
    serial_number: str | None = None
    warranty_months: int | None = None
    warranty_start: str | None = None
    warranty_end: str | None = None
    category: str | None = None
    line_items: list[StrictLineItem] = Field(default_factory=list)

    @field_validator(
        "bill_id",
        "vendor",
        "vendor_tax_id",
        "product_name",
        "brand",
        "serial_number",
        mode="before",
    )
    @classmethod
    def _normalize_strings(cls, value: object) -> str | None:
        text = _normalize_text(value)
        return text[:255] if text else None

    @field_validator("date", "warranty_start", "warranty_end", mode="before")
    @classmethod
    def _normalize_dates(cls, value: object) -> str | None:
        return _safe_date_iso(value)

    @field_validator(
        "total_amount",
        "taxable_amount",
        "gst_amount",
        "gst_rate",
        "cgst_amount",
        "sgst_amount",
        "igst_amount",
        mode="before",
    )
    @classmethod
    def _normalize_amounts(cls, value: object) -> float | None:
        return _safe_float(value)

    @field_validator("warranty_months", mode="before")
    @classmethod
    def _normalize_warranty_months(cls, value: object) -> int | None:
        months = _safe_int(value)
        if months is None:
            return None
        if months <= 0:
            return None
        return min(months, 240)

    @field_validator("category", mode="before")
    @classmethod
    def _category(cls, value: object) -> str | None:
        normalized = _normalize_category(value)
        return normalized or (_normalize_text(value) if value else None)


def ensure_strict_extraction(payload: dict[str, Any] | None) -> dict[str, Any]:
    raw = payload or {}
    try:
        parsed = StrictInvoiceExtraction(**raw)
    except ValidationError as exc:
        # Preserve schema shape even for invalid inputs.
        parsed = StrictInvoiceExtraction()
        parsed_line = {"validation_error": str(exc)}
        normalized = parsed.model_dump(mode="json")
        normalized["_schema_error"] = parsed_line
        return normalized
    return parsed.model_dump(mode="json")


def _is_meaningful(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True


def _normalized_vote_key(field: str, value: object) -> str:
    if field in NUMERIC_FIELDS:
        numeric = _safe_float(value)
        return f"{numeric:.2f}" if numeric is not None else ""
    if field in {"warranty_months"}:
        val = _safe_int(value)
        return str(val) if val is not None else ""
    text = _normalize_text(value)
    return text.lower() if text else ""


def estimate_text_quality(ocr_text: str) -> float:
    text = (ocr_text or "").strip()
    if not text:
        return 0.0
    score = 0.25
    if len(text) >= 120:
        score += 0.2
    if len(text) >= 300:
        score += 0.15
    lowered = text.lower()
    invoice_tokens = ("invoice", "bill", "total", "amount", "date", "vendor")
    hits = sum(1 for token in invoice_tokens if token in lowered)
    score += min(hits * 0.08, 0.3)
    gibberish_ratio = len(re.findall(r"[A-Za-z0-9]", text)) / max(len(text), 1)
    if gibberish_ratio > 0.35:
        score += 0.1
    return max(0.0, min(score, 1.0))


def compute_field_confidences(
    *,
    metadata: dict[str, Any],
    engine: str,
    text_quality: float,
) -> dict[str, float]:
    weight = ENGINE_WEIGHTS.get(engine, 0.6)
    confidences: dict[str, float] = {}
    for field in ALL_FIELDS:
        value = metadata.get(field)
        if not _is_meaningful(value):
            confidences[field] = 0.0
            continue
        base = 0.35 + (weight * 0.45) + (text_quality * 0.2)
        if field in {"date", "warranty_start", "warranty_end"} and _safe_date_iso(value):
            base += 0.05
        if field in NUMERIC_FIELDS and _safe_float(value) is not None:
            base += 0.05
        if field == "bill_id":
            token = str(value).strip()
            if re.search(r"[A-Z0-9]{3,}", token):
                base += 0.05
        if field == "line_items" and isinstance(value, list):
            if value:
                base += min(len(value), 5) * 0.01
        confidences[field] = max(0.0, min(base, 1.0))
    return confidences


def merge_engine_results(
    engine_results: list[dict[str, Any]],
    *,
    manual_overrides: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, float], dict[str, str]]:
    merged: dict[str, Any] = {field: None for field in ALL_FIELDS}
    merged["line_items"] = []
    confidence_map: dict[str, float] = {field: 0.0 for field in ALL_FIELDS}
    source_map: dict[str, str] = {field: "none" for field in ALL_FIELDS}

    for field in ALL_FIELDS:
        votes: dict[str, dict[str, Any]] = {}
        for result in engine_results:
            metadata = result.get("metadata")
            if not isinstance(metadata, dict):
                continue
            value = metadata.get(field)
            if not _is_meaningful(value):
                continue
            field_confidences = result.get("field_confidences")
            confidence = 0.0
            if isinstance(field_confidences, dict):
                confidence = _safe_float(field_confidences.get(field)) or 0.0
            confidence = max(0.0, min(confidence, 1.0))
            vote_key = _normalized_vote_key(field, value)
            if not vote_key:
                continue
            existing = votes.get(vote_key)
            if existing is None:
                votes[vote_key] = {
                    "value": value,
                    "support": confidence,
                    "best_confidence": confidence,
                    "source": str(result.get("engine") or "unknown"),
                }
            else:
                existing["support"] = float(existing["support"]) + confidence
                if confidence > float(existing["best_confidence"]):
                    existing["best_confidence"] = confidence
                    existing["value"] = value
                    existing["source"] = str(result.get("engine") or "unknown")
        if votes:
            winner = sorted(
                votes.values(),
                key=lambda item: (float(item["support"]), float(item["best_confidence"])),
                reverse=True,
            )[0]
            merged[field] = winner["value"]
            confidence_map[field] = max(
                0.0,
                min((float(winner["support"]) / max(len(engine_results), 1)), 1.0),
            )
            source_map[field] = str(winner["source"])

    if manual_overrides:
        for field, value in manual_overrides.items():
            if field not in ALL_FIELDS:
                continue
            if not _is_meaningful(value):
                continue
            merged[field] = value
            confidence_map[field] = 1.0
            source_map[field] = "manual_override"

    strict = ensure_strict_extraction(merged)
    if strict.get("_schema_error"):
        # Reset confidences for fields that failed schema coercion.
        for field in ALL_FIELDS:
            if field not in strict:
                confidence_map[field] = 0.0
                source_map[field] = "schema_reject"
    return strict, confidence_map, source_map


def build_review_fields(
    field_confidences: dict[str, float],
    *,
    threshold: float,
) -> list[str]:
    low: list[str] = []
    for field in REVIEW_FIELDS:
        confidence = _safe_float(field_confidences.get(field))
        if confidence is None or confidence < threshold:
            low.append(field)
    return sorted(low)


def extraction_fingerprint(metadata: dict[str, Any], raw_text: str) -> str:
    canonical = {
        "bill_id": metadata.get("bill_id"),
        "vendor": metadata.get("vendor"),
        "date": metadata.get("date"),
        "total_amount": metadata.get("total_amount"),
        "product_name": metadata.get("product_name"),
    }
    raw = f"{canonical}|{(raw_text or '')[:2500]}"
    return hashlib.sha256(raw.encode("utf-8", "ignore")).hexdigest()


def estimate_claim_readiness(
    *,
    warranty_end: date | None,
    now: date,
    has_invoice_number: bool,
    has_vendor: bool,
    has_purchase_date: bool,
    has_amount: bool,
    has_serial: bool,
    has_service_centers: bool,
) -> dict[str, Any]:
    factors: dict[str, float] = {
        "document_completeness": 0.0,
        "time_buffer": 0.0,
        "serviceability": 0.0,
    }

    completeness_signals = [has_invoice_number, has_vendor, has_purchase_date, has_amount, has_serial]
    completeness_ratio = sum(1 for signal in completeness_signals if signal) / len(completeness_signals)
    factors["document_completeness"] = round(completeness_ratio, 3)

    days_left = 0
    if warranty_end is not None:
        days_left = (warranty_end - now).days
    if days_left <= 0:
        factors["time_buffer"] = 0.0
    elif days_left <= 7:
        factors["time_buffer"] = 0.3
    elif days_left <= 30:
        factors["time_buffer"] = 0.65
    else:
        factors["time_buffer"] = 1.0

    factors["serviceability"] = 1.0 if has_service_centers else 0.4

    score = (
        factors["document_completeness"] * 0.45
        + factors["time_buffer"] * 0.35
        + factors["serviceability"] * 0.20
    )
    score = round(max(0.0, min(score, 1.0)), 3)

    missing = []
    if not has_invoice_number:
        missing.append("invoice_number")
    if not has_vendor:
        missing.append("vendor")
    if not has_purchase_date:
        missing.append("purchase_date")
    if not has_amount:
        missing.append("amount")
    if not has_serial:
        missing.append("serial_number")
    if not has_service_centers:
        missing.append("service_center")

    if score < 0.45:
        label = "needs_attention"
        summary = "Claim data is incomplete and deadline risk is elevated."
    elif score < 0.75:
        label = "progressing"
        summary = "Claim prep is on track but still needs a few checks."
    else:
        label = "ready"
        summary = "Claim packet quality is strong with healthy deadline buffer."

    return {
        "score": score,
        "label": label,
        "summary": summary,
        "factors": factors,
        "missing": missing,
        "days_left": days_left,
    }
