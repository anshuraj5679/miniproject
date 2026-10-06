from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
import sys
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.parsers.pdf_parser import extract_invoice_metadata


@dataclass
class EvalResult:
    sample_id: str
    total_fields: int
    matched_fields: int
    mismatches: list[str]

    @property
    def accuracy(self) -> float:
        if self.total_fields <= 0:
            return 1.0
        return self.matched_fields / self.total_fields


def _normalize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _numeric_close(left: Any, right: Any, tolerance: float = 0.02) -> bool:
    try:
        return abs(float(left) - float(right)) <= tolerance
    except (TypeError, ValueError):
        return False


def _match(expected: Any, actual: Any) -> bool:
    if expected is None and actual is None:
        return True
    expected_norm = _normalize(expected)
    actual_norm = _normalize(actual)
    if isinstance(expected_norm, float) or isinstance(actual_norm, float):
        return _numeric_close(expected_norm, actual_norm)
    return expected_norm == actual_norm


def run_eval(dataset_path: Path) -> tuple[list[EvalResult], float]:
    results: list[EvalResult] = []
    lines = dataset_path.read_text(encoding="utf-8").splitlines()
    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        sample = json.loads(raw)
        sample_id = str(sample.get("id") or "unknown")
        filename = str(sample.get("filename") or f"{sample_id}.txt")
        text = str(sample.get("text") or "")
        expected = sample.get("expected") or {}
        if not isinstance(expected, dict):
            expected = {}

        extracted = extract_invoice_metadata(text, filename)
        total_fields = 0
        matched_fields = 0
        mismatches: list[str] = []
        for key, expected_value in expected.items():
            total_fields += 1
            actual_value = extracted.get(key)
            if _match(expected_value, actual_value):
                matched_fields += 1
            else:
                mismatches.append(
                    f"{key}: expected={_normalize(expected_value)!r} actual={_normalize(actual_value)!r}"
                )
        results.append(
            EvalResult(
                sample_id=sample_id,
                total_fields=total_fields,
                matched_fields=matched_fields,
                mismatches=mismatches,
            )
        )

    global_accuracy = 1.0
    total = sum(item.total_fields for item in results)
    matched = sum(item.matched_fields for item in results)
    if total > 0:
        global_accuracy = matched / total
    return results, global_accuracy


def main() -> int:
    parser = argparse.ArgumentParser(description="Run extraction evals against a gold invoice dataset.")
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "evals" / "gold_invoices.jsonl",
        help="Path to JSONL dataset containing text and expected fields.",
    )
    parser.add_argument(
        "--min-accuracy",
        type=float,
        default=0.80,
        help="Fail when global field accuracy drops below this value.",
    )
    args = parser.parse_args()
    results, accuracy = run_eval(args.dataset)

    print(f"Dataset: {args.dataset}")
    print(f"Samples: {len(results)}")
    print(f"Global field accuracy: {accuracy:.4f}")
    for result in results:
        print(f"- {result.sample_id}: {result.accuracy:.4f} ({result.matched_fields}/{result.total_fields})")
        if result.mismatches:
            for mismatch in result.mismatches:
                print(f"  * {mismatch}")

    if accuracy < args.min_accuracy:
        print(
            f"FAILED: extraction accuracy {accuracy:.4f} is below threshold {args.min_accuracy:.4f}",
        )
        return 1
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
