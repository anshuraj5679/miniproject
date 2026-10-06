from __future__ import annotations

import json
from typing import Any

from app.services.retrieval import RetrievalHit


class PolicyAgent:
    def evaluate(self, query: str, hits: list[RetrievalHit], calculations: dict[str, Any]) -> dict[str, Any]:
        lowered = query.lower()
        missing_tax_ids: list[dict[str, Any]] = []
        compliance_flags: list[dict[str, Any]] = []

        for hit in hits:
            if hit.chunk_type != "invoice_metadata":
                continue
            try:
                payload = json.loads(hit.content)
            except json.JSONDecodeError:
                payload = {}
            tax_id = payload.get("vendor_tax_id")
            if not tax_id:
                missing_tax_ids.append(
                    {"bill_id": hit.bill_id, "vendor": hit.vendor, "chunk_id": str(hit.chunk_id), "reason": "missing_tax_id"}
                )

        if calculations.get("gst_anomalies"):
            for anomaly in calculations["gst_anomalies"]:
                compliance_flags.append(
                    {
                        "bill_id": anomaly.get("bill_id"),
                        "vendor": anomaly.get("vendor"),
                        "reason": anomaly.get("reason"),
                        "severity": "high",
                    }
                )

        if "missing vendor tax id" in lowered or "missing tax id" in lowered:
            primary = missing_tax_ids
        else:
            primary = compliance_flags

        return {
            "missing_vendor_tax_ids": missing_tax_ids,
            "compliance_flags": compliance_flags,
            "primary_findings": primary,
        }

