from __future__ import annotations

from datetime import date

from app.services.gst_compliance import validate_gstin, validate_invoice_compliance


def test_validate_gstin_checksum_and_format() -> None:
    valid = validate_gstin("19AAACL5662Q1ZT")
    assert valid["present"] is True
    assert valid["valid_format"] is True
    assert valid["valid_checksum"] is True

    invalid = validate_gstin("19AAACL5662Q1ZX")
    assert invalid["present"] is True
    assert invalid["valid_format"] is True
    assert invalid["valid_checksum"] is False


def test_validate_invoice_compliance_flags_tax_split_conflict() -> None:
    payload = validate_invoice_compliance(
        metadata={
            "bill_id": "INV-1",
            "vendor": "Acme",
            "date": "2026-02-01",
            "total_amount": 1000,
            "vendor_tax_id": "19AAACL5662Q1ZT",
            "taxable_amount": 800,
            "gst_amount": 144,
            "gst_rate": 18,
            "cgst_amount": 72,
            "sgst_amount": 72,
            "igst_amount": 10,
            "line_items": [{"name": "Phone", "amount": 800}],
        },
        raw_text="Tax Invoice",
        today=date(2026, 2, 14),
    )
    alert_codes = {item["code"] for item in payload["alerts"]}
    assert "TAX_SPLIT_CONFLICT" in alert_codes
    assert payload["tax_validation"]["tax_split_mode"] == "mixed_invalid"


def test_validate_invoice_compliance_flags_einvoice_late_risk() -> None:
    payload = validate_invoice_compliance(
        metadata={
            "bill_id": "INV-2",
            "vendor": "Acme",
            "date": "2026-01-01",
            "total_amount": 1200,
            "vendor_tax_id": "19AAACL5662Q1ZT",
            "line_items": [{"name": "Laptop", "amount": 1200}],
        },
        raw_text="Tax Invoice GSTIN 19AAACL5662Q1ZT",
        today=date(2026, 2, 14),
    )
    alert_codes = {item["code"] for item in payload["alerts"]}
    assert "EINV_LATE_REPORT_RISK" in alert_codes
    assert payload["invoice"]["einvoice_requirement_signal"] in {"possible", "satisfied"}
