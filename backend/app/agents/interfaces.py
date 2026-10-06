from __future__ import annotations

from typing import Any, Protocol

from sqlalchemy.orm import Session

from app.schemas import MetadataFilter
from app.services.retrieval import RetrievalHit


class RetrievalAgentInterface(Protocol):
    def retrieve(self, db: Session, query: str, filters: MetadataFilter, top_k: int) -> list[RetrievalHit]: ...


class CalculationAgentInterface(Protocol):
    def execute(self, query: str, hits: list[RetrievalHit]) -> dict[str, Any]: ...
    def validate_answer_math(self, answer_payload: dict[str, Any], calculations: dict[str, Any]) -> dict[str, Any]: ...


class PolicyAgentInterface(Protocol):
    def evaluate(self, query: str, hits: list[RetrievalHit], calculations: dict[str, Any]) -> dict[str, Any]: ...


class AuditorAgentInterface(Protocol):
    def audit(self, answer_payload: dict[str, Any], hits: list[RetrievalHit], math_validation: dict[str, Any]): ...

