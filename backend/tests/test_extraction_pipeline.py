from __future__ import annotations

from datetime import date, timedelta

from app.api.routes import _merge_invoice_metadata
from app.services.extraction_pipeline import (
    build_review_fields,
    compute_field_confidences,
    ensure_strict_extraction,
    estimate_claim_readiness,
    merge_engine_results,
    prefer_grounded_ocr_fields,
    sanitize_merchandise_name,
)


def test_merge_engine_results_prefers_high_confidence_consensus() -> None:
    vision_meta = ensure_strict_extraction(
        {
            "bill_id": "QEAC-7547",
            "vendor": "Lalani Info Tech Limited",
            "date": "2018-03-30",
            "total_amount": 6180.0,
        }
    )
    regex_meta = ensure_strict_extraction(
        {
            "bill_id": "QEAC-7547",
            "vendor": "Lalani Info Tech Limited",
            "date": "2018-03-30",
            "total_amount": 6179.0,
        }
    )
    merged, confidences, sources = merge_engine_results(
        [
            {
                "engine": "aws_bedrock_vision",
                "metadata": vision_meta,
                "field_confidences": compute_field_confidences(
                    metadata=vision_meta,
                    engine="aws_bedrock_vision",
                    text_quality=0.95,
                ),
            },
            {
                "engine": "tesseract_regex",
                "metadata": regex_meta,
                "field_confidences": compute_field_confidences(
                    metadata=regex_meta,
                    engine="tesseract_regex",
                    text_quality=0.8,
                ),
            },
        ]
    )
    assert merged["bill_id"] == "QEAC-7547"
    assert merged["vendor"] == "Lalani Info Tech Limited"
    assert confidences["bill_id"] > 0.6
    assert sources["bill_id"] in {"aws_bedrock_vision", "tesseract_regex"}


def test_build_review_fields_returns_low_confidence_required_fields() -> None:
    field_confidences = {
        "bill_id": 0.9,
        "vendor": 0.4,
        "date": 0.95,
        "total_amount": 0.3,
        "product_name": 0.8,
        "warranty_end": 0.2,
    }
    low = build_review_fields(field_confidences, threshold=0.6)
    assert "vendor" in low
    assert "total_amount" in low
    assert "warranty_end" in low
    assert "bill_id" not in low


def test_estimate_claim_readiness_penalizes_missing_fields_and_deadline() -> None:
    readiness = estimate_claim_readiness(
        warranty_end=date.today() + timedelta(days=2),
        now=date.today(),
        has_invoice_number=True,
        has_vendor=True,
        has_purchase_date=False,
        has_amount=True,
        has_serial=False,
        has_service_centers=False,
    )
    assert readiness["score"] < 0.75
    assert "purchase_date" in readiness["missing"]
    assert "serial_number" in readiness["missing"]


def test_ensure_strict_extraction_parses_non_iso_dates_and_sanitizes_dimension_totals() -> None:
    parsed = ensure_strict_extraction(
        {
            "date": "10-Feb-2026",
            "warranty_start": "10 Feb 2026",
            "warranty_end": "Feb 10, 2028",
            "product_name": "UltraSmart LED Television 42-inch",
            "total_amount": 42,
        }
    )
    assert parsed["date"] == "2026-02-10"
    assert parsed["warranty_start"] == "2026-02-10"
    assert parsed["warranty_end"] == "2028-02-10"
    assert parsed["total_amount"] is None


def test_ensure_strict_extraction_filters_identifier_line_items() -> None:
    parsed = ensure_strict_extraction(
        {
            "line_items": [
                {"name": "Customer Number", "amount": 919115},
                {"name": "iPad WiFi 128GB", "amount": 27881.36},
            ]
        }
    )
    assert len(parsed["line_items"]) == 1
    assert parsed["line_items"][0]["name"] == "iPad WiFi 128GB"
    assert parsed["line_items"][0]["amount"] == 27881.36


def test_sanitize_merchandise_name_trims_table_noise() -> None:
    cleaned = sanitize_merchandise_name("000010 PD4A4HN/A IPAD WIFI 128GB BLU-HIN 84713090 1 27,881.36 27,881.36")
    assert cleaned == "IPAD WIFI 128GB BLU-HIN"


def test_sanitize_merchandise_name_rejects_identifier_and_quantity_noise() -> None:
    assert sanitize_merchandise_name("32AABBA7890B1ZB") is None
    assert sanitize_merchandise_name("1 NOS") is None


def test_ensure_strict_extraction_derives_total_from_taxable_and_gst() -> None:
    parsed = ensure_strict_extraction(
        {
            "total_amount": 27881.36,
            "taxable_amount": 27881.36,
            "gst_amount": 5018.64,
            "product_name": "000010 PD4A4HN/A IPAD WIFI 128GB BLU-HIN 84713090 1 27881.36",
            "line_items": [
                {"name": "000010 PD4A4HN/A IPAD WIFI 128GB BLU-HIN 84713090 1 27881.36", "amount": 27881.36}
            ],
        }
    )
    assert parsed["product_name"] == "IPAD WIFI 128GB BLU-HIN"
    assert parsed["line_items"][0]["name"] == "IPAD WIFI 128GB BLU-HIN"
    assert parsed["total_amount"] == 32900.0


