from __future__ import annotations

from pathlib import Path

from scripts.run_extraction_evals import run_eval


def test_run_extraction_evals_returns_accuracy() -> None:
    dataset = Path(__file__).resolve().parents[1] / "evals" / "gold_invoices.jsonl"
    results, accuracy = run_eval(dataset)
    assert results
    assert 0.0 <= accuracy <= 1.0
    assert accuracy >= 0.5
