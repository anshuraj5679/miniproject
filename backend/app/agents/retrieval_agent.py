from __future__ import annotations

from sqlalchemy.orm import Session

from app.schemas import MetadataFilter
from app.services.retrieval import HybridRetriever, RetrievalHit


class RetrievalAgent:
    def __init__(self, retriever: HybridRetriever | None = None) -> None:
        self.retriever = retriever or HybridRetriever()

    def retrieve(self, db: Session, query: str, filters: MetadataFilter, top_k: int) -> list[RetrievalHit]:
        return self.retriever.retrieve(db=db, query=query, filters=filters, top_k=top_k)

