from __future__ import annotations

from app.services.rate_limiter import InMemoryRateLimiter


def test_rate_limiter_blocks_after_limit() -> None:
    limiter = InMemoryRateLimiter()
    allowed_1, _ = limiter.allow(bucket="ask", key="u-1", limit=2, window_seconds=60)
    allowed_2, _ = limiter.allow(bucket="ask", key="u-1", limit=2, window_seconds=60)
    allowed_3, retry_after = limiter.allow(bucket="ask", key="u-1", limit=2, window_seconds=60)

    assert allowed_1 is True
    assert allowed_2 is True
    assert allowed_3 is False
    assert retry_after >= 1
