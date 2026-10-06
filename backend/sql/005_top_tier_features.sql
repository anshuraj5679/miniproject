CREATE TABLE IF NOT EXISTS extraction_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    field_confidences JSONB NOT NULL DEFAULT '{}'::jsonb,
    low_confidence_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    confirmed_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    reviewer_user_id VARCHAR(128),
    review_notes TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_extraction_reviews_document_id UNIQUE (document_id)
);

ALTER TABLE extraction_reviews ADD COLUMN IF NOT EXISTS field_confidences JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE extraction_reviews ADD COLUMN IF NOT EXISTS low_confidence_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE extraction_reviews ADD COLUMN IF NOT EXISTS extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE extraction_reviews ADD COLUMN IF NOT EXISTS confirmed_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE extraction_reviews ADD COLUMN IF NOT EXISTS reviewer_user_id VARCHAR(128);
ALTER TABLE extraction_reviews ADD COLUMN IF NOT EXISTS review_notes TEXT;
ALTER TABLE extraction_reviews ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE extraction_reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS ix_extraction_reviews_document_id
    ON extraction_reviews (document_id);
CREATE INDEX IF NOT EXISTS ix_extraction_reviews_user_status
    ON extraction_reviews (user_id, status);
CREATE INDEX IF NOT EXISTS ix_extraction_reviews_created_at
    ON extraction_reviews (created_at);

CREATE TABLE IF NOT EXISTS merchant_assignment_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    merchant_user_id VARCHAR(128) NOT NULL,
    consumer_user_id VARCHAR(128) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'assigned',
    assignment_source VARCHAR(48),
    accepted_at TIMESTAMPTZ,
    escalated_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE merchant_assignment_audits ADD COLUMN IF NOT EXISTS assignment_source VARCHAR(48);
ALTER TABLE merchant_assignment_audits ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE merchant_assignment_audits ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE merchant_assignment_audits ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE merchant_assignment_audits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS ix_merchant_assignment_audits_document_id
    ON merchant_assignment_audits (document_id);
CREATE INDEX IF NOT EXISTS ix_merchant_assignment_audits_merchant_created
    ON merchant_assignment_audits (merchant_user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_merchant_assignment_audits_consumer_status
    ON merchant_assignment_audits (consumer_user_id, status);

CREATE TABLE IF NOT EXISTS security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(64) NOT NULL,
    actor_role VARCHAR(64),
    user_id VARCHAR(128),
    resource VARCHAR(255),
    client_ip VARCHAR(128),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_security_audit_logs_event_created
    ON security_audit_logs (event_type, created_at);
CREATE INDEX IF NOT EXISTS ix_security_audit_logs_user_created
    ON security_audit_logs (user_id, created_at);
