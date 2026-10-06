-- ============================================================
-- SafeBill: Complete Supabase Database Migration
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- 001: Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 002: Core Schema - Documents & Chunks
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

-- 004: Notifications
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL UNIQUE,
    email VARCHAR(320) NOT NULL,
    full_name VARCHAR(255),
    in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sms_number VARCHAR(32),
    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    push_subscription JSONB,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_number VARCHAR(32),
    alert_days JSONB NOT NULL DEFAULT '[30, 7, 1]'::jsonb,
    claim_alert_days JSONB NOT NULL DEFAULT '[14, 3]'::jsonb,
    locale VARCHAR(32) NOT NULL DEFAULT 'en',
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_notification_preferences_user_id
    ON notification_preferences (user_id);

CREATE TABLE IF NOT EXISTS notification_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    channel VARCHAR(24) NOT NULL DEFAULT 'email',
    job_type VARCHAR(64) NOT NULL,
    event_type VARCHAR(64),
    template_key VARCHAR(96),
    template_version INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 5,
    fallback_channel VARCHAR(24),
    send_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    recipient_email VARCHAR(320) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key VARCHAR(255) NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    read_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notification_jobs_dedupe_key UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS ix_notification_jobs_document_id ON notification_jobs (document_id);
CREATE INDEX IF NOT EXISTS ix_notification_jobs_user_id ON notification_jobs (user_id);
CREATE INDEX IF NOT EXISTS ix_notification_jobs_send_at_status ON notification_jobs (send_at, status);
CREATE INDEX IF NOT EXISTS ix_notification_jobs_user_status ON notification_jobs (user_id, status);
CREATE INDEX IF NOT EXISTS ix_notification_jobs_channel_status ON notification_jobs (channel, status);

CREATE TABLE IF NOT EXISTS notification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(64) NOT NULL,
    event_key VARCHAR(255) NOT NULL,
    actor_user_id VARCHAR(128),
    subject_user_id VARCHAR(128),
    merchant_user_id VARCHAR(128),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(24) NOT NULL DEFAULT 'scheduled',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notification_events_event_key UNIQUE (event_key)
);

CREATE INDEX IF NOT EXISTS ix_notification_events_document_id ON notification_events (document_id);
CREATE INDEX IF NOT EXISTS ix_notification_events_type_created ON notification_events (event_type, created_at);
CREATE INDEX IF NOT EXISTS ix_notification_events_subject_created ON notification_events (subject_user_id, created_at);

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
    channel VARCHAR(24) NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(24) NOT NULL,
    provider_message_id VARCHAR(255),
    provider_payload JSONB,
    error_message TEXT,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_notification_deliveries_job_id ON notification_deliveries (job_id);
CREATE INDEX IF NOT EXISTS ix_notification_deliveries_job_created ON notification_deliveries (job_id, created_at);
CREATE INDEX IF NOT EXISTS ix_notification_deliveries_status ON notification_deliveries (status);

-- 005: Top-tier Features
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

CREATE INDEX IF NOT EXISTS ix_extraction_reviews_document_id ON extraction_reviews (document_id);
CREATE INDEX IF NOT EXISTS ix_extraction_reviews_user_status ON extraction_reviews (user_id, status);
CREATE INDEX IF NOT EXISTS ix_extraction_reviews_created_at ON extraction_reviews (created_at);

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

