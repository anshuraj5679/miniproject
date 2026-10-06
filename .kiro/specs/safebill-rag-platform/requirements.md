# Requirements Document

## Introduction

SafeBill is a multi-tenant financial document management and warranty tracking platform that enables consumers to scan, store, and manage bills/invoices with warranty information, while allowing merchants to issue and assign bills to consumers. The system uses Retrieval-Augmented Generation (RAG) with a multi-agent architecture to provide intelligent querying, compliance checking, and automated reminders for warranty expiration and claim deadlines.

## Glossary

- **SafeBill System**: The complete web application including frontend, backend API, and database infrastructure
- **Consumer**: An end user who scans, stores, and manages their bills and warranty documents
- **Merchant**: A business user who issues bills and assigns them to consumers
- **Document**: A stored bill, invoice, or receipt with extracted metadata and warranty information
- **Chunk**: A semantically meaningful segment of a document stored for retrieval
- **RAG Pipeline**: Retrieval-Augmented Generation system combining vector search, keyword search, and LLM generation
- **Hybrid Retrieval**: Combined semantic vector search and full-text keyword search with metadata filtering
- **Multi-Agent System**: Coordinated agents (retrieval, calculation, policy, auditor) that process complex queries
- **Planner**: Component that analyzes query complexity and orchestrates agent execution
- **Grounded Answer**: LLM-generated response with citations to source chunks
- **Extraction Review**: Human-in-the-loop validation of low-confidence field extractions
- **Notification Job**: Scheduled notification for warranty expiration or claim deadline
- **GST Compliance**: Indian Goods and Services Tax regulatory compliance checking
- **Vector Store**: Pinecone or pgvector database storing document embeddings
- **Embedding Vector**: Numerical representation of text for semantic search
- **OCR**: Optical Character Recognition for scanned document text extraction
- **Service Center**: Authorized repair/warranty service location for a product

## Requirements

### Requirement 1

**User Story:** As a consumer, I want to upload bills and invoices via PDF or image, so that I can digitally store and track my purchases and warranties.

#### Acceptance Criteria

1. WHEN a consumer uploads a PDF file THEN the SafeBill System SHALL extract text, tables, and metadata from the document
2. WHEN a consumer uploads an image file THEN the SafeBill System SHALL apply OCR to extract text and metadata
3. WHEN OCR processing fails or is unavailable THEN the SafeBill System SHALL continue ingestion with empty text rather than failing
4. WHEN a document with duplicate bill_id is uploaded THEN the SafeBill System SHALL auto-increment the version number and store as a new version
5. WHEN document parsing completes THEN the SafeBill System SHALL extract bill_id, vendor, date, total_amount, and line items

### Requirement 2

**User Story:** As a consumer, I want my uploaded documents to be automatically chunked and enriched with metadata, so that I can search and query them effectively.

#### Acceptance Criteria

1. WHEN a document is ingested THEN the SafeBill System SHALL create structure-aware chunks for metadata, line items, tax blocks, and body content
2. WHEN chunks are created THEN the SafeBill System SHALL generate a summary, keywords, and hypothetical questions for each chunk
3. WHEN chunk metadata is generated THEN the SafeBill System SHALL create embedding vectors using text-embedding-3-large
4. WHEN embedding service is unavailable THEN the SafeBill System SHALL use deterministic fallback embeddings for testing
5. WHEN chunks are stored THEN the SafeBill System SHALL upsert vectors to Pinecone if enabled

### Requirement 3

**User Story:** As a consumer, I want to search my documents using natural language queries, so that I can quickly find specific bills or information.

#### Acceptance Criteria

1. WHEN a consumer submits a search query THEN the SafeBill System SHALL perform hybrid retrieval combining vector similarity and keyword matching
2. WHEN hybrid retrieval executes THEN the SafeBill System SHALL filter results by user_id to ensure tenant isolation
3. WHEN search results are returned THEN the SafeBill System SHALL include chunk content, summary, score, and document metadata
4. WHEN metadata filters are provided THEN the SafeBill System SHALL apply vendor, date range, and amount filters to results
5. WHEN top_k parameter is specified THEN the SafeBill System SHALL return at most top_k results ranked by combined score

### Requirement 4

**User Story:** As a consumer, I want to ask questions about my documents and receive grounded answers with citations, so that I can trust the information provided.

#### Acceptance Criteria

