from __future__ import annotations

from datetime import date, timedelta

from app.services.extraction_pipeline import (
    build_review_fields,
    compute_field_confidences,
    ensure_strict_extraction,
    estimate_claim_readiness,
    merge_engine_results,
)


def test_merge_engine_results_prefers_high_confidence_consensus() -> None:
    openai_meta = ensure_strict_extraction(
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
                "engine": "openai_vision",
                "metadata": openai_meta,
                "field_confidences": compute_field_confidences(
                    metadata=openai_meta,
                    engine="openai_vision",
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
    assert sources["bill_id"] in {"openai_vision", "tesseract_regex"}


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
