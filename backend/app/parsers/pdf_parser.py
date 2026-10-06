from __future__ import annotations

import io
import os
import re
import tempfile
from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from dateutil import parser as date_parser

try:
    import pandas as pd
except Exception:  # pragma: no cover - optional runtime dependency
    pd = None

try:
    import pdfplumber
except Exception:  # pragma: no cover - optional runtime dependency
    pdfplumber = None

try:
    import pytesseract
except Exception:  # pragma: no cover - optional runtime dependency
    pytesseract = None

# NOTE: `unstructured` (and its inference stack) is heavy and can add minutes
# of import time on cold starts. Keep it lazily imported inside
# `_partition_sections()` so the API can bind its port quickly when
# `USE_UNSTRUCTURED_PARTITION=false` (the default).

from app.core.config import get_settings
from app.services.date_utils import add_months

CURRENCY_RE = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?")


@dataclass
class TableRow:
    row_index: int
    values: dict[str, str]
    numeric_values: dict[str, float]
    raw: list[str]


@dataclass
class PageSection:
    page_number: int
    section_type: str
    text: str
    metadata: dict[str, Any]


@dataclass
class ParsedDocument:
    raw_text: str
    sections: list[PageSection]
    tables: list[dict[str, Any]]
    metadata: dict[str, Any]
    is_scanned: bool


def normalize_numeric_field(value: str | None) -> float | None:
    if not value:
        return None
    cleaned = value
    for token in ("INR", "Rs.", "Rs", "$", "\u20b9", "EUR", "USD"):
        cleaned = cleaned.replace(token, "")
    cleaned = cleaned.replace(",", "").strip()
    if not cleaned:
        return None
    match = CURRENCY_RE.search(cleaned)
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def _safe_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date_parser.parse(value, dayfirst=True, fuzzy=True).date()
    except (ValueError, TypeError, OverflowError):
        return None


def _normalize_text(raw_text: str) -> str:
    return (
        (raw_text or "")
        .replace("\u20b9", " INR ")
        .replace("\u00a0", " ")
        .replace("\r", "\n")
    )