1. WHEN a consumer submits a question THEN the SafeBill System SHALL analyze query complexity using the Planner
2. WHEN the Planner determines simple complexity THEN the SafeBill System SHALL execute retrieve, summarize, and validate steps
3. WHEN the Planner determines complex complexity THEN the SafeBill System SHALL execute retrieve, calculate, policy_check, summarize, and validate steps
4. WHEN answer generation completes THEN the SafeBill System SHALL include citations with chunk_id references for all claims
5. WHEN numeric calculations are included THEN the SafeBill System SHALL validate math programmatically rather than trusting LLM output
6. WHEN answer validation completes THEN the SafeBill System SHALL compute confidence score and hallucination flag
7. WHEN the ask request completes THEN the SafeBill System SHALL log query, runtime, precision, recall, and diagnostics to qa_logs table

### Requirement 5

**User Story:** As a consumer, I want the system to detect warranty information and create reminders, so that I don't miss warranty expiration or claim deadlines.

#### Acceptance Criteria

1. WHEN a document contains warranty_months metadata THEN the SafeBill System SHALL compute warranty_start and warranty_end dates
2. WHEN warranty_end date is computed THEN the SafeBill System SHALL create notification jobs for configured alert_days
3. WHEN a reminder query is executed THEN the SafeBill System SHALL return reminders within the specified days_ahead window
4. WHEN reminders are returned THEN the SafeBill System SHALL include daysRemaining and urgencyTone fields
5. WHEN notification jobs are due THEN the SafeBill System SHALL send notifications via configured channels (email, SMS, push, WhatsApp)

### Requirement 6

**User Story:** As a merchant, I want to manually create bills and assign them to consumers, so that I can provide digital records to my customers.

#### Acceptance Criteria

1. WHEN a merchant creates a manual bill THEN the SafeBill System SHALL generate a document with merchant and consumer metadata
2. WHEN a manual bill is created THEN the SafeBill System SHALL set source to merchant_manual and assignment_source to merchant_manual
3. WHEN a manual bill is assigned THEN the SafeBill System SHALL store merchant_user_id, merchant_name, and merchant_custom_id in document references
4. WHEN a manual bill is assigned THEN the SafeBill System SHALL store consumer_user_id, consumer_name, and consumer_custom_id in document references
5. WHEN a manual bill is created THEN the SafeBill System SHALL create chunks and embeddings for the generated content

### Requirement 7

**User Story:** As a merchant, I want to upload bills and assign them to specific consumers, so that I can share purchase records with my customers.

#### Acceptance Criteria

1. WHEN a merchant uploads a bill with consumer assignment THEN the SafeBill System SHALL ingest the document and set assignment metadata
2. WHEN a merchant assigns a document THEN the SafeBill System SHALL create a MerchantAssignmentAudit record with status assigned
3. WHEN a merchant assignment is created THEN the SafeBill System SHALL set assignment_source to merchant_upload or merchant_reassign
4. WHEN a merchant queries their activity THEN the SafeBill System SHALL return documents filtered by merchant_user_id
5. WHEN a consumer queries their documents THEN the SafeBill System SHALL return documents filtered by user_id including merchant-assigned documents

### Requirement 8

**User Story:** As a merchant, I want to view my activity history, so that I can track which bills I've issued and assigned to consumers.

#### Acceptance Criteria

1. WHEN a merchant requests activity history THEN the SafeBill System SHALL return documents filtered by merchant_user_id
2. WHEN activity items are returned THEN the SafeBill System SHALL include consumer information, document metadata, and action type
3. WHEN activity items are returned THEN the SafeBill System SHALL sort by created_at in descending order
4. WHEN a limit parameter is provided THEN the SafeBill System SHALL return at most limit activity items
5. WHEN activity includes manual bills THEN the SafeBill System SHALL indicate source as merchant_manual and action as generated

### Requirement 9

**User Story:** As a system administrator, I want GST compliance checking on invoices, so that I can identify potential tax reporting issues.

#### Acceptance Criteria

1. WHEN a document is processed THEN the SafeBill System SHALL extract GSTIN, invoice number, invoice date, and tax amounts
2. WHEN GSTIN is extracted THEN the SafeBill System SHALL validate format and checksum according to Indian GST rules
3. WHEN tax amounts are extracted THEN the SafeBill System SHALL validate that reported GST matches expected GST within tolerance
4. WHEN compliance checking completes THEN the SafeBill System SHALL compute a compliance score from 0 to 100
5. WHEN compliance issues are detected THEN the SafeBill System SHALL generate alerts with severity and message
6. WHEN e-invoice requirements apply THEN the SafeBill System SHALL check for IRN and QR code presence

