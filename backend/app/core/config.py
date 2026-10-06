from functools import lru_cache
from pathlib import Path
import json
import os
from typing import Any, Dict

from pydantic import Field

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
except Exception:  # pragma: no cover - fallback when optional dependency is missing
    from pydantic import BaseModel

    def _resolve_env_path(env_file: str) -> Path:
        candidate = Path(env_file)
        if candidate.is_absolute():
            return candidate

        cwd_candidate = Path.cwd() / candidate
        if cwd_candidate.exists():
            return cwd_candidate

        backend_root_candidate = Path(__file__).resolve().parents[2] / candidate
        if backend_root_candidate.exists():
            return backend_root_candidate

        return cwd_candidate

    def _parse_env_file(env_file: str, encoding: str = "utf-8") -> dict[str, str]:
        resolved = _resolve_env_path(env_file)
        try:
            lines = resolved.read_text(encoding=encoding).splitlines()
        except OSError:
            return {}

        parsed: dict[str, str] = {}
        for raw in lines:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.lower().startswith("export "):
                line = line[7:].lstrip()
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not key:
                continue

            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            parsed[key] = value
        return parsed

    class BaseSettings(BaseModel):  # type: ignore[no-redef]
        def __init__(self, **values: Any) -> None:
            model_config = getattr(self.__class__, "model_config", {}) or {}
            env_file = str(model_config.get("env_file", ".env"))
            env_encoding = str(model_config.get("env_file_encoding", "utf-8"))
            env_values = _parse_env_file(env_file, env_encoding)

            settings_values: dict[str, Any] = {}
            for field_name, field_info in self.__class__.model_fields.items():  # type: ignore[attr-defined]
                env_key = field_name.upper()
                raw_value = os.environ.get(env_key, env_values.get(env_key))
                if raw_value is None:
                    continue

                annotation = field_info.annotation
                if annotation in (dict, Dict, dict[str, str], Dict[str, str]):
                    try:
                        settings_values[field_name] = json.loads(raw_value)
                    except Exception:
                        settings_values[field_name] = raw_value
                else:
                    settings_values[field_name] = raw_value

            settings_values.update(values)
            super().__init__(**settings_values)

    SettingsConfigDict = dict  # type: ignore[misc,assignment]


class Settings(BaseSettings):
    app_name: str = "SafeBill RAG API"
    environment: str = "dev"
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/safebill"
    cors_allowed_origins: str = "http://localhost:3000"
    cors_allow_credentials: bool = False
    use_pinecone: bool = False
    pinecone_api_key: str = ""
    pinecone_index_name: str = ""
    pinecone_namespace: str = ""
    pinecone_top_k_multiplier: int = 4
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4.1-mini"
    openai_embedding_model: str = "text-embedding-3-large"
    embedding_dimensions: int = 3072
    ocr_enabled: bool = True
    use_unstructured_partition: bool = False
    tesseract_cmd: str = ""
    extraction_low_confidence_threshold: float = 0.65
    extraction_review_required_threshold: float = 0.6
    textract_proxy_url: str = ""
    textract_proxy_api_key: str = ""
    docai_proxy_url: str = ""
    docai_proxy_api_key: str = ""
    google_maps_api_key: str = ""
    enable_google_service_center_lookup: bool = False
    service_center_directory_path: str = ""
    max_chunks_per_document: int = 1500
    max_search_results: int = 25
    email_notifications_enabled: bool = False
    sms_notifications_enabled: bool = False
    push_notifications_enabled: bool = False
    whatsapp_notifications_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    email_webhook_url: str = ""
    email_webhook_api_key: str = ""
    email_webhook_min_interval_seconds: float = 0.6
    resend_api_key: str = ""
    resend_api_base_url: str = "https://api.resend.com"
    email_from: str = ""
    email_from_name: str = "SafeBill"
    notification_default_alert_days: str = "30,7,1"
    notification_claim_alert_days: str = "14,3"
    notification_worker_batch_size: int = 50
    notification_worker_poll_seconds: int = 60
    notification_max_retries: int = 5
    notification_retry_backoff_minutes: int = 15
    notification_webhook_secret: str = ""
    sms_webhook_url: str = ""
    push_webhook_url: str = ""
    whatsapp_webhook_url: str = ""
    supabase_url: str = ""
    supabase_jwt_issuer: str = ""
    supabase_jwt_audience: str = "authenticated"
    api_rate_limit_window_seconds: int = 60
    api_rate_limit_ask_per_window: int = 30
    api_rate_limit_ingest_per_window: int = 20
    api_rate_limit_notification_per_window: int = 40
    auth_tokens: Dict[str, str] = Field(
        default_factory=lambda: {
            "safebill-admin-token": "admin",
            "safebill-analyst-token": "analyst",
            "safebill-auditor-token": "auditor",
            "safebill-viewer-token": "viewer",
        }
    )
    prompt_injection_blocking: bool = True

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
