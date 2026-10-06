CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id VARCHAR(128) NOT NULL,
    vendor VARCHAR(256) NOT NULL,
    date DATE,
    total_amount NUMERIC(18, 2),
    version INTEGER NOT NULL DEFAULT 1,
    "references" JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_documents_bill_version UNIQUE (bill_id, version)
);

CREATE INDEX IF NOT EXISTS ix_documents_bill_id ON documents (bill_id);
CREATE INDEX IF NOT EXISTS ix_documents_vendor ON documents (vendor);
CREATE INDEX IF NOT EXISTS ix_documents_date ON documents (date);
CREATE INDEX IF NOT EXISTS ix_documents_vendor_date ON documents (vendor, date);

CREATE TABLE IF NOT EXISTS chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_type VARCHAR(64) NOT NULL,
    content TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    hypothetical_questions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    embedding_vector VECTOR(3072),
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    tsv tsvector,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_chunks_tsv() RETURNS trigger AS $$
BEGIN
    NEW.tsv := to_tsvector(
        'simple',
        coalesce(NEW.content, '') || ' ' || coalesce(NEW.summary, '') || ' ' || coalesce(array_to_string(NEW.keywords, ' '), '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chunks_tsv ON chunks;
CREATE TRIGGER trg_chunks_tsv
BEFORE INSERT OR UPDATE OF content, summary, keywords
ON chunks
FOR EACH ROW
EXECUTE FUNCTION update_chunks_tsv();

CREATE INDEX IF NOT EXISTS ix_chunks_document_id ON chunks (document_id);
CREATE INDEX IF NOT EXISTS ix_chunks_chunk_type ON chunks (chunk_type);
CREATE INDEX IF NOT EXISTS ix_chunks_document_type ON chunks (document_id, chunk_type);
CREATE INDEX IF NOT EXISTS ix_chunks_tsv ON chunks USING GIN (tsv);

CREATE TABLE IF NOT EXISTS qa_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query TEXT NOT NULL,
    runtime_ms INTEGER NOT NULL,
    precision_score DOUBLE PRECISION NOT NULL,
    recall_score DOUBLE PRECISION NOT NULL,
    hallucination_flag BOOLEAN NOT NULL,
    confidence_score DOUBLE PRECISION NOT NULL,
    citations JSONB NOT NULL DEFAULT '[]'::jsonb,
    diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_qa_logs_created_at ON qa_logs (created_at DESC);
