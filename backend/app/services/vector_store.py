from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.config import get_settings

try:
    from pinecone import Pinecone
except Exception:  # pragma: no cover - optional runtime dependency
    Pinecone = None  # type: ignore[assignment]


@dataclass
class VectorCandidate:
    id: str
    score: float


class PineconeVectorStore:
    def __init__(self) -> None:
        settings = get_settings()
        self.enabled = bool(
            settings.use_pinecone
            and settings.pinecone_api_key
            and settings.pinecone_index_name
            and Pinecone is not None
        )
        self.namespace = settings.pinecone_namespace or ""
        self.index = None

        if not self.enabled:
            return

        try:
            client = Pinecone(api_key=settings.pinecone_api_key)
            self.index = client.Index(settings.pinecone_index_name)
        except Exception:
            # Fail open: backend continues with pgvector retrieval.
            self.enabled = False
            self.index = None

    def upsert(self, vectors: list[dict[str, Any]]) -> None:
        if not self.enabled or self.index is None or not vectors:
            return
        try:
            kwargs: dict[str, Any] = {"vectors": vectors}
            if self.namespace:
                kwargs["namespace"] = self.namespace
            self.index.upsert(**kwargs)
        except Exception:
            # Best-effort write path; retrieval will fall back to pgvector.
            return

    def query(self, embedding: list[float], top_k: int) -> list[VectorCandidate]:
        if not self.enabled or self.index is None or not embedding:
            return []

        try:
            kwargs: dict[str, Any] = {"vector": embedding, "top_k": top_k, "include_metadata": False}
            if self.namespace:
                kwargs["namespace"] = self.namespace
            response = self.index.query(**kwargs)
        except Exception:
            return []

        raw_matches = getattr(response, "matches", None) or []
        candidates: list[VectorCandidate] = []
        for match in raw_matches:
            if isinstance(match, dict):
                raw_id = match.get("id")
                raw_score = match.get("score", 0.0)
            else:
                raw_id = getattr(match, "id", None)
                raw_score = getattr(match, "score", 0.0)
            if not raw_id:
                continue
            try:
                score = float(raw_score or 0.0)
            except (TypeError, ValueError):
                score = 0.0
            candidates.append(VectorCandidate(id=str(raw_id), score=score))
        return candidates
