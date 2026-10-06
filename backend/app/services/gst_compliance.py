from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

_GSTIN_REGEX = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$")
_GSTIN_SEARCH = re.compile(r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b")
_IRN_SEARCH = re.compile(r"(?i)\birn(?:\s*[:\-]|\s+)?([a-f0-9]{64})\b")
_HEX64_SEARCH = re.compile(r"\b[a-fA-F0-9]{64}\b")
_PINCODE_SEARCH = re.compile(r"\b([1-9][0-9]{5})\b")
_PAN_REGEX = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
_GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_GSTIN_CHAR_TO_CODE = {char: index for index, char in enumerate(_GSTIN_CHARS)}


def _safe_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None
    return None


def _normalize_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _extract_gstin(raw_text: str) -> str | None:
    match = _GSTIN_SEARCH.search(raw_text or "")
    if not match:
        return None
    return match.group(1).upper()


def _extract_irn(raw_text: str) -> str | None:
    text = raw_text or ""
    match = _IRN_SEARCH.search(text)
    if match:
        return match.group(1).lower()
    fallback = _HEX64_SEARCH.search(text)
    if fallback:
        return fallback.group(0).lower()
    return None


def _gstin_checksum_char(gstin_without_checksum: str) -> str | None:
    if len(gstin_without_checksum) != 14:
        return None
    factor = 2
    total = 0
    for char in reversed(gstin_without_checksum):
        code = _GSTIN_CHAR_TO_CODE.get(char)
        if code is None:
            return None
        addend = factor * code
        factor = 1 if factor == 2 else 2
        addend = (addend // 36) + (addend % 36)
        total += addend
    checksum_code = (36 - (total % 36)) % 36
    return _GSTIN_CHARS[checksum_code]


def validate_gstin(gstin: str | None) -> dict[str, Any]:
    value = (gstin or "").strip().upper()
    if not value:
        return {
            "value": None,
            "present": False,
            "valid_format": False,
            "valid_checksum": False,
            "state_code": None,
            "pan": None,
        }

    valid_format = bool(_GSTIN_REGEX.fullmatch(value))
    expected_checksum = _gstin_checksum_char(value[:14]) if valid_format else None
    valid_checksum = bool(expected_checksum and expected_checksum == value[-1])
    state_code = value[:2] if valid_format else None
    pan = value[2:12] if valid_format else None

    return {
        "value": value,
        "present": True,
        "valid_format": valid_format,
        "valid_checksum": valid_checksum,
        "state_code": state_code,
        "pan": pan,
    }


def _rule46_checks(*, metadata: dict[str, Any], raw_text: str, gstin_info: dict[str, Any]) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []
    invoice_number = _normalize_text(metadata.get("bill_id"))
    invoice_date = _safe_date(metadata.get("date"))
    supplier_name = _normalize_text(metadata.get("vendor"))
    taxable_amount = _safe_float(metadata.get("taxable_amount"))
    total_amount = _safe_float(metadata.get("total_amount"))
    line_items = metadata.get("line_items")
    text = (raw_text or "").lower()

    checks.append(
        {
            "field": "invoice_number",
            "status": ("pass" if invoice_number else "fail"),
            "detail": "Invoice number detected." if invoice_number else "Invoice number missing.",
        }
    )
    checks.append(
        {
            "field": "invoice_date",
            "status": ("pass" if invoice_date else "fail"),
            "detail": "Invoice date detected." if invoice_date else "Invoice date missing.",
        }
    )
    checks.append(
        {
            "field": "supplier_name",
            "status": ("pass" if supplier_name else "fail"),
            "detail": "Supplier name detected." if supplier_name else "Supplier name missing.",
        }
    )
    checks.append(
        {
            "field": "supplier_gstin",
            "status": ("pass" if gstin_info.get("valid_format") else ("warn" if gstin_info.get("present") else "fail")),
            "detail": (
                "GSTIN format and checksum validated."
                if gstin_info.get("valid_checksum")
                else ("GSTIN present but format/checksum requires review." if gstin_info.get("present") else "GSTIN missing.")
            ),
        }
    )
    checks.append(
        {
            "field": "line_items",
            "status": ("pass" if isinstance(line_items, list) and len(line_items) > 0 else "warn"),
            "detail": (
                "At least one line item detected."
                if isinstance(line_items, list) and len(line_items) > 0
                else "Line-item table not detected."
            ),
        }
    )
    checks.append(
        {
            "field": "taxable_value",
            "status": ("pass" if taxable_amount is not None else "warn"),
            "detail": "Taxable value found." if taxable_amount is not None else "Taxable value not confidently extracted.",
        }
    )
    checks.append(
        {
            "field": "invoice_total",
            "status": ("pass" if total_amount is not None else "warn"),
            "detail": "Invoice total detected." if total_amount is not None else "Invoice total not confidently extracted.",
        }
    )
    checks.append(
        {
            "field": "place_of_supply",
            "status": ("pass" if "place of supply" in text or "ship to" in text or "shipping address" in text else "warn"),
            "detail": (
                "Place of supply / shipping marker found."
                if ("place of supply" in text or "ship to" in text or "shipping address" in text)
                else "Could not confidently detect place-of-supply marker."
            ),
        }
    )
    return checks


def _tax_validation(metadata: dict[str, Any]) -> dict[str, Any]:
    taxable_amount = _safe_float(metadata.get("taxable_amount"))
    gst_amount = _safe_float(metadata.get("gst_amount"))
    gst_rate = _safe_float(metadata.get("gst_rate"))
    cgst_amount = _safe_float(metadata.get("cgst_amount"))
    sgst_amount = _safe_float(metadata.get("sgst_amount"))
    igst_amount = _safe_float(metadata.get("igst_amount"))

    tolerance = 2.0
    split_total = sum(part for part in [cgst_amount, sgst_amount, igst_amount] if part is not None)
    expected_gst = None
    if taxable_amount is not None and gst_rate is not None:
        expected_gst = round((taxable_amount * gst_rate) / 100.0, 2)
    reported_gst = gst_amount if gst_amount is not None else (round(split_total, 2) if split_total > 0 else None)
    delta = round(abs(reported_gst - expected_gst), 2) if (reported_gst is not None and expected_gst is not None) else None

    mode = "unknown"
    if igst_amount and igst_amount > 0 and ((cgst_amount and cgst_amount > 0) or (sgst_amount and sgst_amount > 0)):
        mode = "mixed_invalid"
    elif igst_amount and igst_amount > 0:
        mode = "igst"
    elif (cgst_amount and cgst_amount > 0) or (sgst_amount and sgst_amount > 0):
        mode = "cgst_sgst"

    return {
        "taxable_amount": taxable_amount,
        "gst_amount": gst_amount,
        "gst_rate": gst_rate,
        "cgst_amount": cgst_amount,
        "sgst_amount": sgst_amount,
        "igst_amount": igst_amount,
        "split_total": (round(split_total, 2) if split_total > 0 else None),
        "expected_gst_amount": expected_gst,
        "reported_gst_amount": reported_gst,
        "delta": delta,
        "within_tolerance": (delta is not None and delta <= tolerance),
        "tax_split_mode": mode,
        "tolerance": tolerance,
    }


def _einvoice_signals(*, raw_text: str, metadata: dict[str, Any], today: date) -> dict[str, Any]:
    text = raw_text or ""
    lowered = text.lower()
    irn_value = _extract_irn(text)
    qr_detected = bool(re.search(r"(?i)\b(qr|qr\s*code)\b", text))
    invoice_date = _safe_date(metadata.get("date"))
    days_since_invoice = (today - invoice_date).days if invoice_date is not None else None

    gstin_present = bool(_normalize_text(metadata.get("vendor_tax_id")) or _extract_gstin(text))
    likely_b2b = gstin_present and ("tax invoice" in lowered or "gst" in lowered)

    if irn_value:
        requirement_signal = "satisfied"
    elif likely_b2b:
        requirement_signal = "possible"
    else:
        requirement_signal = "unknown"

    late_reporting_risk = bool(
        requirement_signal == "possible"
        and days_since_invoice is not None
        and days_since_invoice > 7
        and not irn_value
    )
    return {
        "irn_detected": bool(irn_value),
        "irn_value": irn_value,
        "qr_detected": qr_detected,
        "einvoice_requirement_signal": requirement_signal,
        "days_since_invoice": days_since_invoice,
        "late_reporting_risk": late_reporting_risk,
    }


def _build_alerts(
    *,
    gstin_info: dict[str, Any],
    tax_validation: dict[str, Any],
    einvoice_signals: dict[str, Any],
    rule46_checks: list[dict[str, str]],
) -> list[dict[str, str]]:
    alerts: list[dict[str, str]] = []

    if gstin_info.get("present") and not gstin_info.get("valid_format"):
        alerts.append(
            {
                "code": "GSTIN_FORMAT_INVALID",
                "severity": "high",
                "message": "Supplier GSTIN format looks invalid.",
            }
        )
    if gstin_info.get("valid_format") and not gstin_info.get("valid_checksum"):
        alerts.append(
            {
                "code": "GSTIN_CHECKSUM_INVALID",
                "severity": "high",
                "message": "Supplier GSTIN checksum validation failed.",
            }
        )

    if tax_validation.get("tax_split_mode") == "mixed_invalid":
        alerts.append(
            {
                "code": "TAX_SPLIT_CONFLICT",
                "severity": "high",
                "message": "IGST and CGST/SGST are both present; tax split may be incorrect.",
            }
        )
    if tax_validation.get("delta") is not None and not tax_validation.get("within_tolerance"):
        alerts.append(
            {
                "code": "GST_AMOUNT_MISMATCH",
                "severity": "medium",
                "message": "Computed GST does not match extracted GST amount.",
            }
        )
    if einvoice_signals.get("late_reporting_risk"):
        alerts.append(
            {
                "code": "EINV_LATE_REPORT_RISK",
                "severity": "medium",
                "message": "Possible e-invoice is older than 7 days and IRN not detected.",
            }
        )
    if (
        einvoice_signals.get("einvoice_requirement_signal") == "possible"
        and not einvoice_signals.get("irn_detected")
    ):
        alerts.append(
            {
                "code": "EINV_IRN_MISSING",
                "severity": "low",
                "message": "IRN not detected in invoice text; verify e-invoice applicability.",
            }
        )

    missing_rule46 = [check["field"] for check in rule46_checks if check["status"] == "fail"]
    if missing_rule46:
        alerts.append(
            {
                "code": "RULE46_MISSING_FIELDS",
                "severity": "high",
                "message": f"Rule-46 mandatory fields missing: {', '.join(missing_rule46)}",
            }
        )
    return alerts


def _compliance_score(*, rule46_checks: list[dict[str, str]], alerts: list[dict[str, str]]) -> tuple[int, str]:
    score = 100
    for check in rule46_checks:
        status = check.get("status")
        if status == "fail":
            score -= 10
        elif status == "warn":
            score -= 4
    for alert in alerts:
        severity = alert.get("severity")
        if severity == "high":
            score -= 18
        elif severity == "medium":
            score -= 10
        elif severity == "low":
            score -= 4
    bounded = max(0, min(score, 100))
    if bounded >= 85:
        status = "pass"
    elif bounded >= 60:
        status = "watch"
    else:
        status = "risk"
    return bounded, status


def validate_invoice_compliance(
    *,
    metadata: dict[str, Any],
    raw_text: str,
    today: date | None = None,
) -> dict[str, Any]:
    now_date = today or datetime.now(timezone.utc).date()
    extracted_gstin = _normalize_text(metadata.get("vendor_tax_id")) or _extract_gstin(raw_text)
    gstin_info = validate_gstin(extracted_gstin)
    if gstin_info.get("pan"):
        gstin_info["pan_valid_format"] = bool(_PAN_REGEX.fullmatch(str(gstin_info["pan"])))
    else:
        gstin_info["pan_valid_format"] = False

    rule46_checks = _rule46_checks(metadata=metadata, raw_text=raw_text, gstin_info=gstin_info)
    tax_validation = _tax_validation(metadata)
    einvoice = _einvoice_signals(raw_text=raw_text, metadata=metadata, today=now_date)
    alerts = _build_alerts(
        gstin_info=gstin_info,
        tax_validation=tax_validation,
        einvoice_signals=einvoice,
        rule46_checks=rule46_checks,
    )
    score, status = _compliance_score(rule46_checks=rule46_checks, alerts=alerts)

    pincode = None
    pincode_match = _PINCODE_SEARCH.search(raw_text or "")
    if pincode_match:
        pincode = pincode_match.group(1)

    return {
        "country": "IN",
        "framework": "GST Rule 46 + e-Invoice heuristics",
        "status": status,
        "score": score,
        "gstin": gstin_info,
        "invoice": {
            "invoice_number": _normalize_text(metadata.get("bill_id")),
            "invoice_date": (_safe_date(metadata.get("date")).isoformat() if _safe_date(metadata.get("date")) else None),
            "total_amount": _safe_float(metadata.get("total_amount")),
            "detected_pincode": pincode,
            **einvoice,
        },
        "tax_validation": tax_validation,
        "rule46_checks": rule46_checks,
        "alerts": alerts,
        "computed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }
