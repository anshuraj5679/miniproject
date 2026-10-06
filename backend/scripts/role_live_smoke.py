from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import boto3
import httpx


def _load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


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


def _assert_status(name: str, response: httpx.Response, expected: int) -> None:
    if response.status_code != expected:
        body = (response.text or "")[:400]
        raise RuntimeError(f"{name}: expected {expected}, got {response.status_code}. body={body}")
    print(f"{name}: {response.status_code}")


def _create_temp_client_and_users(backend_env: dict[str, str]) -> dict[str, str]:
    region = backend_env.get("AWS_REGION", "ap-southeast-2")
    client = boto3.client(
        "cognito-idp",
        region_name=region,
        aws_access_key_id=backend_env.get("AWS_ACCESS_KEY_ID") or None,
        aws_secret_access_key=backend_env.get("AWS_SECRET_ACCESS_KEY") or None,
        aws_session_token=backend_env.get("AWS_SESSION_TOKEN") or None,
    )

    user_pool_id = str(backend_env.get("COGNITO_USER_POOL_ID") or "").strip()
    app_client_id = str(backend_env.get("COGNITO_APP_CLIENT_ID") or "").strip()
    if not user_pool_id or not app_client_id:
        raise RuntimeError("Missing Cognito pool/client configuration in backend .env")

    ts = int(time.time())
    smoke_client_name = f"safebill-role-smoke-{ts}"
    created = client.create_user_pool_client(
        UserPoolId=user_pool_id,
        ClientName=smoke_client_name,
        GenerateSecret=False,
        ExplicitAuthFlows=["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"],
        PreventUserExistenceErrors="ENABLED",
        AllowedOAuthFlowsUserPoolClient=False,
    )
    smoke_client_id = created["UserPoolClient"]["ClientId"]

    for group in ("consumer", "merchant"):
        try:
            client.create_group(UserPoolId=user_pool_id, GroupName=group)
        except client.exceptions.GroupExistsException:
            pass

    users = [
        {"role": "consumer", "email": f"role{ts}.consumer@safebill.local", "name": "Role Smoke Consumer"},
        {"role": "merchant", "email": f"role{ts}.merchant@safebill.local", "name": "Role Smoke Merchant"},
    ]
    password = "Smoke@12345a"

    result: dict[str, str] = {"smoke_client_id": smoke_client_id, "user_pool_id": user_pool_id}
    for user in users:
        email = user["email"]
        role = user["role"]
        try:
            client.admin_create_user(
                UserPoolId=user_pool_id,
                Username=email,
                MessageAction="SUPPRESS",
                UserAttributes=[
                    {"Name": "email", "Value": email},
                    {"Name": "email_verified", "Value": "true"},
                    {"Name": "name", "Value": user["name"]},
                ],
            )
        except client.exceptions.UsernameExistsException:
            pass

        client.admin_set_user_password(
            UserPoolId=user_pool_id,
            Username=email,
            Password=password,
            Permanent=True,
        )
        try:
            client.admin_add_user_to_group(UserPoolId=user_pool_id, Username=email, GroupName=role)
        except Exception:
            pass

        auth = client.initiate_auth(
            AuthFlow="USER_PASSWORD_AUTH",
            ClientId=smoke_client_id,
            AuthParameters={"USERNAME": email, "PASSWORD": password},
        )
        access_token = str(auth["AuthenticationResult"]["AccessToken"])

        user_info = client.admin_get_user(UserPoolId=user_pool_id, Username=email)
        sub = ""
        for attr in user_info.get("UserAttributes", []):
            if attr.get("Name") == "sub":
                sub = str(attr.get("Value") or "")
                break
        if not sub:
            raise RuntimeError(f"Missing sub for user {email}")

        result[f"{role}_token"] = access_token
        result[f"{role}_sub"] = sub

    return result


def main() -> int:
    backend_root = Path(__file__).resolve().parents[1]
    backend_env = _load_env(backend_root / ".env")
    creds = _create_temp_client_and_users(backend_env)

    base_url = os.getenv("SMOKE_BASE_URL", "http://127.0.0.1:8003")
    env = os.environ.copy()
    env["AWS_ONLY_MODE"] = "false"
    env["DISABLE_IN_APP_NOTIFICATION_WORKER"] = "true"
    env["COGNITO_JWT_AUDIENCE"] = creds["smoke_client_id"]

    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8003"],
        cwd=str(backend_root),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        if not _wait_for_health(base_url):
            raise RuntimeError("Health check failed for role smoke backend")

        consumer_headers = {"Authorization": f"Bearer {creds['consumer_token']}"}
        merchant_headers = {"Authorization": f"Bearer {creds['merchant_token']}"}

        with httpx.Client(timeout=45.0) as client:
            # consumer scope checks
            consumer_docs = client.get(
                f"{base_url}/api/v1/documents",
                headers=consumer_headers,
                params={"user_id": creds["consumer_sub"], "limit": 10},
            )
            _assert_status("CONSUMER_DOCUMENTS", consumer_docs, 200)

            consumer_illegal_merchant = client.get(
                f"{base_url}/api/v1/merchant/activity",
                headers=consumer_headers,
                params={"merchant_user_id": creds["merchant_sub"], "limit": 10},
            )
            _assert_status("CONSUMER_MERCHANT_ACTIVITY_FORBIDDEN", consumer_illegal_merchant, 403)

            # merchant scope checks
            merchant_activity = client.get(
                f"{base_url}/api/v1/merchant/activity",
                headers=merchant_headers,
                params={"merchant_user_id": creds["merchant_sub"], "limit": 10},
            )
            _assert_status("MERCHANT_ACTIVITY", merchant_activity, 200)

            bad_manual_payload: dict[str, Any] = {
                "merchant_user_id": "wrong-merchant-id",
                "merchant_name": "Wrong",
                "consumer_user_id": creds["consumer_sub"],
                "consumer_name": "Role Smoke Consumer",
                "consumer_email": "role-smoke@safebill.local",
                "product_name": "Role Smoke Product",
                "category": "Electronics",
                "bill_id": f"ROLE-SMOKE-BAD-{int(time.time())}",
                "vendor": "Role Smoke Store",
                "purchase_date": "2026-03-05",
                "total_amount": 1234.0,
                "warranty_months": 12,
            }
            merchant_bad_manual = client.post(
                f"{base_url}/api/v1/merchant/manual-bill",
                headers=merchant_headers,
                json=bad_manual_payload,
            )
            _assert_status("MERCHANT_SCOPE_MISMATCH_FORBIDDEN", merchant_bad_manual, 403)

            good_manual_payload = dict(bad_manual_payload)
            good_manual_payload["merchant_user_id"] = creds["merchant_sub"]
            good_manual_payload["bill_id"] = f"ROLE-SMOKE-GOOD-{int(time.time())}"
            merchant_good_manual = client.post(
                f"{base_url}/api/v1/merchant/manual-bill",
                headers=merchant_headers,
                json=good_manual_payload,
            )
            _assert_status("MERCHANT_MANUAL_BILL", merchant_good_manual, 200)

            consumer_manual = client.post(
                f"{base_url}/api/v1/merchant/manual-bill",
                headers=consumer_headers,
                json=good_manual_payload,
            )
            _assert_status("CONSUMER_MANUAL_BILL_FORBIDDEN", consumer_manual, 403)

        print("ROLE_SMOKE_OK")
        return 0
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except Exception:
            server.kill()


if __name__ == "__main__":
    raise SystemExit(main())

