from __future__ import annotations

import os
import subprocess
import sys
import time
from typing import Any

import httpx


def _wait_for_health(base_url: str, timeout_seconds: int = 45) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            response = httpx.get(f"{base_url}/api/v1/health", timeout=5.0)
            if response.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(1.0)
    return False


def _print_result(name: str, response: httpx.Response) -> None:
    body = (response.text or "").replace("\n", " ")
    preview = body[:500]
    print(f"{name}: {response.status_code}")
    print(f"{name}_BODY: {preview}")


def main() -> int:
    base_url = os.getenv("SMOKE_BASE_URL", "http://127.0.0.1:8002")
    token = os.getenv("BACKEND_API_TOKEN", "safebill-analyst-token")
    headers = {"Authorization": f"Bearer {token}"}

    env = os.environ.copy()
    env["AWS_ONLY_MODE"] = "false"
    env["DISABLE_IN_APP_NOTIFICATION_WORKER"] = "true"
    env["PYTHONDONTWRITEBYTECODE"] = "1"

    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8002"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        if not _wait_for_health(base_url):
            print("health check failed")
            return 1

        manual_payload: dict[str, Any] = {
            "merchant_user_id": "merchant-001",
            "merchant_name": "SafeBill Store",
            "consumer_user_id": "consumer-001",
            "consumer_name": "John Doe",
            "consumer_email": "john@example.com",
            "product_name": "Mixer Grinder",
            "category": "Appliances",
            "bill_id": f"MB-SMOKE-{int(time.time())}",
            "vendor": "SafeBill Store",
            "purchase_date": "2026-03-05",
            "total_amount": 4999.0,
            "warranty_months": 12,
            "serial_number": "SG-001",
            "notes": "fallback smoke test",
        }

        with httpx.Client(timeout=45.0) as client:
            health = client.get(f"{base_url}/api/v1/health", headers=headers)
            manual = client.post(f"{base_url}/api/v1/merchant/manual-bill", headers=headers, json=manual_payload)
            search = client.post(
                f"{base_url}/api/v1/search",
                headers=headers,
                json={"query": "Mixer Grinder warranty", "filters": {}, "top_k": 5},
            )
            ask = client.post(
                f"{base_url}/api/v1/ask",
                headers=headers,
                json={"query": "Mixer Grinder warranty end date", "filters": {}, "top_k": 5},
            )

        _print_result("HEALTH", health)
        _print_result("MANUAL_BILL", manual)
        _print_result("SEARCH", search)
        _print_result("ASK", ask)

        if health.status_code != 200 or manual.status_code != 200 or search.status_code != 200 or ask.status_code != 200:
            return 1
        return 0
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except Exception:
            server.kill()


if __name__ == "__main__":
    raise SystemExit(main())
