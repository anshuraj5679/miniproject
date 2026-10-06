from __future__ import annotations

from datetime import date as Date
from datetime import datetime as DateTime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class MetadataFilter(BaseModel):
    vendor: str | None = None
    date_from: Date | None = None
    date_to: Date | None = None
    min_amount: float | None = None
    max_amount: float | None = None
    bill_id: str | None = None
    user_id: str | None = None
    merchant_user_id: str | None = None


class IngestPDFResponse(BaseModel):
    document_id: UUID
    chunk_count: int
    bill_id: str
    vendor: str
    created_at: DateTime


class IngestVendorTableResponse(BaseModel):
    document_ids: list[UUID]
    row_count: int
    created_at: DateTime | None


class SearchRequest(BaseModel):
    query: str = Field(min_length=3, max_length=1000)
    filters: MetadataFilter = Field(default_factory=MetadataFilter)
    top_k: int = Field(default=8, ge=1, le=50)


class SearchResult(BaseModel):
    chunk_id: UUID
    document_id: UUID
    bill_id: str
    vendor: str
    date: Date | None = None
    total_amount: float | None = None
    chunk_type: str
    content: str
    summary: str
    score: float
    vector_score: float
    keyword_score: float
    metadata: dict[str, Any]


class SearchResponse(BaseModel):
    results: list[SearchResult]


class AskRequest(BaseModel):
    query: str = Field(min_length=3, max_length=2000)
    filters: MetadataFilter = Field(default_factory=MetadataFilter)
    top_k: int = Field(default=10, ge=1, le=50)
    user_latitude: float | None = Field(default=None, ge=-90, le=90)
    user_longitude: float | None = Field(default=None, ge=-180, le=180)
    user_location_text: str | None = Field(default=None, max_length=255)
    service_radius_km: float | None = Field(default=None, ge=1, le=100)


class PlannerStep(BaseModel):
    name: str
    action: str
    completed: bool = False


class PlannerOutput(BaseModel):
    complexity: str
    steps: list[PlannerStep]


class Citation(BaseModel):
    chunk_id: UUID
    document_id: UUID
    bill_id: str
    vendor: str
    score: float
    keyword_score: float
    excerpt: str


class ServiceCenterView(BaseModel):
    name: str
    address: str
    latitude: float
    longitude: float
    distance_km: float | None = None
    source: str = "brand_directory"
    confidence: str = "likely"
    map_url: str | None = None
    city: str | None = None
    phone: str | None = None
    website: str | None = None
    pincode: str | None = None
    pickup_available: bool | None = None
    estimated_tat_days: int | None = None


class ComplianceCheckView(BaseModel):
    field: str
    status: str
    detail: str


class ComplianceAlertView(BaseModel):
    code: str
    severity: str
    message: str


class GSTINComplianceView(BaseModel):
    value: str | None = None
    present: bool = False
    valid_format: bool = False
    valid_checksum: bool = False
    state_code: str | None = None
    pan: str | None = None
    pan_valid_format: bool = False


class InvoiceComplianceView(BaseModel):
    invoice_number: str | None = None
    invoice_date: str | None = None
    total_amount: float | None = None
    detected_pincode: str | None = None
    irn_detected: bool = False
    irn_value: str | None = None
    qr_detected: bool = False
    einvoice_requirement_signal: str = "unknown"
    days_since_invoice: int | None = None
    late_reporting_risk: bool = False


class TaxValidationView(BaseModel):
    taxable_amount: float | None = None
    gst_amount: float | None = None
    gst_rate: float | None = None
    cgst_amount: float | None = None
    sgst_amount: float | None = None
    igst_amount: float | None = None
    split_total: float | None = None
    expected_gst_amount: float | None = None
    reported_gst_amount: float | None = None
    delta: float | None = None
    within_tolerance: bool | None = None
    tax_split_mode: str = "unknown"
    tolerance: float = 2.0


class DocumentComplianceView(BaseModel):
    country: str = "IN"
    framework: str
    status: str
    score: int = Field(ge=0, le=100)
    gstin: GSTINComplianceView
    invoice: InvoiceComplianceView
    tax_validation: TaxValidationView
    rule46_checks: list[ComplianceCheckView] = Field(default_factory=list)
    alerts: list[ComplianceAlertView] = Field(default_factory=list)
    computed_at: str


class ExtractionTraceStep(BaseModel):
    field: str
    value: str | float | int | bool | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    source: str | None = None
    reason: str
    citations: list[str] = Field(default_factory=list)


class AskResponse(BaseModel):
    answer: str
    confidence_score: float
    hallucination_flag: bool
    planner: PlannerOutput
    citations: list[Citation]
    extraction_trace: list[ExtractionTraceStep] = Field(default_factory=list)
    service_centers: list[ServiceCenterView] = Field(default_factory=list)
    qa_log_id: UUID
    qa_metrics: dict[str, float]


