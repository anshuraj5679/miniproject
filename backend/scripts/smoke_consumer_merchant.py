from __future__ import annotations

import os
import time
from typing import Any

import httpx


def _assert_ok(name: str, response: httpx.Response) -> dict[str, Any]:
    if response.status_code != 200:
        raise RuntimeError(f"{name} failed: {response.status_code} {response.text[:300]}")
    try:
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f"{name} returned non-JSON body") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"{name} returned unexpected payload type")
    return payload


def main() -> int:
    base_url = os.getenv("SMOKE_BASE_URL", "http://127.0.0.1:8000")
    api_token = os.getenv("BACKEND_API_TOKEN", "safebill-analyst-token")
    merchant_user_id = os.getenv("SMOKE_MERCHANT_USER_ID", "merchant-001")
    consumer_user_id = os.getenv("SMOKE_CONSUMER_USER_ID", "consumer-001")

    headers = {"Authorization": f"Bearer {api_token}"}
    bill_id = f"MB-ROLE-SMOKE-{int(time.time())}"

    with httpx.Client(timeout=45.0) as client:
        health = client.get(f"{base_url}/api/v1/health", headers=headers)
        _assert_ok("HEALTH", health)

        manual_payload = {
            "merchant_user_id": merchant_user_id,
            "merchant_name": "SafeBill Store",
            "consumer_user_id": consumer_user_id,
            "consumer_name": "John Doe",
            "consumer_email": "john@example.com",
            "product_name": "Role Smoke Product",
            "category": "Electronics",
            "bill_id": bill_id,
            "vendor": "SafeBill Store",
            "purchase_date": "2026-03-05",
            "total_amount": 1999.0,
            "warranty_months": 12,
            "serial_number": "ROLE-SMOKE-001",
            "notes": "consumer-merchant smoke",
        }
        manual = client.post(f"{base_url}/api/v1/merchant/manual-bill", headers=headers, json=manual_payload)
        manual_payload_resp = _assert_ok("MANUAL_BILL", manual)
        document = manual_payload_resp.get("document") or {}
        doc_id = str(document.get("docId") or "").strip()
        if not doc_id:
            raise RuntimeError("MANUAL_BILL missing document.docId")

        docs = client.get(
            f"{base_url}/api/v1/documents",
            headers=headers,
            params={"user_id": consumer_user_id, "limit": 50},
        )
        docs_payload = _assert_ok("CONSUMER_DOCUMENTS", docs)
        docs_list = docs_payload.get("documents") or []
        if not isinstance(docs_list, list) or not any(str(item.get("docId")) == doc_id for item in docs_list if isinstance(item, dict)):
            raise RuntimeError("CONSUMER_DOCUMENTS missing newly created document")

        detail = client.get(
            f"{base_url}/api/v1/documents/{doc_id}",
            headers=headers,
            params={"user_id": consumer_user_id},
        )
        detail_payload = _assert_ok("CONSUMER_DOCUMENT_DETAIL", detail)
        if str(detail_payload.get("docId") or "") != doc_id:
            raise RuntimeError("CONSUMER_DOCUMENT_DETAIL docId mismatch")

        activity = client.get(
            f"{base_url}/api/v1/merchant/activity",
            headers=headers,
            params={"merchant_user_id": merchant_user_id, "limit": 50},
        )
        activity_payload = _assert_ok("MERCHANT_ACTIVITY", activity)
        activity_list = activity_payload.get("activities") or []
        if not isinstance(activity_list, list) or not any(str(item.get("documentId")) == doc_id for item in activity_list if isinstance(item, dict)):
            raise RuntimeError("MERCHANT_ACTIVITY missing newly created document")

        reminders = client.get(
            f"{base_url}/api/v1/reminders",
            headers=headers,
            params={"user_id": consumer_user_id, "days_ahead": 120, "limit": 200},
        )
        reminders_payload = _assert_ok("CONSUMER_REMINDERS", reminders)
        reminders_list = reminders_payload.get("reminders") or []
        if not isinstance(reminders_list, list):
            raise RuntimeError("CONSUMER_REMINDERS payload malformed")

    print("SMOKE_OK")
    print(f"DOC_ID={doc_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

