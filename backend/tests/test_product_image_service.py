from __future__ import annotations

import base64
import json
import uuid
from types import SimpleNamespace

import pytest

from app.services.product_image import ProductImageService


class _FakeBody:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._payload


class _FakeBedrockClient:
    def __init__(self) -> None:
        self.prompts: list[str] = []
        self.calls = 0

    def invoke_model(self, *, body: str, **_kwargs):
        self.calls += 1
        payload = json.loads(body)
        prompt = str(payload["textToImageParams"]["text"])
        self.prompts.append(prompt)
        if self.calls == 1:
            raise Exception("This request has been blocked by our content filters")
        return {
            "body": _FakeBody(
                {"images": [base64.b64encode(b"fake-image-bytes").decode("ascii")]}
            )
        }


class _FakeObjectStore:
    enabled = True

    def __init__(self) -> None:
        self.uploads: list[tuple[str, bytes, str]] = []

    def build_object_key(self, *, filename: str, source: str) -> str:
        return f"{source}/{filename}"

    def put_bytes(self, *, key: str, payload: bytes, filename: str, content_type: str, metadata: dict[str, str]):
        self.uploads.append((key, payload, filename))
        return {
            "storage_key": key,
            "storage_bucket": "test-bucket",
            "storage_region": "us-east-1",
            "storage_content_type": content_type,
            "metadata": metadata,
        }

    def get_bytes(self, *, key: str) -> bytes | None:
        _ = key
        return None


def test_product_image_service_retries_with_safer_prompt_after_content_filter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = _FakeBedrockClient()
    fake_store = _FakeObjectStore()

    monkeypatch.setattr(
        "app.services.product_image.get_settings",
        lambda: SimpleNamespace(
            product_image_generation_enabled=True,
            bedrock_image_model="amazon.titan-image-generator-v2:0",
            aws_region="us-east-1",
            bedrock_image_region="us-east-1",
            product_image_width=768,
            product_image_height=768,
            aws_only_mode=False,
        ),
    )
    monkeypatch.setattr(
        ProductImageService,
        "_client_for_region",
        lambda self, region: fake_client,
    )

    service = ProductImageService()
    document = SimpleNamespace(
        id=uuid.uuid4(),
        bill_id="MB78190631",
        vendor="Apple India Private Limited",
        references={
            "product_name": "IPAD WIFI 128GB BLU-HIN",
            "brand": "Apple",
            "category": "Gadgets",
            "raw_text": "Tax Invoice Number: 9222000002664974\nBill To: Sample Address\nIPAD WIFI 128GB BLU-HIN",
        },
    )

    payload = service.generate_for_document(document=document, object_store=fake_store)

    assert payload["status"] == "ready"
    assert fake_client.calls == 2
    assert "Invoice hint:" in fake_client.prompts[0]
    assert "Invoice hint:" not in fake_client.prompts[1]
    assert "Seller context:" not in fake_client.prompts[1]
    assert fake_store.uploads
