from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from uuid import UUID

from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.orm import Session

from app.models import Chunk, Document
from app.core.config import get_settings
from app.schemas import MetadataFilter
from app.services.embeddings import EmbeddingService
from app.services.vector_store import PineconeVectorStore


@dataclass
class RetrievalHit:
    chunk_id: UUID
    document_id: UUID
    bill_id: str
    vendor: str
    date: date | None
    total_amount: float | None
    chunk_type: str
    content: str
    summary: str
    metadata: dict
    score: float
    vector_score: float
    keyword_score: float


class HybridRetriever:
    def __init__(
        self,
        embedding_service: EmbeddingService | None = None,
        vector_store: PineconeVectorStore | None = None,
    ) -> None:
        self.settings = get_settings()
        self.embedding_service = embedding_service or EmbeddingService()
        self.vector_store = vector_store or PineconeVectorStore()

    def _apply_filters(self, stmt, filters: MetadataFilter | None):
        if not filters:
            return stmt

        clauses = []
        if filters.vendor:
            clauses.append(Document.vendor.ilike(f"%{filters.vendor}%"))
        if filters.bill_id:
            clauses.append(Document.bill_id == filters.bill_id)
        if filters.date_from:
            clauses.append(Document.date >= filters.date_from)
        if filters.date_to:
            clauses.append(Document.date <= filters.date_to)
        if filters.min_amount is not None:
            clauses.append(Document.total_amount >= filters.min_amount)
        if filters.max_amount is not None:
            clauses.append(Document.total_amount <= filters.max_amount)
        if filters.user_id:
            clauses.append(Document.references["user_id"].as_string() == filters.user_id)
        if filters.merchant_user_id:
            clauses.append(Document.references["merchant_user_id"].as_string() == filters.merchant_user_id)
        if clauses:
            stmt = stmt.where(and_(*clauses))
        return stmt

    def retrieve(
        self,
        db: Session,
        query: str,
        filters: MetadataFilter | None = None,
        top_k: int = 8,
        min_vector_score: float = 0.15,
    ) -> list[RetrievalHit]:
        query_embedding = self.embedding_service.embed_batch([query])[0]

        if self.vector_store.enabled:
            pinecone_hits = self._retrieve_with_pinecone(
                db=db,
                query=query,
                query_embedding=query_embedding,
                filters=filters,
                top_k=top_k,
                min_vector_score=min_vector_score,
            )
            if pinecone_hits:
                return pinecone_hits

        return self._retrieve_with_pgvector(
            db=db,
            query=query,
            query_embedding=query_embedding,
            filters=filters,
            top_k=top_k,
            min_vector_score=min_vector_score,
        )

    def _retrieve_with_pgvector(
        self,
        db: Session,
        query: str,
        query_embedding: list[float],
        filters: MetadataFilter | None,
        top_k: int,
        min_vector_score: float,
    ) -> list[RetrievalHit]:
        ts_query = func.websearch_to_tsquery("simple", query)
        vector_expr = (1 - Chunk.embedding_vector.cosine_distance(query_embedding)).label("vector_score")
        keyword_expr = func.coalesce(func.ts_rank_cd(Chunk.tsv, ts_query), 0.0).label("keyword_score")
        combined_expr = (0.7 * vector_expr + 0.3 * keyword_expr).label("combined_score")

        stmt = (
            select(
                Chunk.id,
                Chunk.document_id,
                Document.bill_id,
                Document.vendor,
                Document.date,
                Document.total_amount,
                Chunk.chunk_type,
                Chunk.content,
                Chunk.summary,
                Chunk.metadata_json,
                vector_expr,
                keyword_expr,
                combined_expr,
            )
            .join(Document, Document.id == Chunk.document_id)
            .where(Chunk.embedding_vector.is_not(None))
            .where(or_(vector_expr >= min_vector_score, keyword_expr > 0.0))
            .order_by(desc(combined_expr))
            .limit(top_k)
        )
        stmt = self._apply_filters(stmt, filters)
        rows = db.execute(stmt).all()
        return self._rows_to_hits(rows)

    def _retrieve_with_pinecone(
        self,
        db: Session,
        query: str,
        query_embedding: list[float],
        filters: MetadataFilter | None,
        top_k: int,
        min_vector_score: float,
    ) -> list[RetrievalHit]:
        multiplier = max(2, int(self.settings.pinecone_top_k_multiplier))
        candidates = self.vector_store.query(query_embedding, top_k=top_k * multiplier)
        if not candidates:
            return []

        score_map: dict[UUID, float] = {}
        candidate_ids: list[UUID] = []
        for candidate in candidates:
            try:
                chunk_id = UUID(str(candidate.id))
            except ValueError:
                continue
            existing = score_map.get(chunk_id)
            if existing is None:
                candidate_ids.append(chunk_id)
            score_map[chunk_id] = max(existing or 0.0, float(candidate.score))

        if not candidate_ids:
            return []

        ts_query = func.websearch_to_tsquery("simple", query)
        keyword_expr = func.coalesce(func.ts_rank_cd(Chunk.tsv, ts_query), 0.0).label("keyword_score")
        stmt = (
            select(
                Chunk.id,
                Chunk.document_id,
                Document.bill_id,
                Document.vendor,
                Document.date,
                Document.total_amount,
                Chunk.chunk_type,
                Chunk.content,
                Chunk.summary,
                Chunk.metadata_json,
                keyword_expr,
            )
            .join(Document, Document.id == Chunk.document_id)
            .where(Chunk.id.in_(candidate_ids))
            .limit(top_k * multiplier)
        )
        stmt = self._apply_filters(stmt, filters)

        rows = db.execute(stmt).all()
        if not rows:
            return []

        results: list[RetrievalHit] = []
        for row in rows:
            vector_score = float(score_map.get(row.id, 0.0))
            keyword_score = float(row.keyword_score or 0.0)
            combined_score = 0.7 * vector_score + 0.3 * keyword_score
            if vector_score < min_vector_score and keyword_score <= 0.0:
                continue
            results.append(
                RetrievalHit(
                    chunk_id=row.id,
                    document_id=row.document_id,
                    bill_id=row.bill_id,
                    vendor=row.vendor,
                    date=row.date,
                    total_amount=float(row.total_amount) if row.total_amount is not None else None,
                    chunk_type=row.chunk_type,
                    content=row.content,
                    summary=row.summary,
                    metadata=row.metadata_json or {},
                    score=combined_score,
                    vector_score=vector_score,
                    keyword_score=keyword_score,
                )
            )

        results.sort(key=lambda item: item.score, reverse=True)
        return results[:top_k]

    @staticmethod
    def _rows_to_hits(rows) -> list[RetrievalHit]:
        results: list[RetrievalHit] = []
        for row in rows:
            results.append(
                RetrievalHit(
                    chunk_id=row.id,
                    document_id=row.document_id,
                    bill_id=row.bill_id,
                    vendor=row.vendor,
                    date=row.date,
                    total_amount=float(row.total_amount) if row.total_amount is not None else None,
                    chunk_type=row.chunk_type,
                    content=row.content,
                    summary=row.summary,
                    metadata=row.metadata_json or {},
                    score=float(row.combined_score or 0.0),
                    vector_score=float(row.vector_score or 0.0),
                    keyword_score=float(row.keyword_score or 0.0),
                )
            )
        return results

    @staticmethod
    def quarter_date_range(year: int, quarter: int) -> tuple[date, date]:
        if quarter == 1:
            return date(year, 1, 1), date(year, 3, 31)
        if quarter == 2:
            return date(year, 4, 1), date(year, 6, 30)
        if quarter == 3:
            return date(year, 7, 1), date(year, 9, 30)
        return date(year, 10, 1), date(year, 12, 31)
