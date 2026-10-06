from __future__ import annotations

from types import SimpleNamespace

from app.core.config import get_settings
from app.services import gemini_client


def _record_posts(monkeypatch, statuses: list[int]) -> list[str]:
    used_keys: list[str] = []

    def fake_post(url, headers, json, timeout):
        used_keys.append(headers["Authorization"])
        return SimpleNamespace(status_code=statuses[len(used_keys) - 1])

    monkeypatch.setattr(gemini_client.httpx, "post", fake_post)
    return used_keys


def test_backup_key_is_used_when_main_key_is_out_of_credit(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "openrouter_backup_api_key", "sk-or-backup")
    used = _record_posts(monkeypatch, [402, 200])

    response = gemini_client._post_openrouter({"Authorization": "Bearer sk-or-main"}, {}, 5)

    assert response.status_code == 200
    assert used == ["Bearer sk-or-main", "Bearer sk-or-backup"]


def test_backup_key_is_not_used_for_ordinary_errors(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "openrouter_backup_api_key", "sk-or-backup")
    used = _record_posts(monkeypatch, [400])

    assert gemini_client._post_openrouter({"Authorization": "Bearer sk-or-main"}, {}, 5).status_code == 400
    assert used == ["Bearer sk-or-main"]


def test_no_retry_without_a_backup_key(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "openrouter_backup_api_key", "")
    used = _record_posts(monkeypatch, [429])

    assert gemini_client._post_openrouter({"Authorization": "Bearer sk-or-main"}, {}, 5).status_code == 429
    assert len(used) == 1
