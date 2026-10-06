ALTER TABLE IF EXISTS chunks
DROP COLUMN IF EXISTS embedding_vector;

DO $$
DECLARE
    fn_args TEXT;
BEGIN
    SELECT pg_get_function_identity_arguments(p.oid)
    INTO fn_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'hybrid_search_chunks'
      AND n.nspname = current_schema()
    LIMIT 1;

    IF fn_args IS NOT NULL THEN
        EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s)', current_schema(), 'hybrid_search_chunks', fn_args);
    END IF;
END;
$$;

DROP EXTENSION IF EXISTS vector;
