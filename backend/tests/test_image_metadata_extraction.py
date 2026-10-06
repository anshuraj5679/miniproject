from __future__ import annotations

from datetime import date

from app.api.routes import _infer_locker_category
from app.parsers.pdf_parser import extract_invoice_metadata


def test_extract_invoice_metadata_does_not_use_document_suffix_as_bill_id() -> None:
    metadata = extract_invoice_metadata(
        "Scanned image document: Screenshot 2026-02-14 014701.png",
        "Screenshot 2026-02-14 014701.png",
    )
    assert metadata["bill_id"] == "Screenshot 2026-02-14 014701"


def test_extract_invoice_metadata_from_amazon_style_ocr_text() -> None:
    ocr_text = """
    amazon.in
    Tax Invoice/Bill of Supply/Cash Memo
    Sold By:
    Lalani Info Tech Limited
    PAN No: AAACL5662Q
    GST Registration No: 19AAACL5662Q1ZT
    Order Number: 171-9054163-6711503
    Invoice Number: QEAC-7547
    Invoice Date: 30.03.2018
    TOTAL: INR 6,180.00
    """
    metadata = extract_invoice_metadata(ocr_text, "invoice.png")

    assert metadata["bill_id"] == "QEAC-7547"
    assert metadata["vendor"] == "Lalani Info Tech Limited"
    assert metadata["date"] == date(2018, 3, 30)
    assert metadata["total_amount"] == 6180.0


def test_infer_locker_category_maps_nokia_phone_to_gadgets() -> None:
    category = _infer_locker_category(
        product_name="Nokia 2 (Pewter/Black) | B07846F3SX",
        brand="Nokia",
        vendor="Lalani Info Tech Limited",
        line_items=[{"name": "Nokia 2 (Pewter/Black)", "amount": 5517.86}],
        source_category="Others",
    )
    assert category == "Gadgets"


def test_infer_locker_category_preserves_valid_source_category() -> None:
    category = _infer_locker_category(
        product_name="Samsung Refrigerator 300L",
        brand="Samsung",
        vendor="Retail Store",
        line_items=[],
        source_category="Appliances",
    )
    assert category == "Appliances"
