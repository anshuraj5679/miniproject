from __future__ import annotations

import json
from typing import Any

try:
    import boto3
except Exception:  # pragma: no cover - optional runtime dependency
    boto3 = None  # type: ignore[assignment]

from app.core.config import get_settings
from app.services.bedrock_client import configure_bedrock_api_key
from app.services.planner import Plan
from app.services.retrieval import RetrievalHit


class GroundedAnswerGenerator:
    def __init__(self) -> None:
        settings = get_settings()
        self.aws_only_mode = settings.aws_only_mode
        self.model = settings.bedrock_chat_model
        self.bedrock = None
        if boto3:
            try:
                configure_bedrock_api_key(settings)
                self.bedrock = boto3.client("bedrock-runtime", region_name=settings.aws_region)
            except Exception:
                self.bedrock = None

    @staticmethod
    def _context_block(hits: list[RetrievalHit]) -> str:
        lines: list[str] = []
        for hit in hits:
            lines.append(
                "\n".join(
                    [
                        f"chunk_id: {hit.chunk_id}",
                        f"bill_id: {hit.bill_id}",
                        f"vendor: {hit.vendor}",
                        f"chunk_type: {hit.chunk_type}",
                        f"score: {hit.score:.4f}",
                        f"content: {hit.content[:1400]}",
                    ]
                )
            )
        return "\n\n---\n\n".join(lines)

    @staticmethod
    def _fallback_answer(query: str, hits: list[RetrievalHit], calculations: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
        snippets = [f"[{hit.chunk_id}] {hit.summary or hit.content[:180]}" for hit in hits[:5]]
        answer = "Grounded response based on retrieved chunks:\n" + "\n".join(snippets)
        if calculations.get("gst_anomalies"):
            answer += f"\nDetected GST anomalies: {len(calculations['gst_anomalies'])}"
        if policy.get("missing_vendor_tax_ids"):
            answer += f"\nMissing vendor tax IDs: {len(policy['missing_vendor_tax_ids'])}"

        claims = [{"text": snippet, "citations": [str(hits[idx].chunk_id)]} for idx, snippet in enumerate(snippets[: len(hits)])]
        return {
            "answer": answer,
            "claims": claims,
            "citation_chunk_ids": [str(hit.chunk_id) for hit in hits[:8]],
            "numeric_claims": [{"metric": "document_total_sum", "value": calculations.get("document_total_sum")}],
        }

    def generate(
        self,
        query: str,
        plan: Plan,
        hits: list[RetrievalHit],
        calculations: dict[str, Any],
        policy: dict[str, Any],
    ) -> dict[str, Any]:
        if not hits:
            return {
                "answer": "No relevant grounded records were found for the query.",
                "claims": [],
                "citation_chunk_ids": [],
                "numeric_claims": [],
            }

        if not self.bedrock:
            if self.aws_only_mode:
                raise RuntimeError("AWS-only mode: Bedrock runtime client is unavailable.")
            return self._fallback_answer(query, hits, calculations, policy)

        prompt = (
            "You are a financial auditor assistant. Use ONLY provided chunks and computed data. "
            "Never invent facts. Return JSON with keys: "
            "`answer` (string), `claims` (list of {text, citations}), "
            "`citation_chunk_ids` (list of chunk ids), "
            "`numeric_claims` (list of {metric, value}). "
            "Each claim must cite one or more chunk IDs from context."
        )
        user_data = {
            "query": query,
            "plan": {"complexity": plan.complexity, "steps": [step.__dict__ for step in plan.steps]},
            "calculations": calculations,
            "policy_findings": policy,
            "context": self._context_block(hits),
        }

        try:
            response = self.bedrock.converse(
                modelId=self.model,
                system=[{"text": prompt}],
                messages=[
                    {
                        "role": "user",
                        "content": [{"text": json.dumps(user_data, default=str)}],
                    }
                ],
                inferenceConfig={"temperature": 0.0, "maxTokens": 1200},
            )
            content_blocks = (
                response.get("output", {})
                .get("message", {})
                .get("content", [])
            )
            response_text = "".join(
                str(block.get("text", ""))
                for block in content_blocks
                if isinstance(block, dict)
            ).strip()
            payload = json.loads(response_text or "{}")
            payload.setdefault("answer", "")
            payload.setdefault("claims", [])
            payload.setdefault("citation_chunk_ids", [])
            payload.setdefault("numeric_claims", [])
            return payload
        except Exception:
            if self.aws_only_mode:
                raise
            return self._fallback_answer(query, hits, calculations, policy)
