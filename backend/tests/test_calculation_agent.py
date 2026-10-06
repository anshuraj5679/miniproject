import json
import uuid
from datetime import date

from app.agents.calculation_agent import CalculationAgent
from app.services.retrieval import RetrievalHit


def _hit(content: str, total_amount: float | None = None, dt: date | None = None) -> RetrievalHit:
    return RetrievalHit(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        bill_id="INV-001",
        vendor="Acme Marketing",
        date=dt,
        total_amount=total_amount,
        chunk_type="line_item_row",
        content=content,
        summary="",
        metadata={},
        score=0.9,
        vector_score=0.8,
        keyword_score=0.7,
    )


def test_detects_gst_above_threshold() -> None:
    agent = CalculationAgent()
    payload = json.dumps({"numeric_values": {"taxable_amount": 200000, "gst_rate": 18, "gst_amount": 60000}})
    result = agent.execute("Show invoices where GST was incorrectly calculated above 50000", [_hit(payload)])
    assert result["gst_anomalies"]
    assert result["gst_anomalies"][0]["reason"] in {"gst_above_threshold", "gst_miscalculation"}


def test_detects_q3_outliers_against_q2() -> None:
    agent = CalculationAgent()
    hits = [
        _hit("{}", total_amount=1000, dt=date(2025, 4, 10)),
        _hit("{}", total_amount=1200, dt=date(2025, 5, 10)),
        _hit("{}", total_amount=1300, dt=date(2025, 6, 10)),
        _hit("{}", total_amount=7000, dt=date(2025, 8, 10)),
    ]
    result = agent.execute("Compare Q3 marketing bills with Q2 and highlight outliers", hits)
    assert result["outliers"]

