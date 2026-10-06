from __future__ import annotations

import io
import json
from types import SimpleNamespace

from PIL import Image

from app.api import routes
from app.services import claude_client


def _png_bytes(fmt: str = "PNG") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(buffer, format=fmt)
    return buffer.getvalue()


class _FakeMessages:
    def __init__(self, response: SimpleNamespace) -> None:
        self.response = response
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def _fake_client(monkeypatch, *, stop_reason: str = "end_turn", payload: dict | None = None) -> _FakeMessages:
    response = SimpleNamespace(
        stop_reason=stop_reason,
        stop_details=SimpleNamespace(category="cyber") if stop_reason == "refusal" else None,
        content=[SimpleNamespace(type="text", text=json.dumps(payload or {}))],
        model="claude-opus-5-5",
        usage=SimpleNamespace(input_tokens=1200, output_tokens=300),
        _request_id="req_test",
    )
    messages = _FakeMessages(response)
    fake = SimpleNamespace(beta=SimpleNamespace(messages=messages))
    monkeypatch.setattr(claude_client, "claude_extraction_enabled", lambda: True)
    monkeypatch.setattr(claude_client, "_client", lambda: fake)
    return messages


def test_claude_extraction_is_disabled_without_api_key() -> None:
    assert claude_client.claude_extraction_enabled() is False
    assert claude_client.claude_extract_image_metadata(_png_bytes(), "bill.png") == {}


def test_claude_extraction_returns_fields_and_drops_nulls(monkeypatch) -> None:
    messages = _fake_client(
        monkeypatch,
        payload={"bill_id": "9222000002664974", "vendor": "Apple India", "total_amount": 32900.0, "brand": None},
    )

    result = claude_client.claude_extract_image_metadata(_png_bytes(), "bill.png")

    assert result == {"bill_id": "9222000002664974", "vendor": "Apple India", "total_amount": 32900.0}
    request = messages.calls[0]
    assert request["output_config"]["format"]["type"] == "json_schema"
    assert request["fallbacks"] == "default"
    image_block = request["messages"][0]["content"][0]
    assert image_block["source"]["media_type"] == "image/png"


def test_claude_extraction_returns_nothing_on_refusal(monkeypatch) -> None:
    _fake_client(monkeypatch, stop_reason="refusal", payload={"bill_id": "X1"})
    assert claude_client.claude_extract_image_metadata(_png_bytes(), "bill.png") == {}


def test_unsupported_image_format_is_converted_to_png() -> None:
    bmp = _png_bytes("BMP")
    payload, media_type = claude_client._prepare_image(bmp, claude_client._media_type_for(bmp, "scan.bmp"))
    assert media_type == "image/png"
    assert payload.startswith(b"\x89PNG")


def _route(monkeypatch, *, claude: dict, gemini: dict) -> dict:
    monkeypatch.setattr(routes, "claude_extraction_enabled", lambda: True)
    monkeypatch.setattr(routes, "claude_extract_image_metadata", lambda image_bytes, filename: dict(claude))
    monkeypatch.setattr(routes, "gemini_extract_image_metadata", lambda image_bytes, filename: dict(gemini))
    return routes._run_image_extraction_router(
        image_bytes=_png_bytes(),
        filename="bill.png",
        supplied_ocr_text="",
        ocr_mode_override="auto",
        bill_id=None,
        vendor=None,
        document_date=None,
        total_amount=None,
    )


def test_router_runs_claude_and_openrouter_and_agreement_raises_confidence(monkeypatch) -> None:
    fields = {"bill_id": "INV-2041", "vendor": "Reliance Digital", "date": "2025-06-10", "total_amount": 1649.0}
    agreed = _route(monkeypatch, claude=fields, gemini=fields)
    disputed = _route(monkeypatch, claude=fields, gemini={**fields, "total_amount": 1749.0})

    assert {"claude_vision", "gemini_vision"} <= set(agreed["engines_used"])
    assert agreed["metadata"]["bill_id"] == "INV-2041"
    assert agreed["field_confidences"]["total_amount"] > disputed["field_confidences"]["total_amount"]
    # Claude carries the higher engine weight, so its reading wins a 1-1 disagreement.
    assert disputed["metadata"]["total_amount"] == 1649.0


def test_router_majority_of_three_engines_beats_single_dissent(monkeypatch) -> None:
    fields = {"bill_id": "INV-2041", "vendor": "Reliance Digital", "date": "2025-06-10", "total_amount": 1649.0}
    monkeypatch.setattr(routes, "google_gemini_enabled", lambda: True)
    monkeypatch.setattr(routes, "google_gemini_extract_image_metadata", lambda image_bytes, filename: dict(fields))

    # Claude misreads the total; Gemini (direct) and the OpenRouter model agree.
    result = _route(monkeypatch, claude={**fields, "total_amount": 1749.0}, gemini=fields)

    assert {"claude_vision", "gemini_vision", "google_gemini_vision"} <= set(result["engines_used"])
    assert result["metadata"]["total_amount"] == 1649.0