def test_ensure_strict_extraction_rejects_address_product_and_outlier_total() -> None:
    parsed = ensure_strict_extraction(
        {
            "product_name": "Plot No A 64, Road No 21, Waghle Indl Estate, Mumbai, Maharashtra 360001",
            "total_amount": 360001.0,
            "taxable_amount": 3805.0,
            "gst_amount": 684.9,
            "line_items": [
                {"name": "1 Bosh All-in-One Metal Hand Tool Kit 8302 1 NOS 2535.00 2535.00 18.00 456.30 2991.30", "amount": 2991.30},
                {"name": "2 Taparia Universal Tool Kit 8302 1 NOS 1270.00 1270.00 18.00 228.60 1498.60", "amount": 1498.60},
            ],
        }
    )

    assert parsed["product_name"] == "Bosh All-in-One Metal Hand Tool Kit"
    assert abs(float(parsed["total_amount"] or 0.0) - 4489.9) < 0.01
    assert parsed["line_items"][0]["name"] == "Bosh All-in-One Metal Hand Tool Kit"


def test_merge_invoice_metadata_keeps_parser_fields_when_preferred_values_are_suspicious() -> None:
    fallback = ensure_strict_extraction(
        {
            "bill_id": "GST-3525-26",
            "vendor": "Gujarat Freight Tools",
            "total_amount": 4490.0,
            "product_name": "Bosh All-in-One Metal Hand Tool Kit",
            "line_items": [
                {"name": "Bosh All-in-One Metal Hand Tool Kit", "amount": 2991.30},
                {"name": "Taparia Universal Tool Kit", "amount": 1498.60},
            ],
        }
    )
    preferred = ensure_strict_extraction(
        {
            "bill_id": "GST-3525-26-804088",
            "vendor": "Gujarat Freight Tools",
            "total_amount": 360001.0,
            "product_name": "Plot No A 64, Road No 21, Waghle Indl Estate, Mumbai, Maharashtra 360001",
            "line_items": [{"name": "Plot No A 64, Road No 21, Waghle Indl Estate, Mumbai, Maharashtra 360001", "amount": 360001.0}],
        }
    )

    merged = ensure_strict_extraction(_merge_invoice_metadata(preferred, fallback))

    assert merged["bill_id"] == "GST-3525-26"
    assert merged["product_name"] == "Bosh All-in-One Metal Hand Tool Kit"
    assert merged["total_amount"] == 4490.0
    assert len(merged["line_items"]) == 2


def test_prefer_grounded_ocr_fields_blocks_bedrock_field_drift() -> None:
    grounded = ensure_strict_extraction(
        {
            "bill_id": "GST-3525-26",
            "vendor": "Gujarat Freight Tools",
            "date": "2025-07-23",
            "total_amount": 4490.0,
            "taxable_amount": 3805.0,
            "gst_amount": 684.9,
            "gst_rate": 18.0,
            "product_name": "Bosh All-in-One Metal Hand Tool Kit",
            "line_items": [
                {"name": "Bosh All-in-One Metal Hand Tool Kit", "amount": 2991.30},
                {"name": "Taparia Universal Tool Kit", "amount": 1498.60},
            ],
        }
    )
    merged = ensure_strict_extraction(
        {
            "bill_id": "GST-3525-26-931478",
            "vendor": "Gujarat Freight Tools",
            "date": "2025-07-23",
            "total_amount": 2025.0,
            "taxable_amount": 3805.0,
            "gst_amount": 684.9,
            "gst_rate": 18.0,
            "product_name": "23-Jul-2025",
            "line_items": [{"name": "23-Jul-2025", "amount": 2025.0}],
            "brand": "Gujarat Freight Tools",
            "category": "Others",
        }
    )

    stabilized, confidence_map, source_map = prefer_grounded_ocr_fields(
        merged,
        grounded,
        confidence_map={"product_name": 0.95, "total_amount": 0.95, "bill_id": 0.95},
        source_map={"product_name": "aws_bedrock_vision", "total_amount": "aws_bedrock_vision", "bill_id": "aws_bedrock_vision"},
        grounded_confidence_map={"product_name": 0.86, "total_amount": 0.86, "bill_id": 0.86},
        grounded_source_map={"product_name": "google_vision", "total_amount": "google_vision", "bill_id": "google_vision"},
    )

    assert stabilized["bill_id"] == "GST-3525-26"
    assert stabilized["product_name"] == "Bosh All-in-One Metal Hand Tool Kit"
    assert stabilized["total_amount"] == 4490.0
    assert len(stabilized["line_items"]) == 2
    assert confidence_map["product_name"] == 0.86
    assert source_map["product_name"] == "google_vision"
