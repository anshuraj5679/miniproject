"""Google Gemini called directly through the google-genai SDK.

Separate from gemini_client.py, which (despite its name) talks to OpenRouter.
Enabled when GOOGLE_GEMINI_API_KEY is set.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any

from app.core.config import get_settings
from app.services.invoice_extraction_spec import (
    EXTRACTION_SYSTEM_PROMPT,
    EXTRACTION_USER_PROMPT,
    INVOICE_SCHEMA,
)

try:
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types as genai_types
except Exception:  # pragma: no cover - optional runtime dependency
    genai = None  # type: ignore[assignment]
    genai_errors = None  # type: ignore[assignment]
    genai_types = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_IMAGE_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


@lru_cache(maxsize=1)
def _client() -> Any:
    return genai.Client(api_key=get_settings().google_gemini_api_key.strip())


def google_gemini_enabled() -> bool:
    return genai is not None and bool(get_settings().google_gemini_api_key.strip())


def _http_options(timeout_seconds: float, attempts: int = 1) -> Any:
    # google-genai takes the timeout in milliseconds. Retries cover 503 "high demand"
    # and other transient errors, which are common on the free tier.
    return genai_types.HttpOptions(
        timeout=int(timeout_seconds * 1000),
        retry_options=genai_types.HttpRetryOptions(attempts=attempts, initial_delay=2.0, max_delay=10.0),
    )


def _media_type_for(image_bytes: bytes) -> str:
    head = image_bytes[:12]
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return ""


def _models() -> list[str]:
    settings = get_settings()
    models = [settings.google_gemini_model.strip(), settings.google_gemini_fallback_model.strip()]
    return [model for index, model in enumerate(models) if model and model not in models[:index]]


def _generate(*, contents: Any, config: Any) -> Any:
    """generate_content on the main model, then the fallback model if the main one is unavailable."""
    last_error: Exception | None = None
    for model in _models():
        try:
            return _client().models.generate_content(model=model, contents=contents, config=config)
        except genai_errors.APIError as exc:
            last_error = exc
            if getattr(exc, "code", None) not in (404, 429, 500, 503, 504):
                raise
            logger.warning("Gemini model %s unavailable (code=%s); trying next model", model, getattr(exc, "code", None))
    assert last_error is not None
    raise last_error


def google_gemini_extract_image_metadata(image_bytes: bytes, filename: str) -> dict[str, Any]:
    """Extract invoice fields + full text from an image. Returns {} when unavailable or on failure."""
    if not image_bytes or not google_gemini_enabled():
        return {}

    settings = get_settings()
    media_type = _media_type_for(image_bytes)
    if media_type not in _IMAGE_MEDIA_TYPES:
        try:
            import io

            from PIL import Image

            with Image.open(io.BytesIO(image_bytes)) as image:
                buffer = io.BytesIO()
                image.convert("RGB").save(buffer, format="PNG")
            image_bytes, media_type = buffer.getvalue(), "image/png"
        except Exception:
            logger.exception("Gemini extraction: could not convert image filename=%s", filename)
            return {}

    try:
        response = _generate(
            contents=[
                genai_types.Part.from_bytes(data=image_bytes, mime_type=media_type),
                EXTRACTION_USER_PROMPT,
            ],
            config=genai_types.GenerateContentConfig(
                system_instruction=EXTRACTION_SYSTEM_PROMPT,
                temperature=0.0,
                response_mime_type="application/json",
                response_json_schema=INVOICE_SCHEMA,
                # Extraction runs in the background job queue, so it can afford retries.
                http_options=_http_options(settings.google_gemini_timeout_seconds, attempts=2),
            ),
        )
    except genai_errors.APIError as exc:
        logger.error("Gemini extraction failed code=%s message=%s", getattr(exc, "code", None), str(exc)[:300])
        return {}
    except Exception:
        logger.exception("Gemini extraction failed filename=%s", filename)
        return {}

    try:
        parsed = json.loads(response.text or "")
    except (json.JSONDecodeError, ValueError):
        logger.error("Gemini extraction returned non-JSON output filename=%s", filename)
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {key: value for key, value in parsed.items() if value is not None}


def google_gemini_generate_text(
    prompt: str,
    *,
    system: str | None = None,
    max_tokens: int = 8192,
    response_json: bool = False,
    timeout: float | None = None,
) -> str:
    """Answer a text prompt. Raises on failure so callers can fall back."""
    if not google_gemini_enabled():
        raise RuntimeError("Gemini is not configured (GOOGLE_GEMINI_API_KEY is empty)")

    settings = get_settings()
    config = genai_types.GenerateContentConfig(
        system_instruction=system,
        temperature=0.2,
        # Pro models count thinking against this limit, so leave headroom for the answer.
        max_output_tokens=max(max_tokens, 8192),
        response_mime_type="application/json" if response_json else None,
        http_options=_http_options(timeout or settings.google_gemini_timeout_seconds),
    )
    response = _generate(contents=prompt, config=config)
    text = (response.text or "").strip()
    if not text:
        raise RuntimeError("Gemini returned no text")
    return text
