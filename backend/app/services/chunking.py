from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from app.parsers.pdf_parser import ParsedDocument

TAX_TERMS = ("gst", "cgst", "sgst", "igst", "vat", "tax")
POLICY_TERMS = ("policy", "clause", "compliance", "agreement", "contract", "liability")


@dataclass
class ChunkDraft:
    chunk_type: str
    content: str
    metadata: dict[str, Any]


def _split_text(text: str, max_chars: int = 900, overlap: int = 120) -> list[str]:
    stripped = text.strip()
    if len(stripped) <= max_chars:
        return [stripped] if stripped else []

    sentences = re.split(r"(?<=[.!?])\s+", stripped)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= max_chars:
            current = f"{current} {sentence}".strip()
            continue
        if current:
            chunks.append(current)
        carry = current[-overlap:] if current else ""
        current = f"{carry} {sentence}".strip()
    if current:
        chunks.append(current)
    return chunks


def structure_aware_chunking(parsed_doc: ParsedDocument) -> list[ChunkDraft]:
    chunks: list[ChunkDraft] = []

    metadata_payload = {
        "bill_id": parsed_doc.metadata.get("bill_id"),
        "vendor": parsed_doc.metadata.get("vendor"),
        "date": str(parsed_doc.metadata.get("date") or ""),
        "total_amount": parsed_doc.metadata.get("total_amount"),
        "vendor_tax_id": parsed_doc.metadata.get("vendor_tax_id"),
        "is_scanned": parsed_doc.is_scanned,
    }
    chunks.append(
        ChunkDraft(
            chunk_type="invoice_metadata",
            content=json.dumps(metadata_payload, ensure_ascii=True),
            metadata={"section": "metadata"},
        )
    )

    for table in parsed_doc.tables:
        page = table.get("page_number")
        for row in table.get("rows", []):
            row_payload = {
                "columns": row.get("values", {}),
                "numeric_values": row.get("numeric_values", {}),
            }
            chunks.append(
                ChunkDraft(
                    chunk_type="line_item_row",
                    content=json.dumps(row_payload, ensure_ascii=True),
                    metadata={"page_number": page, "row_index": row.get("row_index")},
                )
            )

    for section in parsed_doc.sections:
        lowered = section.text.lower()
        if any(term in lowered for term in TAX_TERMS):
            for part in _split_text(section.text, max_chars=700):
                chunks.append(
                    ChunkDraft(
                        chunk_type="tax_block",
                        content=part,
                        metadata={"page_number": section.page_number, "source_type": section.section_type},
                    )
                )
            continue

        if any(term in lowered for term in POLICY_TERMS) or "title" in section.section_type:
            for part in _split_text(section.text):
                chunks.append(
                    ChunkDraft(
                        chunk_type="policy_section",
                        content=part,
                        metadata={"page_number": section.page_number, "source_type": section.section_type},
                    )
                )
            continue

        if section.section_type in {"header", "footer"}:
            chunks.append(
                ChunkDraft(
                    chunk_type=section.section_type,
                    content=section.text,
                    metadata={"page_number": section.page_number},
                )
            )
            continue

        for part in _split_text(section.text):
            chunks.append(
                ChunkDraft(
                    chunk_type="body_section",
                    content=part,
                    metadata={"page_number": section.page_number, "source_type": section.section_type},
                )
            )

    deduped: list[ChunkDraft] = []
    seen: set[tuple[str, str]] = set()
    for chunk in chunks:
        key = (chunk.chunk_type, chunk.content)
        if key in seen or not chunk.content.strip():
            continue
        seen.add(key)
        deduped.append(chunk)

    return deduped

