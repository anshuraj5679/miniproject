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

ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS sms_number VARCHAR(32);
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_subscription JSONB;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(32);
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS claim_alert_days JSONB NOT NULL DEFAULT '[14, 3]'::jsonb;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS locale VARCHAR(32) NOT NULL DEFAULT 'en';
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

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

ALTER TABLE notification_jobs ADD COLUMN IF NOT EXISTS channel VARCHAR(24) NOT NULL DEFAULT 'email';
ALTER TABLE notification_jobs ADD COLUMN IF NOT EXISTS event_type VARCHAR(64);
ALTER TABLE notification_jobs ADD COLUMN IF NOT EXISTS template_key VARCHAR(96);
ALTER TABLE notification_jobs ADD COLUMN IF NOT EXISTS template_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_jobs ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 5;
ALTER TABLE notification_jobs ADD COLUMN IF NOT EXISTS fallback_channel VARCHAR(24);
ALTER TABLE notification_jobs ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE notification_jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Backfill legacy in-app rows created before channel support.
UPDATE notification_jobs
SET channel = 'in_app'
WHERE channel = 'email'
  AND (
      recipient_email = 'in-app@local'
      OR status IN ('unread', 'read', 'deleted')
      OR job_type LIKE 'in_app_%'
  );

CREATE INDEX IF NOT EXISTS ix_notification_jobs_document_id
    ON notification_jobs (document_id);
CREATE INDEX IF NOT EXISTS ix_notification_jobs_user_id
    ON notification_jobs (user_id);
CREATE INDEX IF NOT EXISTS ix_notification_jobs_send_at_status
    ON notification_jobs (send_at, status);
CREATE INDEX IF NOT EXISTS ix_notification_jobs_user_status
    ON notification_jobs (user_id, status);
CREATE INDEX IF NOT EXISTS ix_notification_jobs_channel_status
    ON notification_jobs (channel, status);

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

CREATE INDEX IF NOT EXISTS ix_notification_events_document_id
    ON notification_events (document_id);
CREATE INDEX IF NOT EXISTS ix_notification_events_type_created
    ON notification_events (event_type, created_at);
CREATE INDEX IF NOT EXISTS ix_notification_events_subject_created
    ON notification_events (subject_user_id, created_at);

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

CREATE INDEX IF NOT EXISTS ix_notification_deliveries_job_id
    ON notification_deliveries (job_id);
CREATE INDEX IF NOT EXISTS ix_notification_deliveries_job_created
    ON notification_deliveries (job_id, created_at);
CREATE INDEX IF NOT EXISTS ix_notification_deliveries_status
    ON notification_deliveries (status);
