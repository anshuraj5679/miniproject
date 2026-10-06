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
