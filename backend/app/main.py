from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.notifications import NotificationService

settings = get_settings()
logger = logging.getLogger(__name__)


def _parse_origins(raw: str) -> list[str]:
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["http://localhost:3000"]


allowed_origins = _parse_origins(settings.cors_allowed_origins)
allow_credentials = settings.cors_allow_credentials and "*" not in allowed_origins

def _should_start_in_app_notification_worker() -> bool:
    # Render deployment commonly runs only the web process; start a lightweight
    # worker loop in-process when outbound notification channels are enabled.
    if os.getenv("PYTEST_CURRENT_TEST"):
        return False
    if os.getenv("DISABLE_IN_APP_NOTIFICATION_WORKER", "").strip().lower() in {"1", "true", "yes"}:
        return False

    active_channels = (
        settings.email_notifications_enabled
        or settings.sms_notifications_enabled
        or settings.push_notifications_enabled
        or settings.whatsapp_notifications_enabled
    )
    return bool(active_channels)


@asynccontextmanager
async def _lifespan(app: FastAPI):  # pragma: no cover - background loop
    _ = app
    stop: threading.Event | None = None

    if _should_start_in_app_notification_worker():
        poll_seconds = max(5, int(settings.notification_worker_poll_seconds))
        stop = threading.Event()
        service = NotificationService()

        def _loop() -> None:
            while not stop.is_set():
                try:
                    with SessionLocal() as db:
                        result = service.process_due_jobs(db)
                    logger.info(
                        "notification_worker processed=%s sent=%s failed=%s deadLettered=%s",
                        result.get("processed"),
                        result.get("sent"),
                        result.get("failed"),
                        result.get("deadLettered"),
                    )
                except Exception:
                    logger.exception("notification_worker tick failed")
                stop.wait(poll_seconds)

        thread = threading.Thread(target=_loop, name="notification-worker", daemon=True)
        thread.start()
        logger.info("notification_worker started poll_seconds=%s", poll_seconds)
    else:
        logger.info("notification_worker disabled (no outbound channels enabled)")

    try:
        yield
    finally:
        if stop is not None:
            stop.set()


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
