from __future__ import annotations

import pytest

from app.services import llm_router


def _provider(answer=None, error=None, calls=None, name=""):
    def run(prompt, system, max_tokens, response_json, timeout):
        if calls is not None:
            calls.append(name)
        if error is not None:
            raise error
        return answer

    return run


def test_first_working_provider_answers_in_configured_order(monkeypatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(
        llm_router,
        "PROVIDERS",
        {
            "claude": _provider(error=RuntimeError("overloaded"), calls=calls, name="claude"),
            "gemini": _provider(answer="Gemini answer", calls=calls, name="gemini"),
            "openrouter": _provider(answer="OpenRouter answer", calls=calls, name="openrouter"),
        },
    )
    monkeypatch.setattr(llm_router, "provider_order", lambda: ["claude", "gemini", "openrouter"])

    text, provider = llm_router.generate_text("What is GST?")

    assert (text, provider) == ("Gemini answer", "gemini")
    assert calls == ["claude", "gemini"]


def test_unconfigured_providers_are_skipped(monkeypatch) -> None:
    monkeypatch.setattr(
        llm_router,
        "PROVIDERS",
        {
            "claude": _provider(error=LookupError("not configured")),
            "openrouter": _provider(answer="OpenRouter answer"),
        },
    )
    monkeypatch.setattr(llm_router, "provider_order", lambda: ["claude", "openrouter"])
    assert llm_router.generate_text("hi") == ("OpenRouter answer", "openrouter")


def test_all_providers_failing_raises(monkeypatch) -> None:
    monkeypatch.setattr(llm_router, "PROVIDERS", {"claude": _provider(error=RuntimeError("down"))})
    monkeypatch.setattr(llm_router, "provider_order", lambda: ["claude"])
    with pytest.raises(RuntimeError):
        llm_router.generate_text("hi")
    assert llm_router.extract_json("hi") == {}


def test_parse_json_object_handles_fenced_and_wrapped_output() -> None:
    assert llm_router.parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert llm_router.parse_json_object('Here you go: {"a": 2} thanks') == {"a": 2}
    assert llm_router.parse_json_object("not json") is None
