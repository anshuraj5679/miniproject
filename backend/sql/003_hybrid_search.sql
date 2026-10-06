CREATE OR REPLACE FUNCTION hybrid_search_chunks(
    p_query TEXT,
    p_embedding VECTOR(3072),
    p_vendor TEXT DEFAULT NULL,
    p_date_from DATE DEFAULT NULL,
    p_date_to DATE DEFAULT NULL,
    p_min_amount NUMERIC DEFAULT NULL,
    p_max_amount NUMERIC DEFAULT NULL,
    p_top_k INTEGER DEFAULT 10
)
RETURNS TABLE (
    chunk_id UUID,
    document_id UUID,
    bill_id VARCHAR,
    vendor VARCHAR,
    chunk_type VARCHAR,
    content TEXT,
    summary TEXT,
    vector_score DOUBLE PRECISION,
    keyword_score DOUBLE PRECISION,
    combined_score DOUBLE PRECISION
)
LANGUAGE SQL STABLE
AS $$
    WITH ranked AS (
        SELECT
            c.id AS chunk_id,
            c.document_id,
            d.bill_id,
            d.vendor,
            c.chunk_type,
            c.content,
            c.summary,
            (1 - (c.embedding_vector <=> p_embedding)) AS vector_score,
            COALESCE(ts_rank_cd(c.tsv, websearch_to_tsquery('simple', p_query)), 0.0) AS keyword_score
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE
            (p_vendor IS NULL OR d.vendor ILIKE '%' || p_vendor || '%')
            AND (p_date_from IS NULL OR d.date >= p_date_from)
            AND (p_date_to IS NULL OR d.date <= p_date_to)
            AND (p_min_amount IS NULL OR d.total_amount >= p_min_amount)
            AND (p_max_amount IS NULL OR d.total_amount <= p_max_amount)
            AND c.embedding_vector IS NOT NULL
    )
    SELECT
        chunk_id,
        document_id,
        bill_id,
        vendor,
        chunk_type,
        content,
        summary,
        vector_score,
        keyword_score,
        (0.7 * vector_score + 0.3 * keyword_score) AS combined_score
    FROM ranked
    WHERE vector_score >= 0.15 OR keyword_score > 0
    ORDER BY combined_score DESC
    LIMIT p_top_k;
$$;