### Requirement 10

**User Story:** As a consumer, I want to find nearby service centers for warranty claims, so that I can get my products repaired or replaced.

#### Acceptance Criteria

1. WHEN a consumer asks about service centers THEN the SafeBill System SHALL extract product brand from document metadata
2. WHEN brand is identified THEN the SafeBill System SHALL query the service center directory for matching locations
3. WHEN user location is provided THEN the SafeBill System SHALL compute distance from user to each service center
4. WHEN service centers are returned THEN the SafeBill System SHALL include name, address, phone, distance_km, and map_url
5. WHEN service centers are returned THEN the SafeBill System SHALL sort by distance_km in ascending order

### Requirement 11

**User Story:** As a consumer, I want low-confidence extractions to be flagged for review, so that I can correct errors before relying on the data.

#### Acceptance Criteria

1. WHEN document extraction completes THEN the SafeBill System SHALL compute confidence scores for each extracted field
2. WHEN field confidence is below threshold THEN the SafeBill System SHALL add the field to low_confidence_fields list
3. WHEN low confidence fields exist THEN the SafeBill System SHALL create an ExtractionReview record with status pending
4. WHEN a reviewer confirms fields THEN the SafeBill System SHALL update ExtractionReview status to confirmed and store confirmed_fields
5. WHEN extraction review is completed THEN the SafeBill System SHALL update document metadata with confirmed values

### Requirement 12

**User Story:** As a system, I want to enforce tenant isolation in all queries, so that users can only access their own documents.

#### Acceptance Criteria

1. WHEN a consumer queries documents THEN the SafeBill System SHALL filter by user_id in document references
2. WHEN a merchant queries documents THEN the SafeBill System SHALL filter by merchant_user_id in document references
3. WHEN hybrid retrieval executes THEN the SafeBill System SHALL apply user_id or merchant_user_id filters to vector and keyword searches
4. WHEN a document is retrieved by ID THEN the SafeBill System SHALL verify user_id or merchant_user_id matches before returning
5. WHEN a document is deleted THEN the SafeBill System SHALL verify user_id or merchant_user_id matches before deletion

### Requirement 13

**User Story:** As a system administrator, I want security audit logging for all sensitive operations, so that I can track access and detect anomalies.

#### Acceptance Criteria

1. WHEN a user authenticates THEN the SafeBill System SHALL log event_type, user_id, actor_role, and client_ip
2. WHEN a document is accessed THEN the SafeBill System SHALL log the access event with resource identifier
3. WHEN a document is modified or deleted THEN the SafeBill System SHALL log the modification event with actor information
4. WHEN a merchant assigns a document THEN the SafeBill System SHALL log the assignment event with merchant and consumer identifiers
5. WHEN security events are logged THEN the SafeBill System SHALL include event_metadata with operation-specific details

### Requirement 14

**User Story:** As a consumer, I want notification preferences for different channels, so that I can control how and when I receive alerts.

#### Acceptance Criteria

1. WHEN a consumer sets notification preferences THEN the SafeBill System SHALL store channel enablement flags for email, SMS, push, and WhatsApp
2. WHEN a consumer configures alert_days THEN the SafeBill System SHALL create notification jobs for those days before warranty expiration
3. WHEN a notification job is created THEN the SafeBill System SHALL respect the consumer's channel preferences
4. WHEN a notification is sent THEN the SafeBill System SHALL create a NotificationDelivery record with status and latency
5. WHEN a notification fails THEN the SafeBill System SHALL retry according to retry_count and fallback_channel configuration

### Requirement 15

**User Story:** As a system, I want to handle prompt injection attacks, so that malicious queries cannot compromise the system.

#### Acceptance Criteria

1. WHEN a query is received THEN the SafeBill System SHALL sanitize input to remove prompt injection patterns
2. WHEN a query contains suspicious patterns THEN the SafeBill System SHALL log a security audit event
3. WHEN answer generation executes THEN the SafeBill System SHALL use system prompts that enforce grounding constraints
4. WHEN citations are generated THEN the SafeBill System SHALL validate that all cited chunk_ids exist in retrieved results
5. WHEN numeric claims are made THEN the SafeBill System SHALL validate against programmatic calculations rather than trusting LLM output
