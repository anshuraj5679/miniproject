from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.core.config import get_settings
from app.services.notifications import NotificationDeliveryError, NotificationService


def _configure_service(monkeypatch: pytest.MonkeyPatch, **overrides: Any) -> NotificationService:
    settings = get_settings()
    baseline = {
        "email_from": "alerts@example.com",
        "email_from_name": "SafeBill",
        "email_provider": "ses",
        "ses_region": "ap-southeast-2",
        "ses_configuration_set": "",
        "ses_source_arn": "",
        "ses_from_arn": "",
        "ses_reply_to_addresses": "",
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


def test_send_email_uses_ses_when_provider_is_ses(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_payload: dict[str, Any] = {}

    class _FakeSESClient:
        def send_email(self, **kwargs: Any) -> dict[str, Any]:
            captured_payload["kwargs"] = kwargs
            return {"MessageId": "ses_123"}

    monkeypatch.setattr(
        "app.services.notifications.boto3",
        SimpleNamespace(client=lambda service_name, region_name=None: _FakeSESClient()),
    )
    service = _configure_service(
        monkeypatch,
        email_provider="ses",
        email_from="SafeBill <alerts@example.com>",
        ses_region="ap-southeast-2",
    )

    result = service._send_email(recipient_email="user@example.com", subject="Subject", body="Body")

    assert result["provider"] == "aws_ses"
    assert result["message_id"] == "ses_123"
    assert "kwargs" in captured_payload
    assert captured_payload["kwargs"]["FromEmailAddress"] == "SafeBill <alerts@example.com>"


def test_send_email_marks_ses_message_rejected_as_permanent(monkeypatch: pytest.MonkeyPatch) -> None:
    class _SESFailure(Exception):
        def __init__(self) -> None:
            self.response = {
                "Error": {"Code": "MessageRejected", "Message": "Address not verified"},
                "ResponseMetadata": {"HTTPStatusCode": 400},
            }
            super().__init__("MessageRejected")

    class _FakeSESClient:
        def send_email(self, **kwargs: Any) -> dict[str, Any]:
            _ = kwargs
            raise _SESFailure()

    monkeypatch.setattr(
        "app.services.notifications.boto3",
        SimpleNamespace(client=lambda service_name, region_name=None: _FakeSESClient()),
    )
    service = _configure_service(
        monkeypatch,
        email_provider="ses",
        email_from="alerts@example.com",
        ses_region="ap-southeast-2",
    )

    with pytest.raises(NotificationDeliveryError) as exc:
        service._send_email(recipient_email="user@example.com", subject="Subject", body="Body")

    err = exc.value
    assert err.status_code == 400
    assert err.permanent is True
