# Design Document

## Overview

SafeBill is a production-grade RAG (Retrieval-Augmented Generation) platform for financial document management, warranty tracking, and intelligent querying. The system combines a FastAPI backend with a Next.js frontend, using PostgreSQL with pgvector for hybrid search, Pinecone for vector storage, and OpenAI for embeddings and generation.

The architecture follows a multi-agent pattern where complex queries are decomposed into retrieval, calculation, policy checking, and validation steps. All answers are grounded in retrieved document chunks with explicit citations, and numeric calculations are validated programmatically to prevent hallucinations.

The system supports two user roles: consumers who scan and manage their bills, and merchants who issue and assign bills to consumers. Tenant isolation is enforced at the database query level using user_id and merchant_user_id filters.

## Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js Frontend                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Consumer   │  │   Merchant   │  │     Chat     │      │
│  │     Flow     │  │     Flow     │  │    Widget    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP/REST
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Backend                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  API Routes Layer                     │   │
│  │  /ingest/pdf  /ingest/image  /search  /ask           │   │
│  │  /documents  /reminders  /merchant/*                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Multi-Agent Orchestration                │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │   │
│  │  │ Planner  │→ │Retrieval │→ │Calculate │           │   │
│  │  └──────────┘  │  Agent   │  │  Agent   │           │   │
│  │                └──────────┘  └──────────┘           │   │
│  │                      ↓              ↓                │   │
│  │                ┌──────────┐  ┌──────────┐           │   │
│  │                │  Policy  │→ │ Auditor  │           │   │
│  │                │  Agent   │  │  Agent   │           │   │
│  │                └──────────┘  └──────────┘           │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 Service Layer                         │   │
│  │  Ingestion │ Chunking │ Embeddings │ Generation      │   │
│  │  Retrieval │ Metadata │ Compliance │ Notifications   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  PostgreSQL  │  │   Pinecone   │  │    OpenAI    │
│  + pgvector  │  │Vector Store  │  │  Embeddings  │
│              │  │              │  │  + Chat API  │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Technology Stack

**Frontend:**
- Next.js 14 with App Router
- TypeScript
- Tailwind CSS
- Supabase Auth for authentication
- React Query for data fetching

**Backend:**
- FastAPI (Python 3.13)
- SQLAlchemy 2.0 with async support
- Pydantic v2 for validation
- OpenAI Python SDK
- pdfplumber for PDF parsing
- pytesseract for OCR
- Pinecone Python client

**Data Storage:**
- PostgreSQL (Neon) with pgvector extension
- Pinecone vector database
- Supabase for user profiles

**External Services:**
- OpenAI API (text-embedding-3-large, gpt-4)
- Email/SMS/WhatsApp notification providers
- Google Maps API for service center locations

## Components and Interfaces

### 1. Ingestion Pipeline

**Purpose:** Parse uploaded documents, extract metadata, create chunks, generate embeddings, and store in database and vector store.

**Key Classes:**
- `IngestionService`: Orchestrates the ingestion workflow
- `PDFParser`: Extracts text, tables, and metadata from PDFs
- `ChunkingService`: Creates structure-aware chunks
- `MetadataGenerator`: Generates summaries, keywords, and hypothetical questions
- `EmbeddingService`: Creates embedding vectors
- `VectorStore`: Abstracts Pinecone operations

**Workflow:**
1. Receive PDF or image file upload
2. Parse document (with OCR fallback for images)
3. Extract metadata: bill_id, vendor, date, total_amount, line_items
4. Handle duplicate bill_id by auto-incrementing version
5. Create structure-aware chunks (metadata, line_items, tax, body)
6. Generate metadata for each chunk (summary, keywords, questions)
7. Create embedding vectors for each chunk
8. Store Document and Chunks in PostgreSQL
9. Upsert vectors to Pinecone if enabled
10. Create notification jobs for warranty expiration

**Interfaces:**
```python
class IngestionService:
    def ingest_pdf(
        self, 
        db: Session, 
        file_bytes: bytes, 
        filename: str,
        user_id: str,
        metadata: dict
    ) -> tuple[Document, list[Chunk]]
    
    def ingest_image(
        self,
        db: Session,
        file_bytes: bytes,
        filename: str,
        user_id: str,
        metadata: dict
    ) -> tuple[Document, list[Chunk]]
```

### 2. Hybrid Retrieval System

**Purpose:** Combine semantic vector search and keyword full-text search with metadata filtering to find relevant chunks.

**Key Classes:**
- `RetrievalService`: Orchestrates hybrid search
- `VectorStore`: Queries Pinecone for semantic similarity
- `KeywordSearcher`: Queries PostgreSQL full-text search

**Workflow:**
1. Receive query and metadata filters
2. Generate query embedding vector
3. Query Pinecone for top-k semantic matches
4. Query PostgreSQL tsv column for keyword matches
5. Apply metadata filters (vendor, date range, amount, user_id)
6. Combine and rank results by weighted score
7. Return top-k results with chunk content and metadata

**Scoring Formula:**
```
combined_score = (0.7 * vector_score) + (0.3 * keyword_score)
```

**Interfaces:**
```python
class RetrievalService:
    def hybrid_search(
        self,
        db: Session,
        query: str,
        filters: MetadataFilter,
        top_k: int
    ) -> list[RetrievalHit]
```

### 3. Multi-Agent Query System

**Purpose:** Decompose complex queries into specialized agent tasks and orchestrate execution.

**Agents:**

**Planner Agent:**
- Analyzes query complexity
- Returns "simple" or "complex" plan
- Simple: retrieve → summarize → validate
- Complex: retrieve → calculate → policy_check → summarize → validate

**Retrieval Agent:**
- Executes hybrid search
- Returns ranked chunks with metadata

**Calculation Agent:**
- Performs numeric aggregations (sum, average, count)
- Detects anomalies (GST mismatches, outliers)
- Validates answer math against programmatic calculations

**Policy Agent:**
- Checks GST compliance rules
- Validates invoice requirements
- Identifies missing mandatory fields

**Auditor Agent:**
- Validates citation grounding
- Computes confidence score
- Flags potential hallucinations
- Calculates precision and recall metrics

**Interfaces:**
```python
class RetrievalAgentInterface(Protocol):
    def retrieve(
        self, 
        db: Session, 
        query: str, 
        filters: MetadataFilter, 
        top_k: int
    ) -> list[RetrievalHit]

class CalculationAgentInterface(Protocol):
    def execute(
        self, 
        query: str, 
        hits: list[RetrievalHit]
    ) -> dict[str, Any]
    
    def validate_answer_math(
        self,
        answer_payload: dict[str, Any],
        calculations: dict[str, Any]
    ) -> dict[str, Any]

class PolicyAgentInterface(Protocol):
    def evaluate(
        self,
        query: str,
        hits: list[RetrievalHit],
        calculations: dict[str, Any]
    ) -> dict[str, Any]

class AuditorAgentInterface(Protocol):
    def audit(
        self,
        answer_payload: dict[str, Any],
        hits: list[RetrievalHit],
        math_validation: dict[str, Any]
    ) -> dict[str, Any]
```

### 4. Grounded Answer Generation

**Purpose:** Generate natural language answers grounded in retrieved chunks with explicit citations.

**Key Classes:**
- `GroundedAnswerGenerator`: Calls OpenAI API with structured prompts

**Workflow:**
1. Receive query, plan, retrieved hits, calculations, policy findings
2. Build context block from retrieved chunks
3. Construct system prompt enforcing grounding constraints
4. Call OpenAI API with JSON response format
5. Parse response into answer, claims, citations, numeric_claims
6. Validate that all citations reference retrieved chunk_ids
7. Return structured answer payload

**Prompt Strategy:**
- System prompt enforces "use ONLY provided chunks"
- Requires JSON output with explicit citation arrays
- Includes calculated data and policy findings in context
- Temperature set to 0 for deterministic output

**Interfaces:**
```python
class GroundedAnswerGenerator:
    def generate(
        self,
        query: str,
        plan: Plan,
        hits: list[RetrievalHit],
        calculations: dict[str, Any],
        policy: dict[str, Any]
    ) -> dict[str, Any]
```

### 5. Notification System

**Purpose:** Schedule and deliver warranty expiration and claim deadline reminders across multiple channels.

**Key Classes:**
- `NotificationService`: Creates and manages notification jobs
- `NotificationWorker`: Background process that sends due notifications
- `ChannelProviders`: Email, SMS, Push, WhatsApp integrations

**Workflow:**
1. When document with warranty is ingested, compute warranty_end date
2. For each alert_day in user preferences, create NotificationJob
3. Set send_at = warranty_end - alert_days
4. Background worker queries jobs where send_at <= now() and status = pending
5. For each job, send via configured channel
6. Create NotificationDelivery record with status and latency
7. On failure, retry with fallback_channel if configured
8. Update job status to sent, failed, or dead_lettered

**Deduplication:**
- Each job has dedupe_key = f"{user_id}:{document_id}:{event_type}:{send_at_date}"
- Unique constraint prevents duplicate notifications

**Interfaces:**
```python
class NotificationService:
    def create_warranty_reminders(
        self,
        db: Session,
        document: Document,
        user_preferences: NotificationPreference
    ) -> list[NotificationJob]
    
    def send_notification(
        self,
        db: Session,
        job: NotificationJob
    ) -> NotificationDelivery
```

### 6. Merchant Operations

**Purpose:** Enable merchants to create and assign bills to consumers.

**Key Operations:**

**Manual Bill Creation:**
1. Receive merchant and consumer metadata, product details
2. Generate synthetic document content
3. Create Document with source=merchant_manual
4. Set assignment metadata in references field
5. Create chunks and embeddings
6. Create MerchantAssignmentAudit record
7. Return document view

**Document Assignment:**
1. Receive document_id and consumer assignment details
2. Verify document exists and merchant has access
3. Update document references with consumer metadata
4. Create or update MerchantAssignmentAudit record
5. Create notification event for consumer
6. Return updated document view

**Activity Tracking:**
1. Query documents filtered by merchant_user_id
2. Join with MerchantAssignmentAudit for assignment details
3. Return activity items with action type (uploaded, generated, reassigned)

**Interfaces:**
```python
class MerchantService:
    def create_manual_bill(
        self,
        db: Session,
        request: MerchantManualBillRequest
    ) -> tuple[Document, int]
    
    def assign_document(
        self,
        db: Session,
        doc_id: UUID,
        request: MerchantAssignRequest
    ) -> Document
    
    def get_activity(
        self,
        db: Session,
        merchant_user_id: str,
        limit: int
    ) -> list[MerchantActivityItem]
```

### 7. GST Compliance Checking

**Purpose:** Validate Indian GST compliance for invoices.

**Key Classes:**
- `GSTComplianceService`: Validates GSTIN, tax calculations, e-invoice requirements

**Checks Performed:**
1. GSTIN format validation (15 characters, checksum)
2. GSTIN state code and PAN extraction
3. Tax calculation validation (taxable_amount * gst_rate = gst_amount)
4. CGST + SGST = IGST validation for intra/inter-state
5. Invoice number and date presence
6. E-invoice IRN and QR code detection for amounts > threshold
7. Late reporting risk based on days_since_invoice

**Compliance Score:**
- Start at 100
- Deduct points for each failed check
- Severity: critical (-20), high (-10), medium (-5), low (-2)

**Interfaces:**
```python
class GSTComplianceService:
    def check_compliance(
        self,
        document: Document,
        chunks: list[Chunk]
    ) -> DocumentComplianceView
```

## Data Models

### Core Entities

**Document:**
```python
class Document(Base):
    id: UUID
    bill_id: str  # Extracted or filename-based
    vendor: str
    date: Date | None
    total_amount: Decimal | None
    version: int  # Auto-incremented for duplicate bill_id
    references: JSON  # Flexible metadata storage
    created_at: DateTime
    
    # Relationships
    chunks: list[Chunk]
    extraction_reviews: list[ExtractionReview]
    merchant_assignment_audits: list[MerchantAssignmentAudit]
    notification_jobs: list[NotificationJob]
```

**Chunk:**
```python
class Chunk(Base):
    id: UUID
    document_id: UUID
    chunk_type: str  # metadata, line_item, tax, body, header, footer
    content: str
    summary: str
    keywords: list[str]
    hypothetical_questions: list[str]
    embedding_vector: Vector(dimensions)
    metadata_json: JSON
    tsv: TSVECTOR  # Full-text search index
    created_at: DateTime
```

**QALog:**
```python
class QALog(Base):
    id: UUID
    query: str
    runtime_ms: int
    precision_score: float
    recall_score: float
    hallucination_flag: bool
    confidence_score: float
    citations: JSON
    diagnostics: JSON
    created_at: DateTime
```

**NotificationJob:**
```python
class NotificationJob(Base):
    id: UUID
    user_id: str
    document_id: UUID
    channel: str  # email, sms, push, whatsapp
    job_type: str
    event_type: str
    template_key: str
    priority: int
    fallback_channel: str | None
    send_at: DateTime
    status: str  # pending, sent, failed, dead_lettered
    recipient_email: str
    subject: str
    payload: JSON
    dedupe_key: str  # Unique constraint
    retry_count: int
    last_error: str | None
    sent_at: DateTime | None
    created_at: DateTime
```

**MerchantAssignmentAudit:**
```python
class MerchantAssignmentAudit(Base):
    id: UUID
    document_id: UUID
    merchant_user_id: str
    consumer_user_id: str
    status: str  # assigned, accepted, escalated, rejected
    assignment_source: str  # merchant_upload, merchant_manual, merchant_reassign
    accepted_at: DateTime | None
    escalated_at: DateTime | None
    notes: str | None
    created_at: DateTime
    updated_at: DateTime
```

**ExtractionReview:**
```python
class ExtractionReview(Base):
    id: UUID
    document_id: UUID
    user_id: str
    status: str  # pending, confirmed, rejected
    field_confidences: JSON
    low_confidence_fields: list[str]
    extracted_fields: JSON
    confirmed_fields: JSON
    reviewer_user_id: str | None
    review_notes: str | None
    reviewed_at: DateTime | None
    created_at: DateTime
    updated_at: DateTime
```

### Document References Schema

The `references` JSON field stores flexible metadata:

```json
{
  "user_id": "consumer-uuid",
  "consumer_custom_id": "C12345",
  "consumer_name": "John Doe",
  "merchant_user_id": "merchant-uuid",
  "merchant_name": "ABC Electronics",
  "merchant_custom_id": "M67890",
  "assignment_source": "merchant_upload",
  "source": "pdf",
  "category": "Electronics",
  "title": "Laptop Purchase",
  "product_name": "Dell XPS 15",
  "brand": "Dell",
  "warranty_months": 24,
  "warranty_start": "2026-01-15",
  "warranty_end": "2028-01-15",
  "serial_number": "SN123456789",
  "taxable_amount": 85000.00,
  "gst_amount": 15300.00,
  "gst_rate": 18.0,
  "cgst_amount": 7650.00,
  "sgst_amount": 7650.00
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Duplicate bill_id version increment

*For any* document with bill_id B, when a new document with the same bill_id B is ingested, the new document's version should be max(existing_versions) + 1

**Validates: Requirements 1.4**

### Property 2: Chunk embedding vector dimensions

*For any* chunk with a non-null embedding_vector, the vector dimension should equal the configured embedding_dimensions setting

**Validates: Requirements 2.3**

### Property 3: Tenant isolation in retrieval

*For any* search or ask request with user_id U, all returned chunks should belong to documents where references['user_id'] = U or references['merchant_user_id'] = U

**Validates: Requirements 12.3**

### Property 4: Citation grounding

*For any* generated answer with citations, all cited chunk_ids should exist in the set of retrieved chunk_ids

**Validates: Requirements 4.4**

### Property 5: Numeric calculation validation

*For any* answer containing numeric_claims, the claimed values should match programmatically calculated values within tolerance

**Validates: Requirements 4.5**

### Property 6: Notification deduplication

*For any* two notification jobs with the same dedupe_key, only one should exist in the database

**Validates: Requirements 14.4**

### Property 7: Warranty date computation

*For any* document with warranty_months M and purchase_date D, warranty_end should equal D + M months

**Validates: Requirements 5.1**

### Property 8: Merchant assignment metadata consistency

*For any* document assigned by a merchant, references should contain both merchant_user_id and consumer_user_id

**Validates: Requirements 6.3, 6.4**

### Property 9: GST checksum validation

*For any* GSTIN string G, if G passes format validation, then the 15th character should equal the computed checksum of the first 14 characters

**Validates: Requirements 9.2**

### Property 10: Hybrid search score bounds

*For any* search result, the combined_score should be in the range [0, 1] and equal (0.7 * vector_score) + (0.3 * keyword_score)

**Validates: Requirements 3.1**

### Property 11: OCR fallback resilience

*For any* image ingestion where OCR fails, the ingestion should complete successfully with empty text rather than raising an exception

**Validates: Requirements 1.3**

### Property 12: Query complexity classification

*For any* query Q containing complexity hints (compare, calculate, trend, outlier), the Planner should return complexity="complex"

**Validates: Requirements 4.2, 4.3**

### Property 13: Extraction review creation

*For any* document with field_confidences where any value < threshold, an ExtractionReview record should be created with status="pending"

**Validates: Requirements 11.3**

### Property 14: Service center distance computation

*For any* service center result with user location (lat1, lon1) and center location (lat2, lon2), distance_km should equal the haversine distance between the two points

**Validates: Requirements 10.3**

### Property 15: Security audit logging

*For any* document access, modification, or deletion operation, a SecurityAuditLog record should be created with event_type, user_id, and resource

**Validates: Requirements 13.2, 13.3**

## Error Handling

### Ingestion Errors

**PDF Parsing Failure:**
- Fallback to OCR if text extraction fails
- If OCR unavailable, continue with empty text
- Log warning but don't fail ingestion

**Duplicate bill_id:**
- Auto-increment version number
- Don't raise exception
- Log info message

**Embedding Service Unavailable:**
- Use deterministic fallback embeddings
- Set embedding_vector to null if fallback fails
- Continue ingestion

**Vector Store Unavailable:**
- Skip Pinecone upsert
- Log warning
- Continue with PostgreSQL storage only

### Query Errors

**No Results Found:**
- Return empty results array
- Don't raise exception
- Log query for analysis

**LLM API Failure:**
- Fallback to template-based answer
- Include retrieved chunk summaries
- Set confidence_score to 0.5

**Calculation Agent Error:**
- Return empty calculations dict
- Log error with stack trace
- Continue with answer generation

**Policy Agent Error:**
- Return empty policy findings
- Log error
- Continue with answer generation

### Notification Errors

**Channel Provider Failure:**
- Increment retry_count
- Try fallback_channel if configured
- After max retries, set status to dead_lettered
- Log error details

**Template Rendering Error:**
- Use plain text fallback
- Log error
- Continue with send attempt

**Recipient Invalid:**
- Set status to failed immediately
- Don't retry
- Log validation error

### Authentication/Authorization Errors

**Missing Auth Token:**
- Return 401 Unauthorized
- Log security event

**Invalid Token:**
- Return 401 Unauthorized
- Log security event with client_ip

**Insufficient Permissions:**
- Return 403 Forbidden
- Log security event with attempted resource

**Tenant Isolation Violation:**
- Return 404 Not Found (don't reveal existence)
- Log security event with severity=high

## Testing Strategy

### Unit Testing

**Ingestion Pipeline:**
- Test PDF parsing with sample invoices
- Test OCR fallback with scanned images
- Test duplicate bill_id version increment
- Test line item extraction from tables
- Test metadata extraction (bill_id, vendor, date, amount)

**Chunking:**
- Test structure-aware chunking for different document types
- Test chunk type classification
- Test metadata generation (summary, keywords, questions)

**Retrieval:**
- Test vector search with mock embeddings
- Test keyword search with tsv queries
- Test metadata filtering
- Test tenant isolation filters
- Test score combination formula

**Agents:**
- Test Planner complexity classification
- Test Calculation Agent numeric aggregations
- Test Policy Agent GST validation
- Test Auditor Agent citation validation

**Compliance:**
- Test GSTIN format validation
- Test GSTIN checksum calculation
- Test tax calculation validation
- Test e-invoice requirement detection

### Property-Based Testing

The system uses property-based testing with the Hypothesis library for Python. Each property test should run a minimum of 100 iterations with randomly generated inputs.

**Property Test Framework:**
- Library: Hypothesis (Python)
- Minimum iterations: 100 per property
- Tagging format: `# Feature: safebill-rag-platform, Property {N}: {description}`

**Property 1: Duplicate bill_id version increment**
- Generate: random bill_id, multiple documents with same bill_id
- Test: version numbers are sequential starting from 1
- Tag: `# Feature: safebill-rag-platform, Property 1: Duplicate bill_id version increment`

**Property 2: Chunk embedding vector dimensions**
- Generate: random chunks with embeddings
- Test: all non-null embedding_vector have correct dimensions
- Tag: `# Feature: safebill-rag-platform, Property 2: Chunk embedding vector dimensions`

**Property 3: Tenant isolation in retrieval**
- Generate: random documents with different user_ids, random queries
- Test: results only contain documents matching filter user_id
- Tag: `# Feature: safebill-rag-platform, Property 3: Tenant isolation in retrieval`

**Property 4: Citation grounding**
- Generate: random retrieved chunks, random answer with citations
- Test: all citation chunk_ids exist in retrieved set
- Tag: `# Feature: safebill-rag-platform, Property 4: Citation grounding`

**Property 5: Numeric calculation validation**
- Generate: random documents with amounts, random calculation queries
- Test: LLM numeric claims match programmatic calculations within tolerance
- Tag: `# Feature: safebill-rag-platform, Property 5: Numeric calculation validation`

**Property 6: Notification deduplication**
- Generate: random notification jobs with duplicate dedupe_keys
- Test: database constraint prevents duplicates
- Tag: `# Feature: safebill-rag-platform, Property 6: Notification deduplication`

**Property 7: Warranty date computation**
- Generate: random purchase dates and warranty months
- Test: warranty_end = purchase_date + warranty_months
- Tag: `# Feature: safebill-rag-platform, Property 7: Warranty date computation`

**Property 8: Merchant assignment metadata consistency**
- Generate: random merchant assignments
- Test: references contain both merchant_user_id and consumer_user_id
- Tag: `# Feature: safebill-rag-platform, Property 8: Merchant assignment metadata consistency`

**Property 9: GST checksum validation**
- Generate: random valid GSTIN strings
- Test: 15th character equals computed checksum
- Tag: `# Feature: safebill-rag-platform, Property 9: GST checksum validation`

**Property 10: Hybrid search score bounds**
- Generate: random vector and keyword scores
- Test: combined_score in [0,1] and equals formula
- Tag: `# Feature: safebill-rag-platform, Property 10: Hybrid search score bounds`

**Property 11: OCR fallback resilience**
- Generate: random image files, mock OCR failures
- Test: ingestion completes without exception
- Tag: `# Feature: safebill-rag-platform, Property 11: OCR fallback resilience`

**Property 12: Query complexity classification**
- Generate: random queries with/without complexity hints
- Test: Planner returns correct complexity
- Tag: `# Feature: safebill-rag-platform, Property 12: Query complexity classification`

**Property 13: Extraction review creation**
- Generate: random documents with low confidence fields
- Test: ExtractionReview created with status=pending
- Tag: `# Feature: safebill-rag-platform, Property 13: Extraction review creation`

**Property 14: Service center distance computation**
- Generate: random lat/lon pairs
- Test: distance_km equals haversine formula
- Tag: `# Feature: safebill-rag-platform, Property 14: Service center distance computation`

**Property 15: Security audit logging**
- Generate: random document operations
- Test: SecurityAuditLog record created for each operation
- Tag: `# Feature: safebill-rag-platform, Property 15: Security audit logging`

### Integration Testing

**End-to-End Ingestion:**
- Upload real PDF invoice
- Verify document and chunks created
- Verify embeddings generated
- Verify Pinecone vectors upserted
- Verify notification jobs created

**End-to-End Query:**
- Ingest test documents
- Submit search query
- Verify hybrid retrieval results
- Submit ask query
- Verify grounded answer with citations
- Verify QA log created

**Merchant Flow:**
- Create manual bill
- Verify document created with merchant metadata
- Assign to consumer
- Verify MerchantAssignmentAudit created
- Query merchant activity
- Verify activity includes created bill

**Notification Flow:**
- Create document with warranty
- Verify notification jobs created
- Trigger notification worker
- Verify notifications sent
- Verify NotificationDelivery records created

### Evaluation Harness

**RAG Quality Metrics:**
- Precision: % of retrieved chunks relevant to query
- Recall: % of relevant chunks retrieved
- Citation accuracy: % of citations that ground claims
- Hallucination rate: % of answers flagged as hallucinated
- Confidence calibration: correlation between confidence and accuracy

**Extraction Quality Metrics:**
- Field extraction accuracy per field type
- OCR confidence vs manual validation accuracy
- Low confidence field identification precision/recall

**Compliance Metrics:**
- GSTIN validation accuracy
- Tax calculation validation accuracy
- E-invoice requirement detection accuracy

**Test Data:**
- Gold standard invoice dataset (backend/evals/gold_invoices.jsonl)
- Adversarial query dataset (backend/scripts/adversarial_query_tests.py)
- Manual validation samples for extraction review
