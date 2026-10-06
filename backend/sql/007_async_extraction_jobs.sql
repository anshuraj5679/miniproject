CREATE TABLE IF NOT EXISTS extraction_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(24) NOT NULL DEFAULT 'queued',
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(128),
    source_object_key VARCHAR(512),
    source_bucket VARCHAR(255),
    source_region VARCHAR(64),
    user_id VARCHAR(128),
    merchant_user_id VARCHAR(128),
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_text TEXT,
    engines_used JSONB NOT NULL DEFAULT '[]'::jsonb,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_extraction_jobs_status_created ON extraction_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_extraction_jobs_user_status ON extraction_jobs (user_id, status);
CREATE INDEX IF NOT EXISTS ix_extraction_jobs_merchant_status ON extraction_jobs (merchant_user_id, status);
CREATE INDEX IF NOT EXISTS ix_extraction_jobs_document_id ON extraction_jobs (document_id);

CREATE OR REPLACE FUNCTION set_extraction_jobs_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_extraction_jobs_updated_at ON extraction_jobs;
CREATE TRIGGER trg_extraction_jobs_updated_at
BEFORE UPDATE ON extraction_jobs
FOR EACH ROW
EXECUTE FUNCTION set_extraction_jobs_updated_at();
