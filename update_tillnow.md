# SafeBill Project Update (Till Now)

Last updated: February 11, 2026  
Prepared for: Current local workspace at `C:\Users\Anshu Raj\Desktop\ssafebill-prod`

## 1. Objective Achieved So Far

This project has been transformed from a partially connected frontend/backend setup into a working multi-role web app foundation with:

- Consumer flow connected end-to-end (scan, locker, reminders, document detail, chat, claims context).
- Merchant flow connected to real backend APIs (consumer lookup, upload+assign, manual bill generation, activity tracking).
- Shared source of truth in backend document store (Neon Postgres).
- Working RAG pipeline with embeddings, retrieval, citations, Pinecone support, and user-level query scoping.
- Runtime hardening around ingestion failures and duplicate invoice re-uploads.

## 2. High-Level Architecture (Current)

- Frontend: Next.js App Router app (`nextjs-app`) with `/api/*` proxy routes.
- Backend: FastAPI app (`backend/app`) exposing `/api/v1/*`.
- Primary DB: Neon Postgres (documents/chunks/qa logs).
- Vector DB: Pinecone (configured and active via backend vector store abstraction).
- Auth UX layer: Supabase Auth + `user_profiles` table used by frontend for consumer/merchant identity and routing.
- Authorization for backend APIs: Bearer token role mapping in backend settings.

## 3. Backend Work Completed

### 3.1 Core ingestion and retrieval APIs

- Implemented and stabilized ingestion endpoints:
  - `POST /api/v1/ingest/pdf`
  - `POST /api/v1/ingest/image`
  - `POST /api/v1/ingest/vendor-table`
- Implemented document/reminder APIs:
  - `GET /api/v1/documents`
  - `GET /api/v1/documents/{doc_id}`
  - `DELETE /api/v1/documents/{doc_id}`
  - `GET /api/v1/reminders`
- Implemented RAG APIs:
  - `POST /api/v1/search`
  - `POST /api/v1/ask`

### 3.2 Structured document serialization for frontend

- Added typed response models in `backend/app/schemas.py` for frontend consumption:
  - `DocumentView`, `DocumentsResponse`
  - `WarrantyItemView`
  - `ReminderView`, `RemindersResponse`
- Added enrichment fields used in UI and cross-role sync:
  - `source`
  - `assignedByMerchantId`
  - `assignedByMerchantName`
  - `assignedByMerchantCustomId`
  - `consumerCustomId`

### 3.3 Merchant APIs (new)

- Added new merchant operation endpoints in `backend/app/api/routes.py`:
  - `POST /api/v1/merchant/manual-bill`
  - `POST /api/v1/merchant/documents/{doc_id}/assign`
  - `GET /api/v1/merchant/activity`
- Added request/response contracts in `backend/app/schemas.py`:
  - `MerchantManualBillRequest`
  - `MerchantIssueBillResponse`
  - `MerchantAssignRequest`
  - `MerchantActivityItem`
  - `MerchantActivityResponse`
- Merchant flows now stamp assignment metadata into `Document.references` so both consumer and merchant UIs stay synchronized.

### 3.4 Retrieval scoping and data safety

- Added `user_id` and `merchant_user_id` filter support in `MetadataFilter`.
- Updated retrieval filtering in `backend/app/services/retrieval.py` to enforce document-level scoping:
  - `Document.references["user_id"]`
  - `Document.references["merchant_user_id"]`
- Updated list/get/delete document endpoints to accept merchant filter in addition to user filter.

### 3.5 Pinecone + vector path

- Pinecone vector store support added and integrated:
  - `backend/app/services/vector_store.py`
  - Ingestion upserts vectors when enabled.
  - Retrieval can query Pinecone and combine with keyword signal.
- Fixed vector serialization robustness in ingestion:
  - Normalized embeddings before upsert (`tolist()` or list cast).

### 3.6 Neon/Postgres compatibility fixes

- Updated schema strategy to avoid problematic generated-column behavior and high-dim index creation issues:
  - Trigger-based `tsv` update path.
  - Removed unsupported ivfflat creation for oversized dimensions in this environment.

### 3.7 Ingestion reliability fixes (critical)

Two production-impacting `500` causes were fixed:

1. Duplicate `bill_id + version` crash on re-upload:
   - File: `backend/app/services/ingestion.py`
   - Behavior now: auto-increments version for existing `bill_id` instead of failing.

2. OCR hard crash when Tesseract is missing:
   - File: `backend/app/parsers/pdf_parser.py`
   - Behavior now: OCR is best-effort and returns empty text if OCR binary is unavailable, ingestion continues.

## 4. Frontend Work Completed

