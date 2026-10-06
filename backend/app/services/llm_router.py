"""Text-answer routing across the configured AI providers.

Chat answers go to one provider at a time, in LLM_PROVIDER_ORDER (default
claude -> gemini -> openrouter); if one is missing, fails or times out, the next one
answers within the remaining time budget. Image extraction does not use this module:
it runs every vision engine in parallel and votes (see _run_image_extraction_router).
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Callable

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Each provider gets at least this long; below it, an attempt would only waste the budget.
_MIN_ATTEMPT_SECONDS = 8.0


def _claude(prompt: str, system: str | None, max_tokens: int, response_json: bool, timeout: float) -> str:
    from app.services.claude_client import claude_extraction_enabled, claude_generate_text

    if not claude_extraction_enabled():
        raise LookupError("not configured")
    if response_json:
        system = (system or "") + "\n\nRespond with a single JSON object and nothing else."
    return claude_generate_text(prompt, system=system, max_tokens=max_tokens, timeout=timeout)


def _gemini(prompt: str, system: str | None, max_tokens: int, response_json: bool, timeout: float) -> str:
    from app.services.google_gemini_client import google_gemini_enabled, google_gemini_generate_text

    if not google_gemini_enabled():
        raise LookupError("not configured")
    return google_gemini_generate_text(
        prompt, system=system, max_tokens=max_tokens, response_json=response_json, timeout=timeout
    )


def _openrouter(prompt: str, system: str | None, max_tokens: int, response_json: bool, timeout: float) -> str:
    from app.services.gemini_client import gemini_generate

    settings = get_settings()
    if not (settings.gemini_api_key.strip() or settings.openrouter_backup_api_key.strip()):
        raise LookupError("not configured")
    _ = timeout  # OpenRouter calls use OPENROUTER_TIMEOUT_SECONDS
    return gemini_generate(
        prompt,
        system_instruction=system,
        temperature=0.15,
        max_tokens=max_tokens,
        response_json=response_json,
    )


PROVIDERS: dict[str, Callable[[str, str | None, int, bool, float], str]] = {
    "claude": _claude,
    "gemini": _gemini,
    "openrouter": _openrouter,
}


def provider_order() -> list[str]:
    raw = get_settings().llm_provider_order
    order = [name.strip().lower() for name in str(raw or "").split(",") if name.strip()]
    return [name for name in order if name in PROVIDERS] or list(PROVIDERS)


def generate_text(
    prompt: str,
    *,
    system: str | None = None,
    max_tokens: int = 2000,
    response_json: bool = False,
    budget_seconds: float | None = None,
) -> tuple[str, str]:
    """Return (text, provider) from the first provider that answers. Raises if none do."""
    budget = float(budget_seconds or get_settings().llm_chat_budget_seconds)
    started = time.monotonic()
    failures: list[str] = []

    for name in provider_order():
        remaining = budget - (time.monotonic() - started)
        if remaining < _MIN_ATTEMPT_SECONDS:
            failures.append(f"{name}: no time left")
            break
        try:
            text = PROVIDERS[name](prompt, system, max_tokens, response_json, remaining)
        except LookupError:
            continue  # provider not configured
        except Exception as exc:
            logger.warning("LLM provider %s failed: %s", name, str(exc)[:300])
            failures.append(f"{name}: {type(exc).__name__}")
            continue
        if text and text.strip():
            return text.strip(), name
        failures.append(f"{name}: empty answer")

    raise RuntimeError("No AI provider answered (" + "; ".join(failures or ["none configured"]) + ")")


def parse_json_object(raw: str) -> dict[str, Any] | None:
    """Parse a JSON object from model output that may be wrapped in a code fence or prose."""
    if not raw:
        return None
    candidates = [raw]
    fenced = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)
    if fenced:
        candidates.append(fenced.group(1))
    start, end = raw.find("{"), raw.rfind("}")
    if 0 <= start < end:
        candidates.append(raw[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def extract_json(
    prompt: str,
    *,
    system: str | None = None,
    max_tokens: int = 1500,
    budget_seconds: float | None = None,
) -> dict[str, Any]:
    """Ask for a JSON object; returns {} if no provider produced valid JSON."""
    try:
        raw, provider = generate_text(
            prompt, system=system, max_tokens=max_tokens, response_json=True, budget_seconds=budget_seconds
        )
    except RuntimeError as exc:
        logger.warning("extract_json: %s", exc)
        return {}
    parsed = parse_json_object(raw)
    if parsed is None:
        logger.warning("extract_json: %s returned unparseable output", provider)
        return {}
    return parsed
