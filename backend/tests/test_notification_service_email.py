from __future__ import annotations

from typing import Any

import pytest

from app.core.config import get_settings
from app.services.notifications import NotificationDeliveryError, NotificationService


class _FakeResponse:
    def __init__(
        self,
        *,
        status_code: int,
        text: str = "",
        json_payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.text = text
        self._json_payload = json_payload or {}
        self.headers = headers or {}

    def json(self) -> dict[str, Any]:
        return self._json_payload


def _configure_service(monkeypatch: pytest.MonkeyPatch, **overrides: Any) -> NotificationService:
    settings = get_settings()
    baseline = {
        "email_from": "alerts@example.com",
        "email_from_name": "SafeBill",
        "resend_api_key": "",
        "resend_api_base_url": "https://api.resend.com",
        "email_webhook_url": "",
        "email_webhook_api_key": "",
        "email_webhook_min_interval_seconds": 0.0,
        "smtp_host": "",
    }
    merged = {**baseline, **overrides}
    for key, value in merged.items():
        monkeypatch.setattr(settings, key, value)
    return NotificationService()


def test_send_email_rejects_invalid_email_from(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _configure_service(
        monkeypatch,
        email_from="SafeBill",
        email_from_name="",
    )

    with pytest.raises(NotificationDeliveryError) as exc:
        service._send_email(
            recipient_email="user@example.com",
            subject="Subject",
            body="Body",
        )

    err = exc.value
    assert "Invalid EMAIL_FROM" in str(err)
    assert err.permanent is True


def test_send_email_uses_parsed_name_from_email_from(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_payload: dict[str, Any] = {}

    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            _ = args, kwargs

        def __enter__(self) -> "_FakeClient":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
            _ = exc_type, exc, tb
            return None

        def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> _FakeResponse:
            captured_payload["url"] = url
            captured_payload["headers"] = headers
            captured_payload["json"] = json
            return _FakeResponse(status_code=200, json_payload={"id": "msg_123"})

    monkeypatch.setattr("app.services.notifications.httpx.Client", _FakeClient)
    service = _configure_service(
        monkeypatch,
        email_from="Alert Team <alerts@example.com>",
        email_from_name="",
        resend_api_key="",
        email_webhook_url="https://email.example.com/emails",
        email_webhook_api_key="test_key",
    )

    result = service._send_email(
        recipient_email="user@example.com",
        subject="Subject",
        body="Body",
    )

    assert captured_payload["json"]["from"] == "Alert Team <alerts@example.com>"
    assert result["provider"] == "email_webhook"
    assert result["message_id"] == "msg_123"


def test_send_email_surfaces_retry_after_on_429(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            _ = args, kwargs

        def __enter__(self) -> "_FakeClient":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
            _ = exc_type, exc, tb
            return None

        def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> _FakeResponse:
            _ = url, headers, json
            return _FakeResponse(
                status_code=429,
                text='{"statusCode":429,"name":"rate_limit_exceeded"}',
                headers={"Retry-After": "7"},
            )

    monkeypatch.setattr("app.services.notifications.httpx.Client", _FakeClient)
    service = _configure_service(
        monkeypatch,
        email_from="alerts@example.com",
        resend_api_key="",
        email_webhook_url="https://email.example.com/emails",
    )

    with pytest.raises(NotificationDeliveryError) as exc:
        service._send_email(
            recipient_email="user@example.com",
            subject="Subject",
            body="Body",
        )

    err = exc.value
    assert err.status_code == 429
    assert err.retry_after_seconds == 7
    assert err.permanent is False


def test_send_email_uses_resend_when_api_key_is_set(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_payload: dict[str, Any] = {}

    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            _ = args, kwargs

        def __enter__(self) -> "_FakeClient":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
            _ = exc_type, exc, tb
            return None

        def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> _FakeResponse:
            captured_payload["url"] = url
            captured_payload["headers"] = headers
            captured_payload["json"] = json
            return _FakeResponse(status_code=200, json_payload={"id": "res_123"})

    monkeypatch.setattr("app.services.notifications.httpx.Client", _FakeClient)
    service = _configure_service(
        monkeypatch,
        email_from="SafeBill <onboarding@resend.dev>",
        resend_api_key="resend_test_key",
        resend_api_base_url="https://api.resend.com",
        email_webhook_url="https://email.example.com/emails",
    )

    result = service._send_email(
        recipient_email="user@example.com",
        subject="Subject",
        body="Body",
    )

    assert captured_payload["url"] == "https://api.resend.com/emails"
    assert captured_payload["headers"]["Authorization"] == "Bearer resend_test_key"
    assert captured_payload["json"]["from"] == "SafeBill <onboarding@resend.dev>"
    assert result["provider"] == "resend"
    assert result["message_id"] == "res_123"


def test_send_email_marks_resend_422_as_permanent(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            _ = args, kwargs

        def __enter__(self) -> "_FakeClient":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
            _ = exc_type, exc, tb
            return None

        def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> _FakeResponse:
            _ = url, headers, json
            return _FakeResponse(
                status_code=422,
                text='{"statusCode":422,"name":"validation_error"}',
            )

    monkeypatch.setattr("app.services.notifications.httpx.Client", _FakeClient)
    service = _configure_service(
        monkeypatch,
        email_from="onboarding@resend.dev",
        resend_api_key="resend_test_key",
    )

    with pytest.raises(NotificationDeliveryError) as exc:
        service._send_email(
            recipient_email="user@example.com",
            subject="Subject",
            body="Body",
        )

    err = exc.value
    assert err.status_code == 422
    assert err.permanent is True
