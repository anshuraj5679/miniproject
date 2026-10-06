from __future__ import annotations

import argparse
import time
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.notifications import NotificationService


def run_once(limit: int | None = None) -> dict[str, int | str]:
    service = NotificationService()
    with SessionLocal() as db:
        return service.process_due_jobs(db, limit=limit)


def main() -> None:
    parser = argparse.ArgumentParser(description="SafeBill notification worker")
    parser.add_argument("--once", action="store_true", help="Process due jobs once and exit")
    parser.add_argument("--limit", type=int, default=None, help="Max jobs per batch")
    args = parser.parse_args()

    settings = get_settings()
    poll_seconds = max(5, int(settings.notification_worker_poll_seconds))

    if args.once:
        result = run_once(limit=args.limit)
        print(result)
        return

    while True:
        result = run_once(limit=args.limit)
        print(result)
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
