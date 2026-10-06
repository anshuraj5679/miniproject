from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

try:
    import boto3
except Exception:  # pragma: no cover - optional runtime dependency
    boto3 = None  # type: ignore[assignment]

try:
    from botocore.config import Config as BotoConfig
except Exception:  # pragma: no cover - optional runtime dependency
    BotoConfig = None  # type: ignore[assignment]

from app.core.config import get_settings
from app.models import Document
from app.services.extraction_pipeline import sanitize_merchandise_name

logger = logging.getLogger(__name__)

_TITAN_IMAGE_FALLBACKS: tuple[tuple[str, str], ...] = (
    ("amazon.titan-image-generator-v2:0", "us-east-1"),
    ("amazon.titan-image-generator-v2:0", "us-west-2"),
)
_MAX_TEXT_CHARS = 512
_MAX_TITAN_SEED = 2_147_483_646


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:80] or "product"


def _collapse_text(value: str, limit: int) -> str:
    compact = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(compact) <= limit:
        return compact
    trimmed = compact[: max(0, limit - 3)].rstrip(" ,.;:-")
    return f"{trimmed}..."


def _is_content_filter_error(exc: Exception) -> bool:
    message = str(exc or "").lower()
    return any(
        token in message
        for token in (
            "blocked by our content filters",
            "content filter",
            "safety system",
            "violates content",
        )
    )


