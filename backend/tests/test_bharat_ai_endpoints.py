from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.dependencies import get_services
from app.main import app
from app.services.bharat_ai import BharatAIService


class _FakeBharatAI:
    @staticmethod
    def enrich_invoice_for_bharat(*, ocr_text: str, metadata: dict, target_language_code: str, include_speech: bool):
        _ = (ocr_text, metadata, include_speech)
        return {
            "source_language_code": "en",
            "target_language_code": target_language_code,
            "normalized_text": "Invoice Number: INV-1",
            "consumer_summary": "Invoice processed",
            "localized_summary": "Invoice processed",
            "gst_findings": ["GSTIN detected"],
            "fraud_signals": [],
            "claim_steps": ["Keep invoice safe"],
            "merchant_notes": ["No action needed"],
            "payment_references": ["UTR12345678"],
            "model_used": "global.amazon.nova-2-lite-v1:0",
            "speech_audio_base64": None,
            "speech_content_type": None,
        }

    @staticmethod
    def translate_text(text: str, *, target_language_code: str, source_language_code: str) -> str:
        _ = source_language_code
        return f"[{target_language_code}] {text}"

    @staticmethod
    def translate_many(texts: list[str], *, target_language_code: str, source_language_code: str) -> list[str]:
        _ = source_language_code
        return [f"[{target_language_code}] {text}" for text in texts]

    @staticmethod
    def answer_invoice_question(*, question: str, ocr_text: str, metadata: dict, target_language_code: str):
        _ = (ocr_text, metadata)
        return {
            "source_language_code": "en",
            "target_language_code": target_language_code,
            "normalized_question": question,
            "localized_question": f"[{target_language_code}] {question}",
            "answer": f"[{target_language_code}] Grounded answer",
            "support_points": [f"[{target_language_code}] Point 1"],
            "missing_information": [f"[{target_language_code}] Missing 1"],
            "confidence_note": f"[{target_language_code}] Answer limited to invoice content",
            "model_used": "global.amazon.nova-2-lite-v1:0",
        }

    @staticmethod
    def detect_language(_text: str) -> str:
        return "en"


class _FakeServices:
    def __init__(self) -> None:
        self.bharat_ai = _FakeBharatAI()


def test_bharat_ai_enrich_endpoint_returns_structured_payload() -> None:
    app.dependency_overrides[get_services] = lambda: _FakeServices()
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/ai/bharat/enrich",
                json={
                    "ocr_text": "Invoice Number: INV-1",
                    "metadata": {"bill_id": "INV-1"},
                    "target_language_code": "hi",
                    "include_speech": False,
                },
                headers={"Authorization": "Bearer safebill-viewer-token"},
            )
        assert response.status_code == 200
        payload = response.json()
        assert payload["sourceLanguageCode"] == "en"
        assert payload["targetLanguageCode"] == "hi"
        assert payload["consumerSummary"] == "Invoice processed"
        assert payload["paymentReferences"] == ["UTR12345678"]
    finally:
        app.dependency_overrides.clear()


def test_bharat_ai_translate_endpoint_works() -> None:
    app.dependency_overrides[get_services] = lambda: _FakeServices()
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/ai/bharat/translate",
                json={
                    "text": "Warranty valid",
                    "target_language_code": "hi",
                    "source_language_code": "en",
                },
                headers={"Authorization": "Bearer safebill-viewer-token"},
            )
        assert response.status_code == 200
        payload = response.json()
        assert payload["sourceLanguageCode"] == "en"
        assert payload["targetLanguageCode"] == "hi"
        assert payload["translatedText"] == "[hi] Warranty valid"
    finally:
        app.dependency_overrides.clear()


def test_bharat_ai_translate_batch_endpoint_works() -> None:
    app.dependency_overrides[get_services] = lambda: _FakeServices()
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/ai/bharat/translate-batch",
                json={
                    "texts": ["Warranty valid", "Claim ready"],
                    "target_language_code": "hi",
                    "source_language_code": "en",
                },
                headers={"Authorization": "Bearer safebill-viewer-token"},
            )
        assert response.status_code == 200
        payload = response.json()
        assert payload["sourceLanguageCode"] == "en"
        assert payload["targetLanguageCode"] == "hi"
        assert payload["translations"] == ["[hi] Warranty valid", "[hi] Claim ready"]
    finally:
        app.dependency_overrides.clear()


def test_bharat_ai_ask_endpoint_returns_grounded_answer() -> None:
    app.dependency_overrides[get_services] = lambda: _FakeServices()
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/ai/bharat/ask",
                json={
                    "question": "What does this invoice say?",
                    "ocr_text": "Invoice Number: INV-1",
                    "metadata": {"bill_id": "INV-1"},
                    "target_language_code": "hi",
                },
                headers={"Authorization": "Bearer safebill-viewer-token"},
            )
        assert response.status_code == 200
        payload = response.json()
        assert payload["answer"] == "[hi] Grounded answer"
        assert payload["supportPoints"] == ["[hi] Point 1"]
        assert payload["missingInformation"] == ["[hi] Missing 1"]
        assert payload["modelUsed"] == "global.amazon.nova-2-lite-v1:0"
    finally:
        app.dependency_overrides.clear()


def test_extract_payment_references_detects_upi_and_utr() -> None:
    text = "Paid via UPI Ref: abcd1234efgh and UTR: 9876543210"
    refs = BharatAIService.extract_payment_references(text)
    assert "ABCD1234EFGH" in refs
    assert "9876543210" in refs
