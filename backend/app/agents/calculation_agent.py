from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from datetime import date
from statistics import mean, pstdev
from typing import Any

from app.services.retrieval import RetrievalHit

NUMBER_RE = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?")


class CalculationAgent:
    @staticmethod
    def _parse_threshold(query: str, default: float = 50000.0) -> float:
        matches = NUMBER_RE.findall(query.replace("₹", "").replace(",", ""))
        if not matches:
            return default
        try:
            return float(matches[-1])
        except ValueError:
            return default

    @staticmethod
    def _quarter(dt: date | None) -> str:
        if not dt:
            return "unknown"
        quarter = (dt.month - 1) // 3 + 1
        return f"Q{quarter}-{dt.year}"

    @staticmethod
    def _extract_numbers(text: str) -> list[float]:
        values = []
        for match in NUMBER_RE.findall(text.replace(",", "")):
            try:
                values.append(float(match))
            except ValueError:
                continue
        return values

    @staticmethod
    def _safe_json(raw: str) -> dict[str, Any]:
        try:
            payload = json.loads(raw)
            return payload if isinstance(payload, dict) else {}
        except json.JSONDecodeError:
            return {}

    def execute(self, query: str, hits: list[RetrievalHit]) -> dict[str, Any]:
        lowered = query.lower()
        threshold = self._parse_threshold(query)
        gst_anomalies: list[dict[str, Any]] = []
        quarter_totals: dict[str, list[float]] = defaultdict(list)
        outliers: list[dict[str, Any]] = []

        for hit in hits:
            if hit.total_amount is not None:
                quarter_totals[self._quarter(hit.date)].append(float(hit.total_amount))

            payload = self._safe_json(hit.content)
            values = payload.get("numeric_values", {}) if isinstance(payload.get("numeric_values"), dict) else {}
            if not values:
                values = {f"n_{idx}": number for idx, number in enumerate(self._extract_numbers(hit.content))}

            gst_amount = None
            taxable_amount = None
            gst_rate = None
            for key, value in values.items():
                key_lower = key.lower()
                numeric = float(value)
                if "gst" in key_lower or "tax" in key_lower:
                    gst_amount = max(gst_amount or 0.0, numeric)
                if "taxable" in key_lower or "subtotal" in key_lower or key_lower == "amount":
                    taxable_amount = numeric
                if "rate" in key_lower or "%" in key_lower:
                    gst_rate = numeric

            if gst_amount is not None and gst_amount > threshold:
                gst_anomalies.append(
                    {
                        "chunk_id": str(hit.chunk_id),
                        "bill_id": hit.bill_id,
                        "vendor": hit.vendor,
                        "gst_amount": round(gst_amount, 2),
                        "threshold": threshold,
                        "reason": "gst_above_threshold",
                    }
                )

            if gst_amount is not None and taxable_amount is not None and gst_rate is not None:
                expected = taxable_amount * (gst_rate / 100.0)
                delta = abs(gst_amount - expected)
                tolerance = max(2.0, expected * 0.02)
                if delta > tolerance:
                    gst_anomalies.append(
                        {
                            "chunk_id": str(hit.chunk_id),
                            "bill_id": hit.bill_id,
                            "vendor": hit.vendor,
                            "gst_amount": round(gst_amount, 2),
                            "expected_gst_amount": round(expected, 2),
                            "delta": round(delta, 2),
                            "reason": "gst_miscalculation",
                        }
                    )

        if "compare" in lowered and ("q3" in lowered or "q2" in lowered):
            q2_values = quarter_totals.get(next((key for key in quarter_totals if key.startswith("Q2")), "Q2"), [])
            q3_values = quarter_totals.get(next((key for key in quarter_totals if key.startswith("Q3")), "Q3"), [])
            baseline = q2_values or q3_values
            baseline_mean = mean(baseline) if baseline else 0.0
            baseline_std = pstdev(baseline) if len(baseline) > 1 else 0.0

            for hit in hits:
                if hit.total_amount is None or not hit.date:
                    continue
                q = self._quarter(hit.date)
                if not q.startswith("Q3"):
                    continue
                amount = float(hit.total_amount)
                if baseline_std <= 0:
                    if baseline_mean > 0 and amount > baseline_mean * 1.5:
                        outliers.append(
                            {
                                "bill_id": hit.bill_id,
                                "vendor": hit.vendor,
                                "amount": amount,
                                "quarter": q,
                                "reason": "high_relative_to_baseline",
                            }
                        )
                    continue
                z_score = (amount - baseline_mean) / baseline_std
                if abs(z_score) >= 2.0:
                    outliers.append(
                        {
                            "bill_id": hit.bill_id,
                            "vendor": hit.vendor,
                            "amount": amount,
                            "quarter": q,
                            "z_score": round(z_score, 2),
                            "reason": "statistical_outlier",
                        }
                    )

        total_amount_sum = round(sum(float(hit.total_amount or 0.0) for hit in hits), 2)
        return {
            "threshold": threshold,
            "gst_anomalies": gst_anomalies,
            "quarter_totals": {key: round(sum(values), 2) for key, values in quarter_totals.items()},
            "outliers": outliers,
            "document_total_sum": total_amount_sum,
        }

    def validate_answer_math(self, answer_payload: dict[str, Any], calculations: dict[str, Any]) -> dict[str, Any]:
        numeric_claims = answer_payload.get("numeric_claims", [])
        mismatches = []
        for claim in numeric_claims:
            expected_key = claim.get("metric")
            expected_value = calculations.get(expected_key)
            claimed_value = claim.get("value")
            if expected_value is None or claimed_value is None:
                continue
            try:
                delta = abs(float(claimed_value) - float(expected_value))
            except (TypeError, ValueError):
                delta = math.inf
            if delta > 0.01:
                mismatches.append(
                    {
                        "metric": expected_key,
                        "expected": expected_value,
                        "claimed": claimed_value,
                        "delta": delta,
                    }
                )
        return {"mismatches": mismatches, "valid": len(mismatches) == 0}

