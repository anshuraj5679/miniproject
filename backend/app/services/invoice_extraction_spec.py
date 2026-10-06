"""Provider-neutral spec for vision invoice extraction: one JSON schema and one prompt,
shared by every vision engine so their outputs can be compared field by field."""

from __future__ import annotations

from typing import Any


def _nullable(schema: dict[str, Any]) -> dict[str, Any]:
    return {"anyOf": [schema, {"type": "null"}]}


_STRING = _nullable({"type": "string"})
_NUMBER = _nullable({"type": "number"})
_DATE = _nullable({"type": "string", "format": "date"})

INVOICE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "bill_id": _STRING,
        "vendor": _STRING,
        "date": _DATE,
        "total_amount": _NUMBER,
        "vendor_tax_id": _STRING,
        "taxable_amount": _NUMBER,
        "gst_amount": _NUMBER,
        "gst_rate": _NUMBER,
        "cgst_amount": _NUMBER,
        "sgst_amount": _NUMBER,
        "igst_amount": _NUMBER,
        "product_name": _STRING,
        "brand": _STRING,
        "serial_number": _STRING,
        "warranty_months": _nullable({"type": "integer"}),
        "warranty_start": _DATE,
        "warranty_end": _DATE,
        "category": _STRING,
        "line_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "quantity": _NUMBER,
                    "unit_price": _NUMBER,
                    "amount": _NUMBER,
                },
                "required": ["name", "quantity", "unit_price", "amount"],
                "additionalProperties": False,
            },
        },
        "full_text": {"type": "string"},
    },
    "required": [
        "bill_id", "vendor", "date", "total_amount", "vendor_tax_id", "taxable_amount",
        "gst_amount", "gst_rate", "cgst_amount", "sgst_amount", "igst_amount",
        "product_name", "brand", "serial_number", "warranty_months", "warranty_start",
        "warranty_end", "category", "line_items", "full_text",
    ],
    "additionalProperties": False,
}

EXTRACTION_SYSTEM_PROMPT = """You extract structured data from photos and scans of Indian invoices, bills, \
receipts and warranty cards for SafeBill, a warranty-tracking app. Users rely on these values to \
claim warranties, so a wrong value is worse than a missing one: use null for any field that is \
not printed on the document rather than inferring it.

Field guidance:
- bill_id: the invoice / bill / receipt number exactly as printed (labels such as "Invoice No", \
"Invoice Number #", "Tax Invoice Number", "Bill No"). Not an order ID when an invoice number exists, \
never a file name, and never a company name.
- vendor: the seller's business name only (from "Sold By", "Seller", the letterhead), without address.
- date: the invoice date as YYYY-MM-DD. Indian documents usually write dates day-first (10.06.2025 is 10 June).
- total_amount: the final payable amount after discounts and tax ("Grand Total", "Total Amount After Tax", \
"Net Payable") - not the pre-discount gross or the taxable value.
- vendor_tax_id: the seller GSTIN (15 characters). Copy it character by character.
- taxable_amount, gst_amount, gst_rate, cgst_amount, sgst_amount, igst_amount: as printed; gst_rate as a percentage number.
- product_name: the main product (most expensive or first line item), including model number when printed.
- brand, serial_number (IMEI / serial / S/N), warranty_months, warranty_start, warranty_end, category: \
only when visible or directly stated.
- line_items: one entry per product line; amount is the line total after discount.
- full_text: all readable text on the document, top to bottom, preserving line breaks.

Amounts are plain numbers without currency symbols or thousands separators."""

EXTRACTION_USER_PROMPT = "Extract the invoice fields and the full text from this document."
