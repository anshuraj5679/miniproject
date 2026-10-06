from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.services.retrieval import RetrievalHit


@dataclass
class AuditResult:
    precision: float
    recall: float
    hallucination_flag: bool
    confidence_score: float
    diagnostics: dict[str, Any]


class AuditorAgent:
    def audit(
        self,
        answer_payload: dict[str, Any],
        hits: list[RetrievalHit],
        math_validation: dict[str, Any],
    ) -> AuditResult:
        cited_chunk_ids = set(str(item) for item in answer_payload.get("citation_chunk_ids", []))
        available_chunk_ids = {str(hit.chunk_id) for hit in hits}
        valid_citations = cited_chunk_ids.intersection(available_chunk_ids)

        claims = answer_payload.get("claims", [])
        grounded_claims = 0
        for claim in claims:
            claim_citations = set(str(item) for item in claim.get("citations", []))
            if claim_citations and claim_citations.issubset(available_chunk_ids):
                grounded_claims += 1

        precision = grounded_claims / max(len(claims), 1)
        recall = len(valid_citations) / max(len(available_chunk_ids), 1)
        math_ok = bool(math_validation.get("valid", False))
        hallucination_flag = precision < 1.0 or not math_ok or len(valid_citations) == 0

        retrieval_signal = max((hit.score for hit in hits), default=0.0)
        confidence = 0.45 * precision + 0.25 * recall + 0.2 * min(retrieval_signal, 1.0) + 0.1 * (1.0 if math_ok else 0.0)
        confidence = round(max(0.0, min(confidence, 1.0)), 4)

        return AuditResult(
            precision=round(precision, 4),
            recall=round(recall, 4),
            hallucination_flag=hallucination_flag,
            confidence_score=confidence,
            diagnostics={
                "valid_citation_count": len(valid_citations),
                "total_citation_count": len(cited_chunk_ids),
                "grounded_claim_count": grounded_claims,
                "total_claim_count": len(claims),
                "math_validation": math_validation,
            },
        )

