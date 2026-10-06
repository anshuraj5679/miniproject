from __future__ import annotations

import hashlib
from typing import Iterable

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - optional runtime dependency
    OpenAI = None  # type: ignore[assignment]

from app.core.config import get_settings


def build_embedding_text(
    content: str,
    summary: str,
    keywords: list[str],
    hypothetical_questions: list[str],
) -> str:
    return "\n".join(
        [
            content.strip(),
            f"summary: {summary.strip()}",
            f"keywords: {', '.join(keywords)}",
            f"hypothetical_questions: {' | '.join(hypothetical_questions)}",
        ]
    )


class EmbeddingService:
    def __init__(self) -> None:
        settings = get_settings()
        self.model = settings.openai_embedding_model
        self.dimensions = settings.embedding_dimensions
        self.client = OpenAI(api_key=settings.openai_api_key) if (settings.openai_api_key and OpenAI) else None

    def _deterministic_embedding(self, text: str) -> list[float]:
        values: list[float] = []
        seed = text.encode("utf-8", errors="ignore")
        while len(values) < self.dimensions:
            digest = hashlib.sha256(seed).digest()
            for idx in range(0, len(digest), 2):
                if len(values) >= self.dimensions:
                    break
                raw = int.from_bytes(digest[idx : idx + 2], "little", signed=False)
                values.append((raw / 65535.0) * 2.0 - 1.0)
            seed = digest + seed[:8]
        return values

    def embed_batch(self, texts: Iterable[str]) -> list[list[float]]:
        text_list = list(texts)
        if not text_list:
            return []

        if not self.client:
            return [self._deterministic_embedding(text) for text in text_list]

        response = self.client.embeddings.create(model=self.model, input=text_list)
        return [item.embedding for item in response.data]