CREATE INDEX IF NOT EXISTS ix_merchant_assignment_audits_document_id ON merchant_assignment_audits (document_id);
CREATE INDEX IF NOT EXISTS ix_merchant_assignment_audits_merchant_created ON merchant_assignment_audits (merchant_user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_merchant_assignment_audits_consumer_status ON merchant_assignment_audits (consumer_user_id, status);

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

CREATE INDEX IF NOT EXISTS ix_security_audit_logs_event_created ON security_audit_logs (event_type, created_at);
CREATE INDEX IF NOT EXISTS ix_security_audit_logs_user_created ON security_audit_logs (user_id, created_at);

-- 007: Async Extraction Jobs
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

-- User Profiles (Supabase Auth integration)
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    custom_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    user_type TEXT NOT NULL DEFAULT 'consumer',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow users to read own profile" ON user_profiles;
DROP POLICY IF EXISTS "Allow users to insert own user_profile" ON user_profiles;
DROP POLICY IF EXISTS "Allow users to update own user_profile" ON user_profiles;

CREATE POLICY "Allow users to read own profile"
    ON user_profiles FOR SELECT
    USING (auth.uid() = user_id);

-- Profiles are created server-side; see section 008 at the end of this file.

-- Scanned Bills (client-side scanned data)
CREATE TABLE IF NOT EXISTS scanned_bills (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    doc_id TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT,
    file_name TEXT,
    product_name TEXT,
    brand TEXT,
    category TEXT DEFAULT 'Others',
    amount TEXT,
    purchase_date TEXT,
    warranty_period TEXT,
    warranty_start TEXT,
    warranty_end TEXT,
    serial_number TEXT,
    invoice_number TEXT,
    store TEXT,
    extracted_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE scanned_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow users to insert own scanned_bills" ON scanned_bills;
DROP POLICY IF EXISTS "Allow users to read own scanned_bills only" ON scanned_bills;
DROP POLICY IF EXISTS "Allow users to delete own scanned_bills only" ON scanned_bills;

CREATE POLICY "Allow users to insert own scanned_bills"
    ON scanned_bills FOR INSERT
    WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Allow users to read own scanned_bills only"
    ON scanned_bills FOR SELECT
    USING (auth.uid()::text = user_id);

CREATE POLICY "Allow users to delete own scanned_bills only"
    ON scanned_bills FOR DELETE
    USING (auth.uid()::text = user_id);

-- ============================================================
-- 008: Supabase auth hardening
--
-- * The SafeBill role (consumer / merchant) now lives in auth.users.raw_app_meta_data,
--   which only the server can write. The backend no longer trusts user_metadata,
--   because users can edit that themselves with supabase.auth.updateUser().
-- * user_profiles rows are created server-side (trigger + RPC). Clients can no
--   longer insert profiles or change user_type / custom_id.
-- * One profile per auth user.
--
-- Run once in Supabase Dashboard -> SQL Editor. Safe to re-run.
-- ============================================================

-- 1. One profile per auth user --------------------------------------------------
DELETE FROM public.user_profiles a
USING public.user_profiles b
WHERE a.user_id = b.user_id
  AND (COALESCE(a.created_at, 'epoch'::timestamptz), a.id::text)
    > (COALESCE(b.created_at, 'epoch'::timestamptz), b.id::text);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_user_id_key ON public.user_profiles (user_id);

-- 2. Helpers ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.safebill_generate_custom_id(p_user_type text)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    prefix text := CASE WHEN p_user_type = 'merchant' THEN 'MER' ELSE 'CON' END;
    candidate text;
BEGIN
    LOOP
        candidate := prefix || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE custom_id = candidate);
    END LOOP;
    RETURN candidate;
END;
$$;

-- Creates the profile for an auth user whose app_metadata.user_type is already set.
-- Returns the (existing or new) profile, or NULL when the user has no role yet.
CREATE OR REPLACE FUNCTION public.safebill_upsert_profile(p_user_id uuid)
RETURNS public.user_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    u auth.users%ROWTYPE;
    role_value text;
    prefix text;
    requested_id text;
    resolved_id text;
    profile public.user_profiles;
BEGIN
    SELECT * INTO u FROM auth.users WHERE id = p_user_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    role_value := u.raw_app_meta_data ->> 'user_type';
    IF role_value IS NULL OR role_value NOT IN ('consumer', 'merchant') THEN
        RETURN NULL;
    END IF;

    SELECT * INTO profile FROM public.user_profiles WHERE user_id = p_user_id;
    IF FOUND THEN
        RETURN profile;
    END IF;

    prefix := CASE WHEN role_value = 'merchant' THEN 'MER-' ELSE 'CON-' END;
    requested_id := upper(COALESCE(u.raw_user_meta_data ->> 'custom_id', ''));
    IF requested_id ~ '^(CON|MER)-[0-9A-F]{8}$'
       AND left(requested_id, 4) = prefix
       AND NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE custom_id = requested_id) THEN
        resolved_id := requested_id;
    ELSE
        resolved_id := public.safebill_generate_custom_id(role_value);
    END IF;

    INSERT INTO public.user_profiles (user_id, custom_id, email, full_name, user_type)
    VALUES (
        p_user_id,
        resolved_id,
        COALESCE(u.email, u.phone, ''),
        COALESCE(
            NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
            NULLIF(u.raw_user_meta_data ->> 'name', ''),
            NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
            'User'
        ),
        role_value
    )
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO profile FROM public.user_profiles WHERE user_id = p_user_id;
    RETURN profile;
