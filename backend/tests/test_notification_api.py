from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app


class _FakeDB:
    pass


def _override_db():
    yield _FakeDB()


def test_notification_endpoints_round_trip(monkeypatch) -> None:
    notification_id = uuid4()
    now_iso = "2026-01-01T00:00:00+00:00"

    monkeypatch.setattr(
        "app.api.routes._notification_service",
        SimpleNamespace(
            list_in_app_notifications=lambda *args, **kwargs: [
                {
                    "notificationId": str(notification_id),
                    "docId": str(uuid4()),
                    "userId": "u-1",
                    "channel": "in_app",
                    "eventType": "BILL_SCANNED",
                    "type": "consumer_bill_scanned",
                    "title": "Bill scanned",
                    "message": "Your bill was scanned.",
                    "triggerAt": now_iso,
                    "readAt": None,
                    "status": "unread",
                }
            ],
            mark_in_app_notification_read=lambda *args, **kwargs: True,
            delete_in_app_notification=lambda *args, **kwargs: True,
            get_preference=lambda *args, **kwargs: SimpleNamespace(
                user_id="u-1",
                email="user@example.com",
                full_name="User",
                locale="en",
                timezone="UTC",
                in_app_enabled=True,
                email_enabled=True,
                sms_enabled=False,
                sms_number=None,
                push_enabled=True,
                whatsapp_enabled=False,
                whatsapp_number=None,
                alert_days=[30, 7, 1],
                claim_alert_days=[14, 3],
                updated_at=None,
            ),
            update_preference=lambda *args, **kwargs: SimpleNamespace(
                user_id="u-1",
                email="user@example.com",
                full_name="User",
                locale="en",
                timezone="UTC",
                in_app_enabled=True,
                email_enabled=True,
                sms_enabled=True,
                sms_number="+919999999999",
                push_enabled=True,
                whatsapp_enabled=False,
                whatsapp_number=None,
                alert_days=[30, 7, 1],
                claim_alert_days=[14, 3],
                updated_at=None,
            ),
            serialize_preference=lambda pref: {
                "userId": pref.user_id,
                "email": pref.email,
                "fullName": pref.full_name,
                "locale": pref.locale,
                "timezone": pref.timezone,
                "inAppEnabled": pref.in_app_enabled,
                "emailEnabled": pref.email_enabled,
                "smsEnabled": pref.sms_enabled,
                "smsNumber": pref.sms_number,
                "pushEnabled": pref.push_enabled,
                "whatsappEnabled": pref.whatsapp_enabled,
                "whatsappNumber": pref.whatsapp_number,
                "alertDays": pref.alert_days,
                "claimAlertDays": pref.claim_alert_days,
                "updatedAt": None,
            },
            process_due_jobs=lambda *args, **kwargs: {
                "processed": 2,
                "sent": 1,
                "failed": 1,
                "deadLettered": 0,
            },
            get_delivery_analytics=lambda *args, **kwargs: {
                "windowDays": 30,
                "totalAttempts": 10,
                "successfulDeliveries": 8,
                "failedDeliveries": 2,
                "deadLettered": 0,
                "successRate": 0.8,
                "openRate": 0.5,
                "clickRate": 0.0,
            },
        ),
    )

    app.dependency_overrides[get_db] = _override_db
    with TestClient(app) as client:
        list_response = client.get(
            "/api/v1/notifications",
            params={"user_id": "u-1", "include_read": True, "offset": 0},
            headers={"Authorization": "Bearer safebill-viewer-token"},
        )
        assert list_response.status_code == 200
        assert list_response.json()["notifications"][0]["type"] == "consumer_bill_scanned"

        read_response = client.post(
            f"/api/v1/notifications/{notification_id}/read",
            params={"user_id": "u-1"},
            headers={"Authorization": "Bearer safebill-viewer-token"},
        )
        assert read_response.status_code == 200

        delete_response = client.delete(
            f"/api/v1/notifications/{notification_id}",
            params={"user_id": "u-1"},
            headers={"Authorization": "Bearer safebill-viewer-token"},
        )
        assert delete_response.status_code == 200

        pref_response = client.get(
            "/api/v1/notifications/preferences",
            params={"user_id": "u-1"},
            headers={"Authorization": "Bearer safebill-viewer-token"},
        )
        assert pref_response.status_code == 200
        assert pref_response.json()["email"] == "user@example.com"

        update_response = client.put(
            "/api/v1/notifications/preferences",
            params={"user_id": "u-1"},
            json={"sms_enabled": True, "sms_number": "+919999999999"},
            headers={"Authorization": "Bearer safebill-viewer-token"},
        )
        assert update_response.status_code == 200
        assert update_response.json()["smsEnabled"] is True

        process_response = client.post(
            "/api/v1/notifications/process-due",
            headers={"Authorization": "Bearer safebill-analyst-token"},
        )
        assert process_response.status_code == 200
        assert process_response.json()["processed"] == 2

        analytics_response = client.get(
            "/api/v1/notifications/analytics",
            params={"user_id": "u-1"},
            headers={"Authorization": "Bearer safebill-viewer-token"},
        )
        assert analytics_response.status_code == 200
        assert analytics_response.json()["successRate"] == 0.8

    app.dependency_overrides.clear()