def _clean_line(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _extract_labeled_value(text: str, labels: list[str]) -> str | None:
    joined = "|".join(labels)
    match = re.search(rf"(?im)^\s*(?:{joined})\s*[:\-]\s*(.+?)\s*$", text)
    if not match:
        return None
    value = _clean_line(match.group(1))
    return value or None


def _extract_labeled_date(text: str, labels: list[str]) -> date | None:
    joined = "|".join(labels)
    date_pattern = (
        r"("
        r"[0-3]?\d[\/\-.][01]?\d[\/\-.]\d{2,4}"
        r"|\d{4}[\/\-.][01]?\d[\/\-.][0-3]?\d"
        r"|[0-3]?\d[\/\-.][A-Za-z]{3,9}[\/\-.]\d{2,4}"
        r"|[A-Za-z]{3,9}[\/\-.][0-3]?\d[\/\-.]\d{2,4}"
        r"|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}"
        r"|[0-3]?\d\s+[A-Za-z]{3,9}\s+\d{2,4}"
        r")"
    )
    match = re.search(rf"(?im)(?:{joined})\s*[:\-]?\s*{date_pattern}", text)
    return _safe_date(match.group(1)) if match else None


def _extract_bill_id(text: str, filename: str) -> str:
    patterns = [
        r"(?im)\b(?:invoice\s*\/\s*bill|bill\s*\/\s*invoice)\s*(?:no|number|#|id)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})",
        r"(?im)\b(?:invoice|bill|receipt)\s*(?:no|number|#|id)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})",
        r"(?im)\binvoice\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]{2,})",
        r"(?im)\binv\s*(?:no|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})",
        r"(?im)\border\s*(?:no|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{5,})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        value = _clean_line(match.group(1)).strip(".,;:")
        if not value:
            continue
        if value.lower() in {"document", "invoice", "bill", "receipt"}:
            continue
        if value:
            return value[:128]
    return os.path.splitext(filename)[0][:128]


def _extract_vendor(text: str, lines: list[str]) -> str:
    multiline_match = re.search(
        r"(?im)^\s*(?:sold\s+by|seller|vendor|merchant|supplier|store(?:\s*name)?|shop(?:\s*name)?)\s*[:\-]\s*\n\s*([^\n]{2,120})",
        text,
    )
    if multiline_match:
        multiline_value = _clean_line(multiline_match.group(1))
        if multiline_value and not re.fullmatch(r"[\W_]+", multiline_value):
            return multiline_value[:255]

    labeled = _extract_labeled_value(
        text,
        [
            r"vendor",
            r"supplier",
            r"merchant",
            r"seller",
            r"sold\s+by",
            r"store(?:\s*name)?",
            r"shop(?:\s*name)?",
            r"company(?:\s*name)?",
            r"manufacturer",
            r"from",
        ],
    )
    if labeled:
        return labeled[:255]

    ignored_tokens = (
        "invoice",
        "bill",
        "receipt",
        "gst",
        "tax",
        "date",
        "phone",
        "email",
        "address",
        "qty",
        "amount",
        "total",
        "hsn",
        "serial",
        "warranty",
    )
    for raw_line in lines[:12]:
        line = _clean_line(raw_line)
        lowered = line.lower()
        if len(line) < 3 or len(line) > 80:
            continue
        if any(token in lowered for token in ignored_tokens):
            continue
        if re.search(r"\d{4,}", line):
            continue
        if re.fullmatch(r"[\W_]+", line):
            continue
        return line[:255]

    return "UNKNOWN_VENDOR"


def _extract_total_amount(text: str) -> float | None:
    currency = r"(?:inr|rs\.?|usd|eur|\$|₹|\u20b9)"
    candidate_patterns = [
        rf"(?im)(grand\s*total)\s*[:\-]?\s*{currency}?\s*([0-9][0-9,]*(?:\.\d{{1,2}})?)",
        rf"(?im)(final\s*amount)\s*[:\-]?\s*{currency}?\s*([0-9][0-9,]*(?:\.\d{{1,2}})?)",
        rf"(?im)(total\s*amount|amount\s*due|amount\s*paid|invoice\s*total)\s*[:\-]?\s*{currency}?\s*([0-9][0-9,]*(?:\.\d{{1,2}})?)",
        rf"(?im)(?:^|\b)(total)\s*[:\-]?\s*{currency}?\s*([0-9][0-9,]*(?:\.\d{{1,2}})?)",
    ]
    ranked: list[tuple[int, float]] = []
    for pattern in candidate_patterns:
        for match in re.finditer(pattern, text):
            label = (match.group(1) or "").lower()
            value = normalize_numeric_field(match.group(2))
            if value is None:
                continue
            priority = 3 if "grand" in label else 2 if "final" in label else 1
            ranked.append((priority, value))
    if not ranked:
        return None
    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return ranked[0][1]


def _extract_tax_breakdown(text: str) -> dict[str, float | None]:
    currency = r"(?:inr|rs\.?|usd|eur|\$|₹|\u20b9)"

    def _extract_amount(patterns: list[str]) -> float | None:
        ranked: list[tuple[int, float]] = []
        for priority, pattern in enumerate(patterns, start=1):
            for match in re.finditer(pattern, text):
                value = normalize_numeric_field(match.group(1))
                if value is None:
                    continue
                ranked.append((priority, value))
        if not ranked:
            return None
        ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
        return ranked[0][1]

    def _extract_rate() -> float | None:
        patterns = [
            r"(?im)(?:gst\s*rate|tax\s*rate)\s*[:\-]?\s*([0-9]{1,2}(?:\.[0-9]+)?)\s*%",
            r"(?im)(?:cgst|sgst|igst)\s*[:\-]?\s*([0-9]{1,2}(?:\.[0-9]+)?)\s*%",
        ]
        for pattern in patterns:
            match = re.search(pattern, text)
            if not match:
                continue
            try:
                return float(match.group(1))
            except ValueError:
                continue
        return None

    taxable_amount = _extract_amount(
        [
            rf"(?im)(?:taxable\s*amount|subtotal|sub\s*total)\s*[:\-]?\s*{currency}?\s*([0-9][0-9,]*(?:\.\d{{1,2}})?)",
        ]
    )
    gst_amount = _extract_amount(
        [
            rf"(?im)(?:gst\s*amount|total\s*gst|tax\s*amount)\s*[:\-]?\s*{currency}?\s*([0-9][0-9,]*(?:\.\d{{1,2}})?)",
            rf"(?im)(?:^|\b)gst\s*[:\-]?\s*{currency}?\s*([0-9][0-9,]*(?:\.\d{{1,2}})?)",
        ]
    )
    cgst_amount = _extract_amount(
        [
            rf"(?im)(?:cgst)\s*[:\-]?\s*{currency}?\s*([0-9][0-9,]*(?:\.\d{{1,2}})?)",
        ]
    )
    sgst_amount = _extract_amount(
        [
            rf"(?im)(?:sgst)\s*[:\-]?\s*{currency}?\s*([0-9][0-9,]*(?:\.\d{{1,2}})?)",
        ]
    )
    igst_amount = _extract_amount(
        [
            rf"(?im)(?:igst)\s*[:\-]?\s*{currency}?\s*([0-9][0-9,]*(?:\.\d{{1,2}})?)",
        ]
    )

    if gst_amount is None:
        split_total = sum(part for part in [cgst_amount, sgst_amount, igst_amount] if part is not None)
        if split_total > 0:
            gst_amount = round(split_total, 2)

    gst_rate = _extract_rate()
    if gst_rate is None and taxable_amount and gst_amount and taxable_amount > 0:
        gst_rate = round((gst_amount / taxable_amount) * 100.0, 2)

    return {
        "taxable_amount": taxable_amount,
        "gst_amount": gst_amount,
        "gst_rate": gst_rate,
        "cgst_amount": cgst_amount,
        "sgst_amount": sgst_amount,
        "igst_amount": igst_amount,
    }


def _extract_line_items_from_text(lines: list[str]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    ignored_tokens = (
        "invoice",
        "bill",
        "receipt",
        "total",
        "subtotal",
        "tax",
        "gst",
        "cgst",
        "sgst",
        "igst",
        "amount due",
        "amount paid",
        "grand total",
        "warranty",
    )
    amount_re = re.compile(r"(?i)(?:inr|rs\.?|\$)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*$")

    for raw_line in lines:
        line = _clean_line(raw_line)
        if len(line) < 5 or len(line) > 120:
            continue
        lowered = line.lower()
        if any(token in lowered for token in ignored_tokens):
            continue

        amount_match = amount_re.search(line)
        if not amount_match:
            continue
        amount = normalize_numeric_field(amount_match.group(1))
        if amount is None or amount <= 0:
            continue

        name = _clean_line(line[: amount_match.start()]).strip(":- ")
        if len(name) < 2:
            continue

        items.append(
            {
                "name": name[:255],
                "amount": round(amount, 2),
            }
        )

    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, float]] = set()
    for item in items:
        key = (str(item.get("name", "")).lower(), float(item.get("amount") or 0.0))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped[:12]


def _extract_vendor_tax_id(text: str) -> str | None:
    gstin_match = re.search(r"(?i)\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b", text)
    if gstin_match:
        return gstin_match.group(1)
    generic_match = re.search(r"(?im)(?:gstin|tax\s*id|vat\s*id)\s*[:\-]?\s*([A-Z0-9\-]{6,32})", text)
    if generic_match:
        return _clean_line(generic_match.group(1))
    return None


def _extract_serial_number(text: str) -> str | None:
    match = re.search(
        r"(?im)(?:serial(?:\s*(?:no|number))?|s\/n|imei(?:\s*(?:no|number))?)\s*[:\-]?\s*([A-Z0-9\-\/]{4,64})",
        text,
    )
    if match:
        return _clean_line(match.group(1))
    return None


def _extract_product_name(text: str, lines: list[str], vendor: str) -> str | None:
    labeled = _extract_labeled_value(
        text,
        [
            r"product(?:\s*name)?",
            r"item(?:\s*name)?",
            r"description",
            r"model(?:\s*name)?",
            r"device",
        ],
    )
    if labeled:
        return labeled[:255]

    ignored_tokens = (
        "invoice",
        "bill",
        "receipt",
        "total",
        "subtotal",
        "tax",
        "gst",
        "date",
        "qty",
        "hsn",
        "warranty",
        "serial",
        "address",
        "phone",
        "email",
        "amount",
    )
    lowered_vendor = vendor.lower()
    for raw_line in lines[:24]:
        line = _clean_line(raw_line)
        lowered = line.lower()
        if len(line) < 4 or len(line) > 90:
            continue
        if lowered == lowered_vendor:
            continue
        if any(token in lowered for token in ignored_tokens):
            continue
        if re.search(r"\b\d{6,}\b", line):
            continue
        if re.search(r"(?:inr|rs\.?|usd|\$)\s*[0-9]", lowered):
            continue
        if re.fullmatch(r"[A-Z0-9\-\/]{4,}", line):
            continue
        return line[:255]
    return None


def _extract_brand(text: str, product_name: str | None, vendor: str) -> str | None:
    labeled = _extract_labeled_value(
        text,
        [
            r"brand",
            r"make",
            r"manufacturer",
            r"company",
        ],
    )
    if labeled:
        return labeled[:255]

    if product_name:
        first_token = product_name.split(" ", 1)[0].strip()
        if first_token and first_token.isalpha() and len(first_token) >= 2:
            return first_token[:64]

    if vendor and vendor != "UNKNOWN_VENDOR":
        return vendor[:255]
    return None


def _extract_warranty_months(text: str) -> int | None:
    match = re.search(
        r"(?im)(?:warranty(?:\s*(?:period|tenure|duration))?|guarantee(?:\s*period)?)\s*[:\-]?\s*(\d{1,3})\s*(month|months|year|years)",
        text,
    )
    if not match:
        match = re.search(
            r"(?im)(\d{1,3})\s*(month|months|year|years)\s*(?:manufacturer\s*)?(?:warranty|guarantee)",
            text,
        )
    if not match:
        return None
    raw_value = int(match.group(1))
    unit = match.group(2).lower()
    return raw_value * 12 if "year" in unit else raw_value


def _derive_category(product_name: str | None, brand: str | None, vendor: str) -> str:
    combined = " ".join([product_name or "", brand or "", vendor or ""]).lower()
    if any(token in combined for token in ("bike", "car", "scooter", "motorcycle", "vehicle", "tyre", "helmet")):
        return "Vehicle"
    if any(
        token in combined
        for token in (
            "refrigerator",
            "fridge",
            "washing machine",
            "microwave",
            "oven",
            "air conditioner",
            "geyser",
            "dishwasher",
            "appliance",
            "television",
            "tv",
        )
    ):
        return "Appliances"
    if any(
        token in combined
        for token in (
            "laptop",
            "phone",
            "mobile",
            "tablet",
            "watch",
            "camera",
            "headphone",
            "earbud",
            "monitor",
            "printer",
            "gadget",
        )
    ):
        return "Gadgets"
    return "Others"


def extract_invoice_metadata(text: str, filename: str) -> dict[str, Any]:
    normalized = _normalize_text(text)
    lines = [_clean_line(line) for line in normalized.splitlines() if _clean_line(line)]

    bill_id = _extract_bill_id(normalized, filename)
    vendor = _extract_vendor(normalized, lines)
    purchase_date = _extract_labeled_date(
        normalized,
        [
            r"invoice\s*date",
            r"bill\s*date",
            r"purchase\s*date",
            r"date\s*of\s*purchase",
            r"date",
        ],
    )
    warranty_start = _extract_labeled_date(
        normalized,
        [
            r"warranty\s*start(?:\s*date)?",
            r"coverage\s*start(?:\s*date)?",
            r"start\s*date",
        ],
    )
    warranty_end = _extract_labeled_date(
        normalized,
        [
            r"warranty\s*end(?:\s*date)?",
            r"warranty\s*expiry(?:\s*date)?",
            r"valid\s*(?:upto|until|till)",
            r"expires?\s*on",
            r"end\s*date",
        ],
    )

    total_amount = _extract_total_amount(normalized)
    vendor_tax_id = _extract_vendor_tax_id(normalized)
    tax_breakdown = _extract_tax_breakdown(normalized)
    serial_number = _extract_serial_number(normalized)
    warranty_months = _extract_warranty_months(normalized)

    product_name = _extract_product_name(normalized, lines, vendor)
    brand = _extract_brand(normalized, product_name, vendor)
    category = _derive_category(product_name, brand, vendor)
    line_items = _extract_line_items_from_text(lines)

    if warranty_start is None:
        warranty_start = purchase_date
    if warranty_end is None and warranty_start and warranty_months:
        warranty_end = add_months(warranty_start, warranty_months)

    return {
        "bill_id": bill_id,
        "vendor": vendor,
        "date": purchase_date,
        "total_amount": total_amount,
        "vendor_tax_id": vendor_tax_id,
        "taxable_amount": tax_breakdown.get("taxable_amount"),
        "gst_amount": tax_breakdown.get("gst_amount"),
        "gst_rate": tax_breakdown.get("gst_rate"),
        "cgst_amount": tax_breakdown.get("cgst_amount"),
        "sgst_amount": tax_breakdown.get("sgst_amount"),
        "igst_amount": tax_breakdown.get("igst_amount"),
        "product_name": product_name,
        "brand": brand,
        "serial_number": serial_number,
        "warranty_months": warranty_months,
        "warranty_start": warranty_start,
        "warranty_end": warranty_end,
        "category": category,
        "line_items": line_items,
    }


def _table_to_rows(table_data: list[list[str | None]]) -> list[TableRow]:
    if not table_data:
        return []
    normalized = [[(cell or "").strip() for cell in row] for row in table_data if any(cell for cell in row)]
    if len(normalized) < 2:
        return []

    header = [col if col else f"col_{idx+1}" for idx, col in enumerate(normalized[0])]
    rows: list[TableRow] = []
    for idx, row in enumerate(normalized[1:]):
        padded = row + [""] * max(0, len(header) - len(row))
        values = {header[col_idx]: padded[col_idx] for col_idx in range(len(header))}
        numeric_values = {}
        for key, value in values.items():
            numeric = normalize_numeric_field(value)
            if numeric is not None:
                numeric_values[key] = numeric
        rows.append(TableRow(row_index=idx, values=values, numeric_values=numeric_values, raw=padded))
    return rows


def _ocr_page_text(page: pdfplumber.page.Page) -> str:
    if pytesseract is None:
        return ""
    settings = get_settings()
    if settings.tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd
    try:
        image = page.to_image(resolution=250).original
        return pytesseract.image_to_string(image)
    except Exception:
        # OCR is best-effort; ingestion should continue even if tesseract is unavailable.
        return ""


def _partition_sections(file_bytes: bytes) -> list[PageSection]:
    try:
        # Lazily import to avoid heavy startup costs unless enabled via config.
        from unstructured.partition.pdf import partition_pdf as _partition_pdf
    except Exception:
        return []
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        elements = _partition_pdf(filename=tmp_path, strategy="hi_res", infer_table_structure=True)
    except Exception:
        return []
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    sections: list[PageSection] = []
    for element in elements:
        text = getattr(element, "text", "") or ""
        if not text.strip():
            continue
        metadata = getattr(element, "metadata", None)
        page_number = getattr(metadata, "page_number", 1) if metadata else 1
        section_type = element.__class__.__name__.lower()
        sections.append(
            PageSection(
                page_number=int(page_number),
                section_type=section_type,
                text=text.strip(),
                metadata={"source": "unstructured"},
            )
        )
    return sections


def parse_pdf_document(file_bytes: bytes, filename: str) -> ParsedDocument:
    if pdfplumber is None:
        raise ImportError("pdfplumber is required for PDF ingestion.")

    sections: list[PageSection] = []
    tables: list[dict[str, Any]] = []
    raw_text_parts: list[str] = []
    top_lines: list[str] = []
    bottom_lines: list[str] = []
    page_lines_map: dict[int, list[str]] = {}

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(layout=True) or ""
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            page_lines_map[page_index] = lines

            if lines:
                top_lines.append(lines[0])
                bottom_lines.append(lines[-1])
            raw_text_parts.append("\n".join(lines))

            for table in page.extract_tables() or []:
                rows = _table_to_rows(table)
                if not rows:
                    continue
                tables.append(
                    {
                        "page_number": page_index,
                        "row_count": len(rows),
                        "columns": list(rows[0].values.keys()),
                        "rows": [
                            {
                                "row_index": row.row_index,
                                "values": row.values,
                                "numeric_values": row.numeric_values,
                            }
                            for row in rows
                        ],
                    }
                )

    raw_text = "\n".join(part for part in raw_text_parts if part.strip())
    is_scanned = len(raw_text.replace("\n", "").strip()) < 80

    top_counter = Counter(top_lines)
    bottom_counter = Counter(bottom_lines)
    header_set = {line for line, count in top_counter.items() if count > 1}
    footer_set = {line for line, count in bottom_counter.items() if count > 1}

    for page_number, lines in page_lines_map.items():
        if not lines:
            continue
        page_header = lines[0] if lines and lines[0] in header_set else ""
        page_footer = lines[-1] if lines and lines[-1] in footer_set else ""
        body_lines = [line for line in lines if line not in {page_header, page_footer}]

        if page_header:
            sections.append(
                PageSection(
                    page_number=page_number,
                    section_type="header",
                    text=page_header,
                    metadata={"detected": "repeated"},
                )
            )
        if body_lines:
            sections.append(
                PageSection(
                    page_number=page_number,
                    section_type="body",
                    text="\n".join(body_lines),
                    metadata={},
                )
            )
        if page_footer:
            sections.append(
                PageSection(
                    page_number=page_number,
                    section_type="footer",
                    text=page_footer,
                    metadata={"detected": "repeated"},
                )
            )

    if is_scanned and get_settings().ocr_enabled:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page_number, page in enumerate(pdf.pages, start=1):
                ocr_text = _ocr_page_text(page).strip()
                if ocr_text:
                    sections.append(
                        PageSection(
                            page_number=page_number,
                            section_type="ocr_body",
                            text=ocr_text,
                            metadata={"source": "pytesseract"},
                        )
                    )
                    raw_text += f"\n{ocr_text}"

    if get_settings().use_unstructured_partition:
        for element in _partition_sections(file_bytes):
            sections.append(element)

    metadata = extract_invoice_metadata(raw_text, filename)

    return ParsedDocument(
        raw_text=raw_text,
        sections=sections,
        tables=tables,
        metadata=metadata,
        is_scanned=is_scanned,
    )