END;
$$;

-- 3. Triggers on auth.users ------------------------------------------------------------
-- Email/phone sign-up sends user_type in the sign-up metadata. Copy it into
-- app_metadata exactly once, at creation time.
CREATE OR REPLACE FUNCTION public.safebill_before_auth_user_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    requested text := NEW.raw_user_meta_data ->> 'user_type';
BEGIN
    IF requested IN ('consumer', 'merchant')
       AND COALESCE(NEW.raw_app_meta_data ->> 'user_type', '') NOT IN ('consumer', 'merchant') THEN
        NEW.raw_app_meta_data := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb)
            || jsonb_build_object('user_type', requested);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.safebill_after_auth_user_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.safebill_upsert_profile(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS safebill_on_auth_user_before_insert ON auth.users;
CREATE TRIGGER safebill_on_auth_user_before_insert
    BEFORE INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.safebill_before_auth_user_insert();

DROP TRIGGER IF EXISTS safebill_on_auth_user_created ON auth.users;
CREATE TRIGGER safebill_on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.safebill_after_auth_user_insert();

-- 4. RPC for the signed-in user -----------------------------------------------------------
-- OAuth (Google) users have no user_type at creation; the callback page claims one.
-- The role can only be set while it is still empty, so it cannot be changed later.
CREATE OR REPLACE FUNCTION public.safebill_claim_profile(requested_user_type text)
RETURNS public.user_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    uid uuid := auth.uid();
    wanted text := CASE WHEN requested_user_type = 'merchant' THEN 'merchant' ELSE 'consumer' END;
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('user_type', wanted)
    WHERE id = uid
      AND COALESCE(raw_app_meta_data ->> 'user_type', '') NOT IN ('consumer', 'merchant');

    RETURN public.safebill_upsert_profile(uid);
END;
$$;

REVOKE ALL ON FUNCTION public.safebill_generate_custom_id(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.safebill_upsert_profile(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.safebill_before_auth_user_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.safebill_after_auth_user_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.safebill_claim_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safebill_claim_profile(text) TO authenticated;

-- 5. Backfill existing users ---------------------------------------------------------------
-- Existing role = the role recorded in their first profile, else their sign-up metadata.
UPDATE auth.users u
SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'user_type',
    COALESCE(
        (SELECT p.user_type FROM public.user_profiles p
         WHERE p.user_id = u.id AND p.user_type IN ('consumer', 'merchant')
         ORDER BY p.created_at LIMIT 1),
        CASE WHEN u.raw_user_meta_data ->> 'user_type' IN ('consumer', 'merchant')
             THEN u.raw_user_meta_data ->> 'user_type' END,
        'consumer'
    )
)
WHERE COALESCE(u.raw_app_meta_data ->> 'user_type', '') NOT IN ('consumer', 'merchant');

-- Keep profile.user_type in line with the authoritative role.
UPDATE public.user_profiles p
SET user_type = u.raw_app_meta_data ->> 'user_type'
FROM auth.users u
WHERE u.id = p.user_id
  AND p.user_type IS DISTINCT FROM (u.raw_app_meta_data ->> 'user_type');

-- Users who confirmed their email after signing up never got a profile. Create them now.
SELECT public.safebill_upsert_profile(u.id)
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = u.id);

-- 6. Lock down user_profiles -----------------------------------------------------------------
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read of user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow users to insert own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow users to update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow users to insert own user_profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow users to update own user_profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow users to update own profile name" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow users to read own profile" ON public.user_profiles;

CREATE POLICY "Allow users to read own profile"
    ON public.user_profiles FOR SELECT
    USING (auth.uid() = user_id);

-- Users may rename themselves; user_type, custom_id and email are server-managed.
REVOKE INSERT, UPDATE, DELETE ON public.user_profiles FROM anon, authenticated;
GRANT UPDATE (full_name) ON public.user_profiles TO authenticated;

CREATE POLICY "Allow users to update own profile name"
    ON public.user_profiles FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
