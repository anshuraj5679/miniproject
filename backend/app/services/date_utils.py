from __future__ import annotations

from datetime import date, timedelta

try:
    from dateutil.relativedelta import relativedelta
except Exception:  # pragma: no cover - optional runtime dependency
    relativedelta = None  # type: ignore[assignment]


def add_months(start: date, months: int) -> date:
    """Add calendar months to a date (falls back to 30-day months if dateutil is unavailable)."""

    try:
        months_int = int(months)
    except (TypeError, ValueError):
        months_int = 0

    if months_int <= 0:
        return start

    if relativedelta is None:
        return start + timedelta(days=months_int * 30)

    return start + relativedelta(months=months_int)

