from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

try:
    import boto3
except Exception:  # pragma: no cover - optional runtime dependency
    boto3 = None  # type: ignore[assignment]

from app.core.config import get_settings

STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "into",
    "have",
    "has",
    "your",
    "are",
    "was",
    "were",
    "will",
    "bill",
    "invoice",
    "amount",
}


class MetadataGenerator:
    def __init__(self) -> None:
        settings = get_settings()
        self.aws_only_mode = settings.aws_only_mode
        self.model = settings.bedrock_chat_model
        self.bedrock = None
        if boto3:
            try:
                self.bedrock = boto3.client("bedrock-runtime", region_name=settings.aws_region)
            except Exception:
                self.bedrock = None

    @staticmethod
    def _fallback_metadata(content: str, chunk_type: str) -> dict[str, Any]:
        tokens = [token.lower() for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", content)]
        ranked = [token for token, _ in Counter(tokens).most_common(12) if token not in STOPWORDS]
        keywords = ranked[:6] if ranked else [chunk_type, "financial", "document"]
        summary = content[:220].strip().replace("\n", " ")
        if len(content) > 220:
            summary += "..."
        hypothetical_questions = [
            f"What does this {chunk_type.replace('_', ' ')} indicate?",
            f"Are there anomalies in this {chunk_type.replace('_', ' ')}?",
            f"How does this relate to compliance checks?",
        ]
        return {
            "summary": summary or "No summary available.",
            "keywords": keywords,
            "hypothetical_questions": hypothetical_questions,
        }

    def generate(self, content: str, chunk_type: str, document_id: str, chunk_id: str) -> dict[str, Any]:
        if not self.bedrock:
            if self.aws_only_mode:
                raise RuntimeError("AWS-only mode: Bedrock runtime client is unavailable.")
            return self._fallback_metadata(content, chunk_type)

        prompt = (
            "You generate metadata for retrieval. Return strict JSON with keys: "
            "`summary` (string <= 40 words), `keywords` (array of 3-8 lowercase strings), "
            "`hypothetical_questions` (array of exactly 3 user questions). "
            "Use only factual information from the provided chunk."
        )
        user_input = (
            f"document_id={document_id}\n"
            f"chunk_id={chunk_id}\n"
            f"chunk_type={chunk_type}\n"
            "chunk_content:\n"
            f"{content}"
        )
        try:
            response = self.bedrock.converse(
                modelId=self.model,
                system=[{"text": prompt}],
                messages=[{"role": "user", "content": [{"text": user_input}]}],
                inferenceConfig={"temperature": 0.0, "maxTokens": 500},
            )
            content_blocks = (
                response.get("output", {})
                .get("message", {})
                .get("content", [])
            )
            raw = "".join(
                str(block.get("text", ""))
                for block in content_blocks
                if isinstance(block, dict)
            ).strip()
            parsed = json.loads(raw)
            summary = str(parsed.get("summary", "")).strip()
            keywords = [str(keyword).lower().strip() for keyword in parsed.get("keywords", []) if str(keyword).strip()]
            questions = [str(item).strip() for item in parsed.get("hypothetical_questions", []) if str(item).strip()]
            if len(questions) < 3:
                fallback = self._fallback_metadata(content, chunk_type)["hypothetical_questions"]
                questions += fallback[: 3 - len(questions)]
            if not summary or not keywords:
                fallback = self._fallback_metadata(content, chunk_type)
                summary = summary or fallback["summary"]
                keywords = keywords or fallback["keywords"]
            return {
                "summary": summary,
                "keywords": keywords[:8],
                "hypothetical_questions": questions[:3],
            }
        except Exception:
            if self.aws_only_mode:
                raise
            return self._fallback_metadata(content, chunk_type)