class ProductImageService:
    def __init__(self) -> None:
        settings = get_settings()
        self.enabled = bool(settings.product_image_generation_enabled)
        self.model = settings.bedrock_image_model.strip()
        self.region = settings.aws_region
        self.preferred_region = str(settings.bedrock_image_region or "").strip() or self.region
        self.width = max(512, int(settings.product_image_width))
        self.height = max(512, int(settings.product_image_height))
        self.aws_only_mode = settings.aws_only_mode
        self._clients: dict[str, Any | None] = {}
        if boto3 and self.enabled and self.model:
            client = self._client_for_region(self.preferred_region)
            if client is None and self.aws_only_mode:
                raise RuntimeError("Bedrock runtime is unavailable for image generation.")

    @staticmethod
    def _references(document: Document) -> dict[str, Any]:
        references = getattr(document, "references", None)
        return references if isinstance(references, dict) else {}

    def _client_for_region(self, region: str) -> Any | None:
        normalized = str(region or "").strip()
        if not normalized or boto3 is None:
            return None
        if normalized in self._clients:
            return self._clients[normalized]
        try:
            kwargs: dict[str, Any] = {"region_name": normalized}
            if BotoConfig is not None:
                kwargs["config"] = BotoConfig(proxies={})
            client = boto3.client("bedrock-runtime", **kwargs)
        except Exception:
            client = None
        self._clients[normalized] = client
        return client

    def _model_candidates(self) -> list[tuple[str, str]]:
        seen: set[tuple[str, str]] = set()
        candidates: list[tuple[str, str]] = []
        primary = (self.model, self.preferred_region)
        if primary[0] and primary[1]:
            candidates.append(primary)
            seen.add(primary)
        for fallback in _TITAN_IMAGE_FALLBACKS:
            if fallback in seen:
                continue
            candidates.append(fallback)
            seen.add(fallback)
        return candidates

    @staticmethod
    def _subject_from_references(references: dict[str, Any], *, fallback: str) -> str:
        candidates: list[str] = []
        direct = sanitize_merchandise_name(references.get("product_name"))
        if direct:
            candidates.append(str(direct))
        line_items = references.get("line_items")
        if isinstance(line_items, list):
            for entry in line_items:
                if not isinstance(entry, dict):
                    continue
                candidate = sanitize_merchandise_name(entry.get("name") or entry.get("product_name"))
                if candidate:
                    candidates.append(str(candidate))
        normalized_fallback = sanitize_merchandise_name(fallback)
        if normalized_fallback:
            candidates.append(str(normalized_fallback))
        for candidate in candidates:
            cleaned = str(candidate).strip()
            if cleaned:
                return cleaned[:180]
        return ""

    @staticmethod
    def _ocr_lines(text: str) -> str:
        selected: list[str] = []
        for raw_line in text.splitlines():
            line = re.sub(r"\s{2,}", " ", raw_line).strip()
            if len(line) < 4:
                continue
            if re.fullmatch(r"[A-Z0-9:/().,\- ]{1,20}", line) and not re.search(r"[A-Za-z]{3,}", line):
                continue
            selected.append(line)
            if len(selected) >= 10:
                break
        return "\n".join(selected)

    def _load_ocr_text(self, document: Document, object_store: Any) -> tuple[str, str]:
        references = self._references(document)
        ocr_key = str(references.get("ocr_text_storage_key") or "").strip()
        if ocr_key and object_store is not None and getattr(object_store, "enabled", False):
            payload = object_store.get_bytes(key=ocr_key)
            if payload:
                try:
                    return payload.decode("utf-8", errors="ignore"), "s3_ocr_snapshot"
                except Exception:
                    pass
        return str(references.get("raw_text") or "").strip(), "document_reference"

    def _build_prompt(
        self,
        *,
        subject: str,
        brand: str,
        category: str,
        vendor: str,
        ocr_excerpt: str,
    ) -> str:
        focus_bits = [f"Product: {_collapse_text(subject, 120)}."]
        if brand:
            focus_bits.append(f"Brand: {_collapse_text(brand, 50)}.")
        if category:
            focus_bits.append(f"Category: {_collapse_text(category, 40)}.")
        if vendor:
            focus_bits.append(f"Seller context: {_collapse_text(vendor, 50)}.")
        if ocr_excerpt:
            focus_bits.append(f"Invoice hint: {_collapse_text(ocr_excerpt, 120)}.")

        prompt = (
            "Realistic studio product photo. Single item only. Neutral background. "
            + " ".join(focus_bits)
            + " No invoice paper, no document text, no logo overlay, no packaging collage, no people, no hands."
        )
        return _collapse_text(prompt, _MAX_TEXT_CHARS)

    def _build_minimal_prompt(
        self,
        *,
        subject: str,
        brand: str,
        category: str,
    ) -> str:
        focus_bits = [f"Photorealistic product photo of {_collapse_text(subject, 100)}."]
        if brand:
            focus_bits.append(f"Brand family: {_collapse_text(brand, 40)}.")
        if category:
            focus_bits.append(f"Category: {_collapse_text(category, 30)}.")
        prompt = (
            "Single consumer product only. Clean studio lighting. Plain background. "
            + " ".join(focus_bits)
            + " No text, no invoice, no packaging collage, no people, no hands, no logo overlay."
        )
        return _collapse_text(prompt, _MAX_TEXT_CHARS)

    def _build_prompt_variants(
        self,
        *,
        subject: str,
        brand: str,
        category: str,
        vendor: str,
        ocr_excerpt: str,
    ) -> list[tuple[str, str]]:
        prompts: list[tuple[str, str]] = [
            (
                "detailed",
                self._build_prompt(
                    subject=subject,
                    brand=brand,
                    category=category,
                    vendor=vendor,
                    ocr_excerpt=ocr_excerpt,
                ),
            ),
            (
                "product_only",
                self._build_prompt(
                    subject=subject,
                    brand=brand,
                    category=category,
                    vendor="",
                    ocr_excerpt="",
                ),
            ),
            (
                "minimal",
                self._build_minimal_prompt(
                    subject=subject,
                    brand=brand,
                    category=category,
                ),
            ),
        ]
        deduped: list[tuple[str, str]] = []
        seen: set[str] = set()
        for label, prompt in prompts:
            if not prompt or prompt in seen:
                continue
            seen.add(prompt)
            deduped.append((label, prompt))
        return deduped

    def generate_for_document(self, *, document: Document, object_store: Any) -> dict[str, Any]:
        if not self.enabled:
            raise RuntimeError("Product image generation is disabled.")
        if not self.model:
            raise RuntimeError("Bedrock image model is not configured.")
        if object_store is None or not getattr(object_store, "enabled", False):
            raise RuntimeError("S3 object storage is required for product image generation.")

        references = self._references(document)
        subject = self._subject_from_references(
            references,
            fallback=str(references.get("title") or document.bill_id or ""),
        )
        if not subject:
            raise ValueError("Product name is not strong enough to generate an image yet.")

        brand = str(references.get("brand") or "").strip()
        category = str(references.get("category") or "").strip()
        vendor = str(document.vendor or "").strip()
        ocr_text, ocr_source = self._load_ocr_text(document, object_store)
        ocr_excerpt = self._ocr_lines(ocr_text)
        prompt_variants = self._build_prompt_variants(
            subject=subject,
            brand=brand,
            category=category,
            vendor=vendor,
            ocr_excerpt=ocr_excerpt,
        )
        negative_prompt = _collapse_text(
            "invoice, bill, receipt, document, text overlay, watermark, logo, brand wordmark, person, hand, shopping scene, multiple products, collage, packaging",
            220,
        )
        raw_seed = int(hashlib.sha256(f"{document.id}:{subject}".encode("utf-8")).hexdigest()[:8], 16)
        deterministic_seed = 1 + (raw_seed % _MAX_TITAN_SEED)

        response = None
        model_used = self.model
        region_used = self.preferred_region
        prompt_variant_used = ""
        prompt_used = ""
        last_error: Exception | None = None
        for prompt_variant, prompt in prompt_variants:
            request_body = {
                "taskType": "TEXT_IMAGE",
                "textToImageParams": {
                    "text": prompt,
                    "negativeText": negative_prompt,
                },
                "imageGenerationConfig": {
                    "numberOfImages": 1,
                    "quality": "standard",
                    "width": self.width,
                    "height": self.height,
                    "cfgScale": 8.0,
                    "seed": deterministic_seed,
                },
            }
            for candidate_model, candidate_region in self._model_candidates():
                client = self._client_for_region(candidate_region)
                if client is None:
                    continue
                try:
                    response = client.invoke_model(
                        modelId=candidate_model,
                        contentType="application/json",
                        accept="application/json",
                        body=json.dumps(request_body),
                    )
                    model_used = candidate_model
                    region_used = candidate_region
                    prompt_variant_used = prompt_variant
                    prompt_used = prompt
                    break
                except Exception as exc:
                    last_error = exc
                    logger.warning(
                        "Bedrock product image invoke failed model=%s region=%s variant=%s error=%s",
                        candidate_model,
                        candidate_region,
                        prompt_variant,
                        str(exc),
                    )
                    if _is_content_filter_error(exc):
                        break
                    continue
            if response is not None:
                break
        if response is None:
            if last_error is not None:
                raise last_error
            raise RuntimeError("Bedrock runtime is unavailable for image generation.")

        raw_body = response.get("body")
        response_payload = json.loads(raw_body.read() if raw_body else "{}")
        images = response_payload.get("images") if isinstance(response_payload, dict) else None
        if not isinstance(images, list) or not images or not isinstance(images[0], str):
            raise RuntimeError("Bedrock image generation did not return an image payload.")

        image_bytes = base64.b64decode(images[0].encode("ascii"))
        filename = f"{_safe_slug(subject)}-preview.png"
        key = object_store.build_object_key(filename=filename, source="product-previews")
        uploaded = object_store.put_bytes(
            key=key,
            payload=image_bytes,
            filename=filename,
            content_type="image/png",
            metadata={
                "document_id": str(document.id),
                "bill_id": str(document.bill_id),
                "subject": subject,
                "brand": brand,
                "category": category,
                "vendor": vendor,
                "model_region": region_used,
            },
        )
        if not uploaded or not uploaded.get("storage_key"):
            raise RuntimeError("Generated product image could not be stored in S3.")

        prompt_filename = f"{_safe_slug(subject)}-prompt.json"
        prompt_key = object_store.build_object_key(filename=prompt_filename, source="product-previews-prompts")
        prompt_snapshot = {
            "document_id": str(document.id),
            "bill_id": str(document.bill_id),
            "subject": subject,
            "brand": brand,
            "category": category,
            "vendor": vendor,
            "ocr_source": ocr_source,
            "ocr_excerpt": ocr_excerpt,
            "prompt_variant": prompt_variant_used,
            "prompt": prompt_used,
            "negative_prompt": negative_prompt,
            "model": model_used,
            "model_region": region_used,
            "width": self.width,
            "height": self.height,
        }
        prompt_uploaded = object_store.put_bytes(
            key=prompt_key,
            payload=json.dumps(prompt_snapshot, ensure_ascii=True).encode("utf-8"),
            filename=prompt_filename,
            content_type="application/json",
            metadata={
                "document_id": str(document.id),
                "subject": subject,
                "source": ocr_source,
            },
        )

        return {
            "status": "ready",
            "subject": subject,
            "model_id": model_used,
            "model_region": region_used,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "storage_key": str(uploaded.get("storage_key") or ""),
            "storage_bucket": str(uploaded.get("storage_bucket") or ""),
            "storage_region": str(uploaded.get("storage_region") or ""),
            "storage_content_type": str(uploaded.get("storage_content_type") or "image/png"),
            "prompt_storage_key": str((prompt_uploaded or {}).get("storage_key") or ""),
            "ocr_source": ocr_source,
        }
