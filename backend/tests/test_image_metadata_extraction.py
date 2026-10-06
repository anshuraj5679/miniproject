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


def test_extract_invoice_metadata_from_warranty_certificate_style_text() -> None:
    ocr_text = """
    WARRANTY CERTIFICATE (SAMPLE TEMPLATE)

    Company Name: XYZ Electronics Pvt. Ltd.
    Product Name: UltraSmart LED Television 42-inch
    Model Number: US-LED42X2026
    Serial Number: SN1234567890
    Invoice/Bill Number: INV-2026-001245
    Purchase Date: 10-Feb-2026
    Warranty Period: 24 Months from Purchase Date
    """
    metadata = extract_invoice_metadata(ocr_text, "warranty.png")

    assert metadata["bill_id"] == "INV-2026-001245"
    assert metadata["vendor"] == "XYZ Electronics Pvt. Ltd."
    assert metadata["date"] == date(2026, 2, 10)
    assert metadata["total_amount"] is None
    assert metadata["serial_number"] == "SN1234567890"
    assert metadata["warranty_months"] == 24
    assert metadata["warranty_start"] == date(2026, 2, 10)
    assert metadata["warranty_end"] == date(2028, 2, 10)


def test_extract_invoice_metadata_ignores_customer_number_in_line_items() -> None:
    ocr_text = """
    Tax Invoice
    Apple India Private Limited
    Apple Document Number: MB78190631
    Tax Invoice Date: 10.06.2025
    Customer Number: 919115
    Place of Supply: KAR
    iPAD WIFI 128GB BLU-HIN CN 84713090 1 27881.36 27881.36 5018.64 18.00
    """
    metadata = extract_invoice_metadata(ocr_text, "apple-tax-invoice.png")

    line_items = metadata.get("line_items") or []
    assert all("customer number" not in str(item.get("name", "")).lower() for item in line_items)
    assert all(float(item.get("amount") or 0.0) != 919115.0 for item in line_items)
    assert str(metadata.get("product_name") or "").lower() != "customer number"
    assert any("ipad wifi 128gb" in str(item.get("name", "")).lower() for item in line_items)
    assert any(abs(float(item.get("amount") or 0.0) - 27881.36) < 0.01 for item in line_items)


def test_extract_invoice_metadata_from_tools_invoice_avoids_address_and_pincode_mapping() -> None:
    ocr_text = """
    Gujarat Freight Tools
    Plot No A 64, Road No 21, Waghle Indl Estate, Mumbai, Maharashtra - 360001
    GSTIN : 27CORPP3939N1ZQ
    TAX INVOICE
    Invoice No. GST-3525-26
    Invoice Date 23-Jul-2025
    1 Bosh All-in-One Metal Hand Tool Kit 8302 1 NOS 2535.00 2535.00 18.00 456.30 2991.30
    2 Taparia Universal Tool Kit 8302 1 NOS 1270.00 1270.00 18.00 228.60 1498.60
    Taxable Amount 3805.00
    Total Tax 684.90
    Total Amount After Tax ₹4,490.00
    """
    metadata = extract_invoice_metadata(ocr_text, "gujarat-tools.png")

    assert metadata["vendor"] == "Gujarat Freight Tools"
    assert metadata["bill_id"] == "GST-3525-26"
    assert abs(float(metadata["total_amount"] or 0.0) - 4490.0) < 0.01
    assert str(metadata.get("product_name") or "").lower().startswith("bosh all-in-one metal hand tool kit")

    line_items = metadata.get("line_items") or []
    assert any(abs(float(item.get("amount") or 0.0) - 2991.30) < 0.01 for item in line_items)
    assert any(abs(float(item.get("amount") or 0.0) - 1498.60) < 0.01 for item in line_items)
    assert all(float(item.get("amount") or 0.0) != 8302.0 for item in line_items)


def test_extract_invoice_metadata_from_multiline_tools_ocr_text() -> None:
    ocr_text = """
    Gujarat Freight Tools
    Plot No A 64, Road No 21, Waghle Indl Estate, Mumbai, Maharashtra - 360001
    GSTIN: 27CORPP3939N1ZQ
    TAX INVOICE
    M/S
    Address
    Shiv Engineering
    Invoice No.
    GST-3525-26
    Phone
    Sumel Business Park 7, Kochi, Kerala - 380023
    9878789878
    Invoice Date
    Challan Date
    23-Jul-2025
    23-Jul-2025
    GSTIN
    32AABBA7890B1ZB
    Place of
    Kerala (32)
    Transport ID
    24ABSFS0321B2ZL
    Name of Product/Service
    HSN/SAC
    Qty
    Rate
    Taxable Value
    Total
    % Amount
    1
    Bosch All-in-One Metal Hand Tool Kit
    2 Taparia Universal Tool Kit
    8302
    8302
    1 NOS
    1 NOS
    2,535.00
    1,270.00
    2,535.00 18.00
    456.30
    1,270.00 18.00
    228.60
    2,991.30
    1,498.60
    Total
    2 NOS
    Total in words: FOUR THOUSAND FOUR HUNDRED AND NINETY RUPEES ONLY
    3,805.00
    684.90
    Taxable Amount
    Total Tax
    4,489.90
    3,805.00
    684.90
    Total Amount After
    """

    metadata = extract_invoice_metadata(ocr_text, "gujarat-tools-multiline.png")

    assert metadata["bill_id"] == "GST-3525-26"
    assert metadata["vendor"] == "Gujarat Freight Tools"
    assert abs(float(metadata["total_amount"] or 0.0) - 4489.9) < 0.01
    assert abs(float(metadata["taxable_amount"] or 0.0) - 3805.0) < 0.01
    assert abs(float(metadata["gst_amount"] or 0.0) - 684.9) < 0.01
    assert str(metadata.get("product_name") or "").lower().startswith("bosch all-in-one metal hand tool kit")

    line_items = metadata.get("line_items") or []
    assert len(line_items) >= 2
    assert any("bosch all-in-one metal hand tool kit" in str(item.get("name") or "").lower() for item in line_items)
    assert any("taparia universal tool kit" in str(item.get("name") or "").lower() for item in line_items)
    assert all("32aabba7890b1zb" not in str(item.get("name") or "").lower() for item in line_items)
    assert all("kerala" not in str(item.get("name") or "").lower() for item in line_items)