class WarrantyItemView(BaseModel):
    itemId: str
    productName: str | None = None
    model: str | None = None
    invoiceNo: str | None = None
    purchaseDate: str | None = None
    purchasePrice: float | None = None
    quantity: float | None = None
    unitPrice: float | None = None
    gstAmount: float | None = None
    warrantyMonths: int | None = None
    warrantyStart: str | None = None
    warrantyEnd: str | None = None
    serialNumber: str | None = None
    serviceCenters: list[str] = Field(default_factory=list)
    extendedWarrantyPurchased: bool | None = None
    notes: str | None = None


class ClaimReadinessView(BaseModel):
    score: float = Field(ge=0, le=1)
    label: str
    summary: str
    factors: dict[str, float] = Field(default_factory=dict)
    missing: list[str] = Field(default_factory=list)


class DocumentView(BaseModel):
    docId: str
    userId: str
    title: str
    items: list[WarrantyItemView]
    createdAt: str
    updatedAt: str
    rawText: str | None = None
    status: str | None = None
    sellerName: str | None = None
    ocrConfidence: float | None = None
    isVerified: bool = True
    category: str | None = None
    source: str | None = None
    assignedByMerchantId: str | None = None
    assignedByMerchantName: str | None = None
    assignedByMerchantCustomId: str | None = None
    consumerCustomId: str | None = None
    taxableAmount: float | None = None
    gstAmount: float | None = None
    gstRate: float | None = None
    cgstAmount: float | None = None
    sgstAmount: float | None = None
    igstAmount: float | None = None
    extractionConfidence: dict[str, float] = Field(default_factory=dict)
    reviewStatus: str | None = None
    reviewRequired: bool = False
    lowConfidenceFields: list[str] = Field(default_factory=list)
    claimReadiness: ClaimReadinessView | None = None
    deadlineBand: str | None = None
    compliance: DocumentComplianceView | None = None


class DocumentsResponse(BaseModel):
    documents: list[DocumentView]


class ReminderView(BaseModel):
    reminderId: str
    docId: str
    title: str
    triggerAt: str
    triggerType: str
    deliveryChannels: list[str]
    status: str
    daysRemaining: int | None = None
    urgencyTone: str | None = None


class RemindersResponse(BaseModel):
    reminders: list[ReminderView]


class NotificationItem(BaseModel):
    notificationId: str
    docId: str
    userId: str
    channel: str | None = None
    eventType: str | None = None
    type: str
    title: str
    message: str
    triggerAt: str
    readAt: str | None = None
    status: str


class NotificationsResponse(BaseModel):
    notifications: list[NotificationItem]


class NotificationPreferenceView(BaseModel):
    userId: str
    email: str
    fullName: str | None = None
    locale: str = "en"
    timezone: str = "UTC"
    inAppEnabled: bool = True
    emailEnabled: bool = True
    smsEnabled: bool = False
    smsNumber: str | None = None
    pushEnabled: bool = True
    whatsappEnabled: bool = False
    whatsappNumber: str | None = None
    alertDays: list[int] = Field(default_factory=list)
    claimAlertDays: list[int] = Field(default_factory=list)
    updatedAt: str | None = None


class NotificationPreferenceUpdateRequest(BaseModel):
    email: str | None = Field(default=None, max_length=320)
    full_name: str | None = Field(default=None, max_length=255)
    locale: str | None = Field(default=None, max_length=32)
    timezone: str | None = Field(default=None, max_length=64)
    in_app_enabled: bool | None = None
    email_enabled: bool | None = None
    sms_enabled: bool | None = None
    sms_number: str | None = Field(default=None, max_length=32)
    push_enabled: bool | None = None
    whatsapp_enabled: bool | None = None
    whatsapp_number: str | None = Field(default=None, max_length=32)
    alert_days: list[int] | None = None
    claim_alert_days: list[int] | None = None


class NotificationProcessResult(BaseModel):
    processed: int
    sent: int
    failed: int
    deadLettered: int = 0
    reason: str | None = None


class NotificationChannelStats(BaseModel):
    channel: str
    attempts: int
    sent: int
    failed: int
    deadLettered: int
    successRate: float


class NotificationAnalyticsResponse(BaseModel):
    windowDays: int
    totalAttempts: int
    successfulDeliveries: int
    failedDeliveries: int
    deadLettered: int
    successRate: float
    openRate: float
    clickRate: float
    bounceRate: float = 0.0
    spamComplaintRate: float = 0.0
    failoverTriggered: int = 0
    channelStats: list[NotificationChannelStats] = Field(default_factory=list)


