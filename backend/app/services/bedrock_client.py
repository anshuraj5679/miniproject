from __future__ import annotations

import os

from app.core.config import Settings


def configure_bedrock_api_key(settings: Settings) -> None:
    existing = os.getenv("AWS_BEARER_TOKEN_BEDROCK")
    if existing:
        return
    token = str(getattr(settings, "aws_anthropic_key", "") or "").strip()
    if not token:
        token = str(getattr(settings, "aws_amazonnova_key", "") or "").strip()
    if token:
        os.environ["AWS_BEARER_TOKEN_BEDROCK"] = token
