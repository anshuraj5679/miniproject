"""Claude (Anthropic) vision engine for invoice / warranty-card extraction.

Returns the same field dict as gemini_client.gemini_extract_image_metadata so the
extraction router can vote between engines. Enabled when ANTHROPIC_API_KEY is set.
"""

from __future__ import annotations

import base64
import io
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
    import anthropic
except Exception:  # pragma: no cover - optional runtime dependency
    anthropic = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# Media types the Messages API accepts for images; anything else is re-encoded as PNG.
_SUPPORTED_MEDIA_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
# The API rejects images over 5 MB; stay under it after base64 overhead is ignored.
_MAX_IMAGE_BYTES = 4_500_000
# Claude's high-resolution vision tops out at 2576 px on the long edge.
_MAX_LONG_EDGE_PX = 2576




@lru_cache(maxsize=1)
def _client() -> Any:
    settings = get_settings()
    return anthropic.Anthropic(
        api_key=settings.anthropic_api_key.strip(),
        timeout=float(settings.anthropic_timeout_seconds),
        max_retries=1,
    )


def claude_extraction_enabled() -> bool:
    return anthropic is not None and bool(get_settings().anthropic_api_key.strip())


def _prepare_image(image_bytes: bytes, media_type: str) -> tuple[bytes, str]:
    """Convert to a supported format and keep under the API's size and resolution limits."""
    if media_type in _SUPPORTED_MEDIA_TYPES and len(image_bytes) <= _MAX_IMAGE_BYTES:
        return image_bytes, media_type
    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as image:
        image = image.convert("RGB")
        image.thumbnail((_MAX_LONG_EDGE_PX, _MAX_LONG_EDGE_PX))
        buffer = io.BytesIO()
        if len(image_bytes) > _MAX_IMAGE_BYTES:
            image.save(buffer, format="JPEG", quality=88)
            return buffer.getvalue(), "image/jpeg"
        image.save(buffer, format="PNG")
        return buffer.getvalue(), "image/png"


def _media_type_for(image_bytes: bytes, filename: str) -> str:
    head = image_bytes[:12]
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    lowered = filename.lower()
    if lowered.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    return "application/octet-stream"


def claude_extract_image_metadata(image_bytes: bytes, filename: str) -> dict[str, Any]:
    """Extract invoice fields + full text from an image. Returns {} when unavailable or on failure."""
    if not image_bytes or not claude_extraction_enabled():
        return {}

    settings = get_settings()
    try:
        payload, media_type = _prepare_image(image_bytes, _media_type_for(image_bytes, filename))
    except Exception:
        logger.exception("Claude extraction: could not prepare image filename=%s", filename)
        return {}

    try:
        response = _client().beta.messages.create(
            model=settings.anthropic_model,
            max_tokens=16000,
            system=EXTRACTION_SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": base64.standard_b64encode(payload).decode("ascii"),
                            },
                        },
                        {"type": "text", "text": EXTRACTION_USER_PROMPT},
                    ],
                }
            ],
            output_config={
                "effort": settings.anthropic_effort,
                "format": {"type": "json_schema", "schema": INVOICE_SCHEMA},
            },
            # If a safety classifier declines, Anthropic re-runs the request on its
            # recommended fallback model inside the same call.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError:
        logger.error("Claude extraction: ANTHROPIC_API_KEY was rejected")
        return {}
    except anthropic.RateLimitError:
        logger.warning("Claude extraction: rate limited filename=%s", filename)
        return {}
    except anthropic.APIStatusError as exc:
        logger.error(
            "Claude extraction failed status=%s request_id=%s message=%s",
            exc.status_code,
            getattr(exc, "request_id", None),
            exc.message,
        )
        return {}
    except anthropic.APIConnectionError as exc:
        logger.error("Claude extraction: connection error %s", exc)
        return {}

    if response.stop_reason == "refusal":
        category = getattr(response.stop_details, "category", None) if response.stop_details else None
        logger.warning("Claude extraction refused category=%s filename=%s", category, filename)
        return {}
    if response.stop_reason == "max_tokens":
        logger.warning("Claude extraction hit max_tokens filename=%s", filename)
        return {}

    text = next((block.text for block in response.content if block.type == "text"), "")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        logger.error("Claude extraction returned non-JSON output request_id=%s", response._request_id)
        return {}
    if not isinstance(parsed, dict):
        return {}

    logger.info(
        "Claude extraction ok model=%s input_tokens=%s output_tokens=%s",
        response.model,
        response.usage.input_tokens,
        response.usage.output_tokens,
    )
    return {key: value for key, value in parsed.items() if value is not None}


def claude_generate_text(
    prompt: str,
    *,
    system: str | None = None,
    max_tokens: int = 16000,
    timeout: float | None = None,
) -> str:
    """Answer a text prompt (chat, translation, JSON tasks). Raises on failure so callers can fall back."""
    if not claude_extraction_enabled():
        raise RuntimeError("Claude is not configured (ANTHROPIC_API_KEY is empty)")

    settings = get_settings()
    client = _client() if timeout is None else _client().with_options(timeout=timeout, max_retries=0)
    request: dict[str, Any] = {
        "model": settings.anthropic_model,
        # Covers thinking plus the answer; thinking is always on for Claude Opus 5.5.
        "max_tokens": max(max_tokens, 8000),
        "messages": [{"role": "user", "content": prompt}],
        "output_config": {"effort": settings.anthropic_chat_effort},
        "betas": ["server-side-fallback-2026-07-01"],
        "fallbacks": "default",
    }
    if system:
        request["system"] = system
    response = client.beta.messages.create(**request)

    if response.stop_reason == "refusal":
        raise RuntimeError("Claude declined the request")
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if not text:
        raise RuntimeError(f"Claude returned no text (stop_reason={response.stop_reason})")
    return text