class MerchantManualBillRequest(BaseModel):
    merchant_user_id: str = Field(min_length=3, max_length=128)
    merchant_name: str | None = Field(default=None, max_length=255)
    merchant_custom_id: str | None = Field(default=None, max_length=128)
    consumer_user_id: str = Field(min_length=3, max_length=128)
    consumer_custom_id: str | None = Field(default=None, max_length=128)
    consumer_name: str | None = Field(default=None, max_length=255)
    consumer_email: str | None = Field(default=None, max_length=320)
    product_name: str = Field(min_length=2, max_length=255)
    category: str | None = Field(default="Others", max_length=64)
    bill_id: str | None = Field(default=None, max_length=128)
    vendor: str | None = Field(default=None, max_length=255)
    purchase_date: Date | None = None
    total_amount: float | None = Field(default=None, ge=0)
    warranty_months: int = Field(default=12, ge=1, le=180)
    serial_number: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)


class MerchantIssueBillResponse(BaseModel):
    document: DocumentView
    chunk_count: int


class MerchantAssignRequest(BaseModel):
    merchant_user_id: str = Field(min_length=3, max_length=128)
    merchant_name: str | None = Field(default=None, max_length=255)
    merchant_custom_id: str | None = Field(default=None, max_length=128)
    consumer_user_id: str = Field(min_length=3, max_length=128)
    consumer_custom_id: str | None = Field(default=None, max_length=128)
    consumer_name: str | None = Field(default=None, max_length=255)
    consumer_email: str | None = Field(default=None, max_length=320)


class MerchantActivityItem(BaseModel):
    activityId: str
    merchantUserId: str
    consumerUserId: str | None = None
    consumerCustomId: str | None = None
    consumerName: str | None = None
    documentId: str
    billId: str
    title: str
    vendor: str
    amount: float | None = None
    category: str | None = None
    source: str
    action: str
    createdAt: str


class MerchantActivityResponse(BaseModel):
    activities: list[MerchantActivityItem]


class ExtractionReviewView(BaseModel):
    reviewId: str
    documentId: str
    userId: str
    status: str
    fieldConfidences: dict[str, float] = Field(default_factory=dict)
    lowConfidenceFields: list[str] = Field(default_factory=list)
    extractedFields: dict[str, Any] = Field(default_factory=dict)
    confirmedFields: dict[str, Any] = Field(default_factory=dict)
    reviewerUserId: str | None = None
    reviewNotes: str | None = None
    reviewedAt: str | None = None
    createdAt: str
    updatedAt: str


class ExtractionReviewQueueResponse(BaseModel):
    reviews: list[ExtractionReviewView]


class ExtractionReviewConfirmRequest(BaseModel):
    confirmed_fields: dict[str, Any] = Field(default_factory=dict)
    review_notes: str | None = Field(default=None, max_length=2000)
    status: str = Field(default="confirmed", pattern="^(confirmed|rejected)$")


class CalendarLinkResponse(BaseModel):
    docId: str
    googleCalendarUrl: str
    icsDownloadUrl: str


class ClaimPacketResponse(BaseModel):
    docId: str
    generatedAt: str
    facts: dict[str, Any]
    timeline: list[str]
    issueSummaryTemplate: str
    emailTemplate: str
    attachmentChecklist: list[str]


class MerchantAssignmentAcceptRequest(BaseModel):
    consumer_user_id: str = Field(min_length=3, max_length=128)
    status: str = Field(default="accepted", pattern="^(accepted|escalated|rejected)$")
    notes: str | None = Field(default=None, max_length=2000)


class MerchantAssignmentAuditView(BaseModel):
    assignmentId: str
    documentId: str
    merchantUserId: str
    consumerUserId: str
    status: str
    assignmentSource: str | None = None
    acceptedAt: str | None = None
    escalatedAt: str | None = None
    notes: str | None = None
    createdAt: str
    updatedAt: str


class MerchantAssignmentAuditResponse(BaseModel):
    assignments: list[MerchantAssignmentAuditView]


class NotificationProviderEventIngestRequest(BaseModel):
    provider: str = Field(min_length=2, max_length=64)
    event_type: str = Field(min_length=2, max_length=64)
    status: str = Field(min_length=2, max_length=32)
    job_id: UUID | None = None
    provider_message_id: str | None = Field(default=None, max_length=255)
    channel: str | None = Field(default=None, max_length=24)
    recipient: str | None = Field(default=None, max_length=320)
    error_message: str | None = Field(default=None, max_length=2000)
    payload: dict[str, Any] = Field(default_factory=dict)


class NotificationDeliverabilityDashboardResponse(BaseModel):
    windowDays: int
    totals: dict[str, int]
    channelStats: list[NotificationChannelStats] = Field(default_factory=list)
