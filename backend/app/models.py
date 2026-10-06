import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Computed,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    PickleType,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import get_settings
from app.core.database import Base

try:
    from pgvector.sqlalchemy import Vector
except Exception:  # pragma: no cover - fallback when pgvector is unavailable
    from sqlalchemy.types import TypeDecorator

    class Vector(TypeDecorator):  # type: ignore[no-redef]
        impl = PickleType
        cache_ok = True

        def __init__(self, dimensions: int, *args, **kwargs) -> None:
            _ = dimensions
            super().__init__(*args, **kwargs)


settings = get_settings()


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("bill_id", "version", name="uq_documents_bill_version"),
        Index("ix_documents_vendor_date", "vendor", "date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bill_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    vendor: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    date: Mapped[Date | None] = mapped_column(Date, nullable=True, index=True)
    total_amount: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    references: Mapped[dict | list] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    chunks: Mapped[list["Chunk"]] = relationship("Chunk", back_populates="document", cascade="all, delete-orphan")
    extraction_reviews: Mapped[list["ExtractionReview"]] = relationship(
        "ExtractionReview",
        back_populates="document",
        cascade="all, delete-orphan",
    )
    merchant_assignment_audits: Mapped[list["MerchantAssignmentAudit"]] = relationship(
        "MerchantAssignmentAudit",
        back_populates="document",
        cascade="all, delete-orphan",
    )
    notification_jobs: Mapped[list["NotificationJob"]] = relationship(
        "NotificationJob",
        back_populates="document",
        cascade="all, delete-orphan",
    )
    notification_events: Mapped[list["NotificationEvent"]] = relationship(
        "NotificationEvent",
        back_populates="document",
        cascade="all, delete-orphan",
    )


class Chunk(Base):
    __tablename__ = "chunks"
    __table_args__ = (
        Index("ix_chunks_document_type", "document_id", "chunk_type"),
        Index("ix_chunks_tsv", "tsv", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    keywords: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    hypothetical_questions: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    embedding_vector: Mapped[list[float] | None] = mapped_column(Vector(settings.embedding_dimensions), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    tsv: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('simple', coalesce(content, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(array_to_string(keywords, ' '), ''))",
            persisted=True,
        ),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    document: Mapped["Document"] = relationship("Document", back_populates="chunks")


class QALog(Base):
    __tablename__ = "qa_logs"
    __table_args__ = (Index("ix_qa_logs_created_at", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    query: Mapped[str] = mapped_column(Text, nullable=False)
    runtime_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    precision_score: Mapped[float] = mapped_column(Float, nullable=False)
    recall_score: Mapped[float] = mapped_column(Float, nullable=False)
    hallucination_flag: Mapped[bool] = mapped_column(Boolean, nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False)
    citations: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    diagnostics: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ExtractionReview(Base):
    __tablename__ = "extraction_reviews"
    __table_args__ = (
        UniqueConstraint("document_id", name="uq_extraction_reviews_document_id"),
        Index("ix_extraction_reviews_user_status", "user_id", "status"),
        Index("ix_extraction_reviews_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    field_confidences: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    low_confidence_fields: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    extracted_fields: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    confirmed_fields: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    reviewer_user_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    document: Mapped["Document"] = relationship("Document", back_populates="extraction_reviews")


class MerchantAssignmentAudit(Base):
    __tablename__ = "merchant_assignment_audits"
    __table_args__ = (
        Index("ix_merchant_assignment_audits_merchant_created", "merchant_user_id", "created_at"),
        Index("ix_merchant_assignment_audits_consumer_status", "consumer_user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    merchant_user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    consumer_user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="assigned")
    assignment_source: Mapped[str | None] = mapped_column(String(48), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    document: Mapped["Document"] = relationship("Document", back_populates="merchant_assignment_audits")


class SecurityAuditLog(Base):
    __tablename__ = "security_audit_logs"
    __table_args__ = (
        Index("ix_security_audit_logs_event_created", "event_type", "created_at"),
        Index("ix_security_audit_logs_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    actor_role: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    resource: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_ip: Mapped[str | None] = mapped_column(String(128), nullable=True)
    event_metadata: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    in_app_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sms_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sms_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    push_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    push_subscription: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    whatsapp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    whatsapp_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    alert_days: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    claim_alert_days: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    locale: Mapped[str] = mapped_column(String(32), nullable=False, default="en")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class NotificationJob(Base):
    __tablename__ = "notification_jobs"
    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uq_notification_jobs_dedupe_key"),
        Index("ix_notification_jobs_send_at_status", "send_at", "status"),
        Index("ix_notification_jobs_user_status", "user_id", "status"),
        Index("ix_notification_jobs_channel_status", "channel", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    channel: Mapped[str] = mapped_column(String(24), nullable=False, default="email")
    job_type: Mapped[str] = mapped_column(String(64), nullable=False)
    event_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    template_key: Mapped[str | None] = mapped_column(String(96), nullable=True)
    template_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    fallback_channel: Mapped[str | None] = mapped_column(String(24), nullable=True)
    send_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    recipient_email: Mapped[str] = mapped_column(String(320), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    document: Mapped["Document"] = relationship("Document", back_populates="notification_jobs")
    deliveries: Mapped[list["NotificationDelivery"]] = relationship(
        "NotificationDelivery",
        back_populates="job",
        cascade="all, delete-orphan",
    )


class NotificationEvent(Base):
    __tablename__ = "notification_events"
    __table_args__ = (
        UniqueConstraint("event_key", name="uq_notification_events_event_key"),
        Index("ix_notification_events_type_created", "event_type", "created_at"),
        Index("ix_notification_events_subject_created", "subject_user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    event_key: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    subject_user_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    merchant_user_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=True, index=True
    )
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="scheduled")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    document: Mapped["Document"] = relationship("Document", back_populates="notification_events")


class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"
    __table_args__ = (
        Index("ix_notification_deliveries_job_created", "job_id", "created_at"),
        Index("ix_notification_deliveries_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notification_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    channel: Mapped[str] = mapped_column(String(24), nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    job: Mapped["NotificationJob"] = relationship("NotificationJob", back_populates="deliveries")
