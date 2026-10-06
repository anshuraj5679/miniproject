from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import QALog


def create_qa_log(
    db: Session,
    query: str,
    runtime_ms: int,
    precision: float,
    recall: float,
    hallucination_flag: bool,
    confidence_score: float,
    citations: list[dict],
    diagnostics: dict,
) -> QALog:
    log = QALog(
        query=query,
        runtime_ms=runtime_ms,
        precision_score=precision,
        recall_score=recall,
        hallucination_flag=hallucination_flag,
        confidence_score=confidence_score,
        citations=citations,
        diagnostics=diagnostics,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log

