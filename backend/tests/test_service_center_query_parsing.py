from __future__ import annotations

from app.api import routes


def test_query_company_candidates_handles_product_is_of_pattern() -> None:
    query = "this product is of samsung company which is nearest service center in bangalore"
    candidates = routes._query_company_candidates(query)
    assert candidates
    assert candidates[0].lower() == "samsung"


def test_resolve_company_name_prefers_query_text_over_filter_vendor() -> None:
    query = "find nearest samsung service center"
    company = routes._resolve_company_name(query, hits=[], filter_vendor="XYZ Electronics")
    assert company is not None
    assert company.lower() == "samsung"


def test_query_location_hint_extracts_city_name() -> None:
    hint = routes._query_location_hint("find samsung service center in bangalore within 20 km")
    assert hint == "bangalore"


def test_query_location_hint_extracts_pincode() -> None:
    hint = routes._query_location_hint("find samsung service center near 560001 within 15 km")
    assert hint == "560001"
