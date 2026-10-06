from __future__ import annotations

from types import SimpleNamespace

from app.parsers import pdf_parser


def test_ocr_page_text_returns_empty_when_ocr_engine_fails(monkeypatch) -> None:
    def _raise(_image):
        raise RuntimeError("tesseract unavailable")

    fake_pytesseract = SimpleNamespace(
        pytesseract=SimpleNamespace(tesseract_cmd=""),
        image_to_string=_raise,
    )
    monkeypatch.setattr(pdf_parser, "pytesseract", fake_pytesseract)
    monkeypatch.setattr(pdf_parser, "get_settings", lambda: SimpleNamespace(tesseract_cmd=""))

    class _FakePage:
        @staticmethod
        def to_image(resolution: int):
            _ = resolution
            return SimpleNamespace(original=object())

    assert pdf_parser._ocr_page_text(_FakePage()) == ""