### 4.1 API proxy layer to backend

- Added/updated Next.js API routes to proxy backend:
  - `nextjs-app/app/api/scan/route.ts`
  - `nextjs-app/app/api/chat/route.ts`
  - `nextjs-app/app/api/documents/route.ts`
  - `nextjs-app/app/api/documents/[id]/route.ts`
  - `nextjs-app/app/api/reminders/route.ts`
  - New merchant routes:
    - `nextjs-app/app/api/merchant/activity/route.ts`
    - `nextjs-app/app/api/merchant/manual-bill/route.ts`
    - `nextjs-app/app/api/merchant/upload/route.ts`
    - `nextjs-app/app/api/merchant/documents/[id]/assign/route.ts`

### 4.2 Consumer flow wiring

- Consumer screens now use backend-backed data for:
  - Locker
  - Document detail
  - Reminders
  - Scan ingestion
  - Chat grounding
  - Claims flow document feed

### 4.3 Merchant dashboard wiring (major)

- `nextjs-app/components/merchant-dashboard-screen.tsx` rebuilt from static demo into real functional flow:
  - Consumer ID verification via Supabase `user_profiles`.
  - Upload and assign bill to selected consumer.
  - Generate manual bill and assign to selected consumer.
  - Live merchant activity feed from backend.
  - Dashboard stats from backend activity data.
  - Status/error feedback for operations.

### 4.4 Auth and role synchronization improvements

- Extended frontend user type model in `nextjs-app/lib/types.ts`:
  - `userType`
  - `customId`
- Updated auth persistence in `nextjs-app/lib/store/auth-store.ts`:
  - Stores role-aware cookies: `auth_token`, `user_type`, `custom_id`.
- Updated login flow in `nextjs-app/components/landing-screen.tsx`:
  - Pulls `custom_id` and `user_type` from profile and stores with auth state.
- Updated signup flow in `nextjs-app/components/signup-screen.tsx`:
  - Stores role/custom id in auth state.
  - Preserves selected user type for OAuth redirect.
- Rewrote OAuth callback in `nextjs-app/app/auth/callback/page.tsx`:
  - Resolves/creates `user_profiles` row.
  - Assigns generated role-based custom ID when missing.
  - Redirects based on resolved role.
- Updated `nextjs-app/middleware.ts`:
  - Consumer routes and merchant routes are both protected.
  - Role-based redirect prevention (consumer cannot open merchant dashboard and vice versa).

### 4.5 Chat scoping update

- `nextjs-app/app/api/chat/route.ts` now forwards `userId` as backend `filters.user_id` for tenant-safe retrieval.

## 5. Data Metadata Conventions Now Used

These keys are now used in `Document.references` to synchronize behavior:

- `user_id`
- `consumer_custom_id`
- `consumer_name`
- `merchant_user_id`
- `merchant_name`
- `merchant_custom_id`
- `assignment_source` (`merchant_upload`, `merchant_manual`, `merchant_reassign`)
- `source` (`pdf`, `image_ocr`, `merchant_manual`, etc.)
- `category`, `title`, `product_name`, `brand`
- `warranty_months`, `warranty_start`, `warranty_end`

## 6. File-Level Change Index

