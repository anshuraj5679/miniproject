import re
from functools import lru_cache
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import Depends, Header, HTTPException, status

from app.core.config import get_settings

try:
    import jwt
    from jwt import PyJWKClient
except Exception:  # pragma: no cover - optional runtime dependency
    jwt = None  # type: ignore[assignment]
    PyJWKClient = None  # type: ignore[assignment]

PROMPT_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"reveal\s+(the\s+)?system\s+prompt",
    r"developer\s+message",
    r"tool\s+call",
    r"bypass\s+policy",
    r"disable\s+safety",
    r"drop\s+table",
    r"union\s+select",
    r"exec\(",
    r"<script",
]


@dataclass
class Principal:
    token: str
    role: str
    subject: str | None = None
    user_type: str | None = None
    email: str | None = None
    full_name: str | None = None


@lru_cache(maxsize=2)
def _jwks_client(supabase_url: str):
    if PyJWKClient is None:
        return None
    base = supabase_url.rstrip("/")
    return PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json")


def _extract_user_type(claims: dict[str, Any]) -> str | None:
    user_metadata = claims.get("user_metadata")
    if isinstance(user_metadata, dict):
        candidate = str(user_metadata.get("user_type") or "").strip().lower()
        if candidate in {"consumer", "merchant"}:
            return candidate

    app_metadata = claims.get("app_metadata")
    if isinstance(app_metadata, dict):
        candidate = str(app_metadata.get("user_type") or "").strip().lower()
        if candidate in {"consumer", "merchant"}:
            return candidate

    return None


def _extract_email(claims: dict[str, Any]) -> str | None:
    direct = str(claims.get("email") or "").strip()
    if "@" in direct:
        return direct[:320]

    for key in ("user_metadata", "app_metadata"):
        section = claims.get(key)
        if not isinstance(section, dict):
            continue
        candidate = str(section.get("email") or "").strip()
        if "@" in candidate:
            return candidate[:320]
    return None


def _extract_full_name(claims: dict[str, Any]) -> str | None:
    for key in ("user_metadata", "app_metadata"):
        section = claims.get(key)
        if not isinstance(section, dict):
            continue
        for field in ("full_name", "name"):
            candidate = str(section.get(field) or "").strip()
            if candidate:
                return candidate[:255]
    return None


def _verify_supabase_jwt(token: str) -> dict[str, Any] | None:
    settings = get_settings()
    if not token or not settings.supabase_url or jwt is None:
        return None

    jwks_client = _jwks_client(settings.supabase_url)
    if jwks_client is None:
        return None

    issuer = settings.supabase_jwt_issuer.strip() if settings.supabase_jwt_issuer else ""
    if not issuer:
        issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"

    audience = settings.supabase_jwt_audience.strip() if settings.supabase_jwt_audience else ""
    decode_kwargs: dict[str, Any] = {
        "algorithms": ["RS256"],
        "issuer": issuer,
        "options": {"require": ["exp", "iat", "sub"], "verify_aud": bool(audience)},
    }
    if audience:
        decode_kwargs["audience"] = audience

    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(token, signing_key.key, **decode_kwargs)
    except Exception:
        return None

    return claims if isinstance(claims, dict) else None


def sanitize_user_query(text: str) -> str:
    stripped = text.replace("\x00", " ")
    stripped = re.sub(r"[\r\n\t]+", " ", stripped)
    return re.sub(r"\s{2,}", " ", stripped).strip()


def detect_prompt_injection(text: str) -> list[str]:
    query = text.lower()
    hits: list[str] = []
    for pattern in PROMPT_INJECTION_PATTERNS:
        if re.search(pattern, query):
            hits.append(pattern)
    return hits


def enforce_safe_query(text: str) -> str:
    settings = get_settings()
    sanitized = sanitize_user_query(text)
    if settings.prompt_injection_blocking:
        hits = detect_prompt_injection(sanitized)
        if hits:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"message": "Query blocked by prompt-injection defenses.", "signals": hits},
            )
    return sanitized


def get_current_principal(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> Principal:
    settings = get_settings()

    token = x_api_key
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    if token in settings.auth_tokens:
        return Principal(token=token, role=settings.auth_tokens[token])

    claims = _verify_supabase_jwt(token)
    if not claims:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    subject = str(claims.get("sub") or "").strip()
    if not subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    user_type = _extract_user_type(claims) or "consumer"
    role = "merchant" if user_type == "merchant" else "consumer"
    return Principal(
        token=token,
        role=role,
        subject=subject,
        user_type=user_type,
        email=_extract_email(claims),
        full_name=_extract_full_name(claims),
    )


def require_roles(*allowed_roles: str) -> Callable:
    def dependency(principal: Principal = Depends(get_current_principal)) -> Principal:
        if principal.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return principal

    return dependency