| File | What was done |
|---|---|
| `backend/app/api/routes.py` | Added merchant endpoints, metadata serialization updates, merchant/user filters, ingestion metadata extension. |
| `backend/app/schemas.py` | Added merchant request/response models, expanded document/filter schema. |
| `backend/app/services/retrieval.py` | Added `user_id` and `merchant_user_id` filtering support. |
| `backend/app/services/ingestion.py` | Pinecone vector normalization; PDF version auto-increment collision handling. |
| `backend/app/parsers/pdf_parser.py` | OCR fallback when Tesseract is unavailable. |
| `backend/app/core/config.py` | Pinecone settings support added earlier in the integration phase. |
| `backend/app/services/vector_store.py` | Pinecone vector store client abstraction. |
| `backend/openapi.yaml` | Endpoint specification updates including ingest/image and document/reminder APIs. |
| `backend/.env.example` | Added Neon/Pinecone/OpenAI config variables. |
| `backend/sql/002_schema.sql` | Neon compatibility adjustments for tsv/index behavior. |
| `backend/tests/test_document_endpoints.py` | Document/reminder API coverage. |
| `backend/tests/test_image_ingest_api.py` | Image ingestion endpoint coverage. |
| `backend/tests/test_ingestion_versioning.py` | New regression test for duplicate invoice upload versioning behavior. |
| `backend/tests/test_pdf_parser_ocr_fallback.py` | New regression test for OCR failure fallback behavior. |
| `nextjs-app/lib/backend-api.ts` | Backend proxy fetch helper with auth + timeout behavior. |
| `nextjs-app/lib/api-client.ts` | Unified app API base usage (`/api` default). |
| `nextjs-app/lib/types.ts` | Added merchant activity/manual payload/user role metadata fields. |
| `nextjs-app/lib/store/auth-store.ts` | Auth cookie persistence for role + custom ID. |
| `nextjs-app/app/api/chat/route.ts` | Added user filter forwarding to backend ask. |
| `nextjs-app/app/api/scan/route.ts` | File ingestion proxy (pdf/image) + document retrieval. |
| `nextjs-app/app/api/documents/route.ts` | Added merchant filter support in query proxy. |
| `nextjs-app/app/api/documents/[id]/route.ts` | Added merchant filter support for get/delete proxy. |
| `nextjs-app/app/api/reminders/route.ts` | Reminder list proxy to backend. |
| `nextjs-app/app/api/merchant/activity/route.ts` | New merchant activity proxy route. |
| `nextjs-app/app/api/merchant/manual-bill/route.ts` | New manual bill creation proxy route. |
| `nextjs-app/app/api/merchant/upload/route.ts` | New upload+assign proxy route for merchant. |
| `nextjs-app/app/api/merchant/documents/[id]/assign/route.ts` | New explicit assign/reassign proxy route. |
| `nextjs-app/components/locker-screen.tsx` | Consumer locker bound to backend documents. |
| `nextjs-app/components/document-detail-screen.tsx` | Consumer detail + contextual chat bound to backend. |
| `nextjs-app/components/scan-screen.tsx` | Consumer scan bound to backend ingestion. |
| `nextjs-app/components/reminders-screen.tsx` | Reminder list bound to backend reminders. |
| `nextjs-app/components/chat-screen.tsx` | Chat integrated through backend ask proxy. |
| `nextjs-app/components/claim-wizard-screen.tsx` | Claim flow uses backend document feed. |
| `nextjs-app/components/merchant-dashboard-screen.tsx` | Full merchant functional UI built. |
| `nextjs-app/components/landing-screen.tsx` | Profile lookup/auth state now stores role/custom ID. |
| `nextjs-app/components/signup-screen.tsx` | Signup auth state stores role/custom ID; OAuth role handoff. |
| `nextjs-app/app/auth/callback/page.tsx` | Role-aware callback, profile resolve/create, proper redirect. |
| `nextjs-app/middleware.ts` | Added role-specific route protection/redirect logic. |
| `nextjs-app/README.md` | Updated project documentation for backend-connected architecture. |
| `nextjs-app/DEPLOYMENT.md` | Deployment notes for backend proxy envs and runtime behavior. |
| `nextjs-app/QUICK_DEPLOY.md` | Quick deployment update for current architecture. |
| `nextjs-app/.env.local.example` | Local environment template for frontend-backend integration. |

## 7. Validation and Test Results

### Backend tests

Command run:

```powershell
py -3.13 -m pytest -q tests
```

Result:

- `18 passed`

### Frontend checks

Commands run:

```powershell
npm run lint
npm run build
```

Results:

- Lint: no warnings/errors.
- Build: successful production compile with all API routes and pages.

### Live runtime checks done

- Backend health `GET /api/v1/health`: `200`.
- Frontend home `GET /`: `200`.
- Merchant manual bill creation: success.
- Merchant upload+assign: success.
- Merchant activity list: success.
- Consumer locker visibility by assigned user: success.
- Chat scoping by `userId`: success.
- Re-upload duplicate PDF with same invoice id: no crash after fix.

## 8. Operational Notes

- Current backend is running locally on port `8000`.
- Current frontend dev server is running locally on port `3000`.
- Pinecone must match embedding dimensionality in runtime config.
- If frontend shows transient `500` in dev mode after heavy code changes, restarting Next dev server resolves stale runtime module state.

## 9. Remaining Gaps Before True Production Grade

- Replace static backend API tokens with real service auth + tenant RBAC.
- Add async job queue for ingestion and OCR retries.
- Add full RAG evaluation harness with quality thresholds and CI gates.
- Add metrics/tracing/alerting dashboards and SLOs.
- Add stronger PII controls, retention/deletion automation, and audit policies.
- Add deployment automation and release rollback strategy.

## 10. Summary

As of this update, the project is now a working synchronized two-division web application:

- Merchant actions create/assign records through backend APIs.
- Consumer locker/reminders/chat see the same documents from backend storage.
- RAG retrieval is scoped by user and cites grounded chunks.
- Core ingestion failure modes that were causing `Internal Server Error` in merchant assignment are fixed.
