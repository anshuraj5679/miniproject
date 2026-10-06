from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from email.utils import formataddr, parseaddr
from string import Formatter
from time import perf_counter
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

try:
    import boto3
except Exception:  # pragma: no cover - optional runtime dependency
    boto3 = None  # type: ignore[assignment]

from app.core.config import get_settings
from app.models import (
    Document,
    NotificationDelivery,
    NotificationEvent,
    NotificationJob,
    NotificationPreference,
)
from app.services.date_utils import add_months

logger = logging.getLogger(__name__)

DEFAULT_TIMEZONE = timezone.utc
IN_APP_PLACEHOLDER_EMAIL = "in-app@local"
PUSH_PLACEHOLDER_TARGET = "push@local"

CHANNEL_IN_APP = "in_app"
CHANNEL_EMAIL = "email"
CHANNEL_SMS = "sms"
CHANNEL_PUSH = "push"
CHANNEL_WHATSAPP = "whatsapp"

STATUS_PENDING = "pending"
STATUS_FAILED = "failed"
STATUS_SENT = "sent"
STATUS_UNREAD = "unread"
STATUS_READ = "read"
STATUS_CANCELED = "canceled"
STATUS_DELETED = "deleted"
STATUS_DEAD_LETTER = "dead_letter"

PENDING_STATUSES = {STATUS_PENDING, STATUS_FAILED}
ACTIVE_STATUSES = {
    STATUS_PENDING,
    STATUS_FAILED,
    STATUS_UNREAD,
    STATUS_READ,
}

EVENT_PRODUCT_ASSIGNED = "PRODUCT_ASSIGNED"
EVENT_BILL_SCANNED = "BILL_SCANNED"
EVENT_WARRANTY_EXPIRED = "WARRANTY_EXPIRED"
EVENT_CLAIM_WINDOW_CLOSING = "CLAIM_WINDOW_CLOSING"
EVENT_SUSPICIOUS_OR_DUPLICATE_BILL = "SUSPICIOUS_OR_DUPLICATE_BILL"
EVENT_CONSUMER_NOT_ACTIVATED = "CONSUMER_NOT_ACTIVATED"
EMAIL_ADDRESS_PATTERN = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$")


class NotificationDeliveryError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        retry_after_seconds: int | None = None,
        permanent: bool = False,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retry_after_seconds = retry_after_seconds
        self.permanent = permanent


def _safe_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None
    return None


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=DEFAULT_TIMEZONE)
    return value.astimezone(DEFAULT_TIMEZONE)


def _normalize_phone(value: str | None) -> str | None:
    if not value:
        return None
    digits = "".join(ch for ch in value if ch.isdigit() or ch == "+")
    digits = digits.strip()
    return digits or None


def _is_valid_email_address(value: str) -> bool:
    candidate = (value or "").strip()
    if not candidate:
        return False
    return bool(EMAIL_ADDRESS_PATTERN.fullmatch(candidate))


class _SafeFormatter(Formatter):
    def get_value(self, key, args, kwargs):  # type: ignore[override]
        if isinstance(key, str):
            return kwargs.get(key, f"{{{key}}}")
        return super().get_value(key, args, kwargs)


@dataclass(frozen=True)
class NotificationTemplate:
    key: str
    version: int
    locale: str
    subject: str
    message: str


class TemplateEngine:
    def __init__(self) -> None:
        templates = [
            NotificationTemplate(
                key="consumer_product_assigned",
                version=1,
                locale="en",
                subject="Product assigned: {product_name}",
                message=(
                    "{product_name} from {vendor} was assigned to your SafeBill locker. "
                    "Invoice {bill_id} is now available."
                ),
            ),
            NotificationTemplate(
                key="consumer_bill_scanned",
                version=1,
                locale="en",
                subject="Bill scanned: {product_name}",
                message=(
                    "Your bill for {product_name} was scanned successfully. "
                    "Warranty tracking is now active."
                ),
            ),
            NotificationTemplate(
                key="consumer_warranty_expiry",
                version=1,
                locale="en",
                subject="Warranty expiring in {days_remaining} days",
                message=(
                    "Your {product_name} purchased on {purchase_date} will expire on {expiry_date}. "
                    "Prepare claim documents now."
                ),
            ),
            NotificationTemplate(
                key="consumer_warranty_expired",
                version=1,
                locale="en",
                subject="Warranty expired: {product_name}",
                message=(
                    "Your warranty for {product_name} expired on {expiry_date}. "
                    "Check if grace-period claim support applies."
                ),
            ),
            NotificationTemplate(
                key="consumer_claim_window_closing",
                version=1,
                locale="en",
                subject="Claim window closes in {days_remaining} days",
                message=(
                    "Claim eligibility for {product_name} closes soon (deadline: {expiry_date}). "
                    "Submit supporting documents before the window ends."
                ),
            ),
            NotificationTemplate(
                key="consumer_duplicate_alert",
                version=1,
                locale="en",
                subject="Potential duplicate or suspicious bill detected",
                message=(
                    "We found possible duplicate/suspicious billing signals for {product_name}: "
                    "{detection_reason}."
                ),
            ),
            NotificationTemplate(
                key="merchant_assignment_success",
                version=1,
                locale="en",
                subject="Product assignment completed",
                message=(
                    "You assigned {product_name} (Invoice {bill_id}) to consumer {consumer_user_id}."
                ),
            ),
            NotificationTemplate(
                key="merchant_warranty_expiry",
                version=1,
                locale="en",
                subject="Consumer warranty nearing expiry",
                message=(
                    "{product_name} for consumer {consumer_user_id} expires in {days_remaining} days."
                ),
            ),
            NotificationTemplate(
                key="merchant_duplicate_alert",
                version=1,
                locale="en",
                subject="Duplicate/suspicious bill alert",
                message=(
                    "A duplicate/suspicious billing pattern was detected for {product_name}: "
                    "{detection_reason}."
                ),
            ),
            NotificationTemplate(
                key="merchant_consumer_inactive",
                version=1,
                locale="en",
                subject="Consumer activation pending",
                message=(
                    "Consumer {consumer_user_id} has not activated {product_name} in the app yet."
                ),
            ),
        ]
        self._templates: dict[tuple[str, str], NotificationTemplate] = {
            (item.key, item.locale.lower()): item for item in templates
        }
        self._formatter = _SafeFormatter()

    def render(
        self,
        *,
        template_key: str,
        locale: str,
        payload: dict[str, object],
    ) -> NotificationTemplate:
        normalized = (locale or "en").strip().lower()
        locale_candidates = [normalized]
        if "-" in normalized:
            locale_candidates.append(normalized.split("-", 1)[0])
        locale_candidates.append("en")

        selected: NotificationTemplate | None = None
        for candidate in locale_candidates:
            selected = self._templates.get((template_key, candidate))
            if selected is not None:
                break
        if selected is None:
            selected = NotificationTemplate(
                key=template_key,
                version=1,
                locale="en",
                subject=template_key.replace("_", " ").title(),
                message="{notification_message}",
            )

        subject = self._formatter.format(selected.subject, **payload)
        message = self._formatter.format(selected.message, **payload)
        return NotificationTemplate(
            key=selected.key,
            version=selected.version,
            locale=selected.locale,
            subject=subject,
            message=message,
        )


class NotificationService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.template_engine = TemplateEngine()

    def _utcnow(self) -> datetime:
        return datetime.now(DEFAULT_TIMEZONE)

    def _parse_day_values(self, value: object, *, fallback: list[int]) -> list[int]:
        if isinstance(value, list):
            parsed = [int(float(item)) for item in value if _safe_float(item) is not None]
        elif isinstance(value, str):
            parts = [part.strip() for part in value.split(",")]
            parsed = [int(float(part)) for part in parts if part and _safe_float(part) is not None]
        else:
            parsed = []
        cleaned = sorted({day for day in parsed if day >= 0}, reverse=True)
        return cleaned or fallback

    def _parse_alert_days(self, value: object) -> list[int]:
        return self._parse_day_values(value, fallback=[30, 7, 1])

    def _parse_claim_alert_days(self, value: object) -> list[int]:
        raw = value if value not in (None, "") else self.settings.notification_claim_alert_days
        return self._parse_day_values(raw, fallback=[14, 3])

    def _format_amount(self, value: object) -> str:
        if value is None:
            return "Not available"
        numeric = value
        if isinstance(numeric, Decimal):
            numeric = float(numeric)
        amount = _safe_float(numeric)
        if amount is None:
            return "Not available"
        return f"INR {amount:,.2f}"

    def _upsert_preference(
        self,
        db: Session,
        *,
        user_id: str,
        email: str,
        full_name: str | None,
    ) -> NotificationPreference:
        preference = db.execute(
            select(NotificationPreference)
            .where(NotificationPreference.user_id == user_id)
            .where(NotificationPreference.deleted_at.is_(None))
            .limit(1)
        ).scalar_one_or_none()
        if preference is None:
            preference = NotificationPreference(
                user_id=user_id,
                email=email,
                full_name=full_name,
                in_app_enabled=True,
                email_enabled=True,
                sms_enabled=False,
                push_enabled=True,
                whatsapp_enabled=False,
                alert_days=self._parse_alert_days(self.settings.notification_default_alert_days),
                claim_alert_days=self._parse_claim_alert_days(self.settings.notification_claim_alert_days),
                locale="en",
                timezone="UTC",
            )
        else:
            preference.deleted_at = None
            preference.email = email or preference.email
            if full_name:
                preference.full_name = full_name
            if not isinstance(preference.alert_days, list) or not preference.alert_days:
                preference.alert_days = self._parse_alert_days(self.settings.notification_default_alert_days)
            if not isinstance(preference.claim_alert_days, list) or not preference.claim_alert_days:
                preference.claim_alert_days = self._parse_claim_alert_days(self.settings.notification_claim_alert_days)
        db.add(preference)
        db.flush()
        return preference

    def get_or_create_preference(
        self,
        db: Session,
        *,
        user_id: str,
        email_hint: str | None = None,
        full_name_hint: str | None = None,
    ) -> NotificationPreference:
        email = (email_hint or "").strip()
        if not email:
            email = f"{user_id}@local.safebill"
        return self._upsert_preference(
            db,
            user_id=user_id.strip(),
            email=email,
            full_name=full_name_hint,
        )

    def get_preference(
        self,
        db: Session,
        *,
        user_id: str,
        email_hint: str | None = None,
        full_name_hint: str | None = None,
    ) -> NotificationPreference:
        preference = db.execute(
            select(NotificationPreference).where(NotificationPreference.user_id == user_id).limit(1)
        ).scalar_one_or_none()
        if preference is not None:
            return preference
        fallback_email = (email_hint or "").strip() or f"{user_id}@local.safebill"
        return NotificationPreference(
            user_id=user_id,
            email=fallback_email,
            full_name=full_name_hint,
            in_app_enabled=True,
            email_enabled=True,
            sms_enabled=False,
            push_enabled=True,
            whatsapp_enabled=False,
            alert_days=self._parse_alert_days(self.settings.notification_default_alert_days),
            claim_alert_days=self._parse_claim_alert_days(self.settings.notification_claim_alert_days),
            locale="en",
            timezone="UTC",
        )

    def serialize_preference(self, preference: NotificationPreference) -> dict[str, object]:
        return {
            "userId": preference.user_id,
            "email": preference.email,
            "fullName": preference.full_name,
            "locale": preference.locale,
            "timezone": preference.timezone,
            "inAppEnabled": bool(preference.in_app_enabled),
            "emailEnabled": bool(preference.email_enabled),
            "smsEnabled": bool(preference.sms_enabled),
            "smsNumber": preference.sms_number,
            "pushEnabled": bool(preference.push_enabled),
            "whatsappEnabled": bool(preference.whatsapp_enabled),
            "whatsappNumber": preference.whatsapp_number,
            "alertDays": self._parse_alert_days(preference.alert_days),
            "claimAlertDays": self._parse_claim_alert_days(preference.claim_alert_days),
            "updatedAt": _as_utc(preference.updated_at).isoformat() if preference.updated_at else None,
        }

    def update_preference(
        self,
        db: Session,
        *,
        user_id: str,
        updates: dict[str, object],
        email_hint: str | None = None,
        full_name_hint: str | None = None,
    ) -> NotificationPreference:
        preference = self.get_or_create_preference(
            db,
            user_id=user_id,
            email_hint=email_hint,
            full_name_hint=full_name_hint,
        )
        if updates.get("email") is not None:
            preference.email = str(updates["email"]).strip() or preference.email
        if updates.get("full_name") is not None:
            preference.full_name = str(updates["full_name"]).strip() or None
        if updates.get("locale") is not None:
            preference.locale = str(updates["locale"]).strip()[:32] or preference.locale
        if updates.get("timezone") is not None:
            preference.timezone = str(updates["timezone"]).strip()[:64] or preference.timezone

        for key in (
            "in_app_enabled",
            "email_enabled",
            "sms_enabled",
            "push_enabled",
            "whatsapp_enabled",
        ):
            if updates.get(key) is not None:
                setattr(preference, key, bool(updates[key]))

        if updates.get("sms_number") is not None:
            preference.sms_number = _normalize_phone(str(updates["sms_number"]) if updates["sms_number"] else None)
        if updates.get("whatsapp_number") is not None:
            preference.whatsapp_number = _normalize_phone(
                str(updates["whatsapp_number"]) if updates["whatsapp_number"] else None
            )
        if updates.get("alert_days") is not None:
            preference.alert_days = self._parse_alert_days(updates["alert_days"])
        if updates.get("claim_alert_days") is not None:
            preference.claim_alert_days = self._parse_claim_alert_days(updates["claim_alert_days"])

        db.add(preference)
        db.commit()
        db.refresh(preference)
        return preference

    def _create_or_update_job(
        self,
        db: Session,
        *,
        dedupe_key: str,
        user_id: str,
        document_id,
        channel: str,
        job_type: str,
        event_type: str,
        template_key: str,
        template_version: int,
        recipient_target: str,
        subject: str,
        send_at: datetime,
        payload: dict[str, object],
        status: str,
        priority: int = 5,
        fallback_channel: str | None = None,
    ) -> NotificationJob:
        existing = db.execute(
            select(NotificationJob).where(NotificationJob.dedupe_key == dedupe_key).limit(1)
        ).scalar_one_or_none()
        if existing is not None:
            if existing.status in {STATUS_SENT, STATUS_READ}:
                return existing
            existing.user_id = user_id
            existing.document_id = document_id
            existing.channel = channel
            existing.job_type = job_type
            existing.event_type = event_type
            existing.template_key = template_key
            existing.template_version = template_version
            existing.priority = priority
            existing.fallback_channel = fallback_channel
            existing.recipient_email = recipient_target
            existing.subject = subject
            existing.payload = payload
            existing.send_at = _as_utc(send_at)
            existing.status = status
            existing.last_error = None
            existing.deleted_at = None
            db.add(existing)
            return existing

        job = NotificationJob(
            user_id=user_id,
            document_id=document_id,
            channel=channel,
            job_type=job_type,
            event_type=event_type,
            template_key=template_key,
            template_version=template_version,
            priority=priority,
            fallback_channel=fallback_channel,
            recipient_email=recipient_target,
            subject=subject,
            payload=payload,
            dedupe_key=dedupe_key,
            send_at=_as_utc(send_at),
            status=status,
            retry_count=0,
        )
        db.add(job)
        return job

    def _create_delivery(
        self,
        db: Session,
        *,
        job: NotificationJob,
        attempt_number: int,
        status: str,
        provider_payload: dict[str, object] | None = None,
        provider_message_id: str | None = None,
        error_message: str | None = None,
        latency_ms: int | None = None,
    ) -> None:
        delivery = NotificationDelivery(
            job_id=job.id,
            channel=job.channel,
            attempt_number=attempt_number,
            status=status,
            provider_payload=provider_payload,
            provider_message_id=provider_message_id,
            error_message=(error_message[:1000] if error_message else None),
            latency_ms=latency_ms,
        )
        db.add(delivery)

    def cancel_document_jobs(self, db: Session, *, document_id) -> int:
        jobs = list(
            db.execute(
                select(NotificationJob)
                .where(NotificationJob.document_id == document_id)
                .where(NotificationJob.status.in_(ACTIVE_STATUSES))
                .where(NotificationJob.deleted_at.is_(None))
            ).scalars()
        )
        for job in jobs:
            job.status = STATUS_CANCELED
            db.add(job)
        if jobs:
            db.commit()
        return len(jobs)

    def _derive_warranty_timeline(self, document: Document) -> tuple[date | None, date | None]:
        references = document.references if isinstance(document.references, dict) else {}
        purchase_date = document.date or _safe_date(references.get("warranty_start"))
        warranty_end = _safe_date(references.get("warranty_end"))
        warranty_months = int(_safe_float(references.get("warranty_months")) or 0)
        extended_months = int(_safe_float(references.get("extended_warranty_months")) or 0)
        has_extended = bool(references.get("extended_warranty_purchased"))
        effective_months = warranty_months + (extended_months if has_extended or extended_months > 0 else 0)
        if warranty_end is None and purchase_date and effective_months > 0:
            warranty_end = add_months(purchase_date, effective_months)
        return purchase_date, warranty_end

    def _build_payload(
        self,
        *,
        document: Document,
        consumer_user_id: str,
        consumer_name: str | None,
        merchant_user_id: str | None,
        purchase_date: date | None,
        warranty_end: date | None,
        days_remaining: int | None = None,
        detection_reason: str | None = None,
    ) -> dict[str, object]:
        references = document.references if isinstance(document.references, dict) else {}
        product_name = str(references.get("product_name") or references.get("title") or document.bill_id)
        payload: dict[str, object] = {
            "document_id": str(document.id),
            "bill_id": document.bill_id,
            "product_name": product_name,
            "vendor": document.vendor,
            "consumer_user_id": consumer_user_id,
            "consumer_name": consumer_name or str(references.get("consumer_name") or ""),
            "consumer_email": str(references.get("consumer_email") or ""),
            "merchant_user_id": merchant_user_id or str(references.get("merchant_user_id") or ""),
            "merchant_email": str(references.get("merchant_email") or ""),
            "purchase_date": purchase_date.isoformat() if purchase_date else "",
            "expiry_date": warranty_end.isoformat() if warranty_end else "",
            "total_amount": _safe_float(document.total_amount),
            "total_amount_formatted": self._format_amount(document.total_amount),
        }
        if days_remaining is not None:
            payload["days_remaining"] = days_remaining
        if detection_reason:
            payload["detection_reason"] = detection_reason
        return payload

    def _template_key_for(self, *, event_type: str, recipient_role: str) -> str:
        if recipient_role == "merchant":
            if event_type == EVENT_PRODUCT_ASSIGNED:
                return "merchant_assignment_success"
            if event_type.startswith("WARRANTY_EXPIRY_"):
                return "merchant_warranty_expiry"
            if event_type == EVENT_SUSPICIOUS_OR_DUPLICATE_BILL:
                return "merchant_duplicate_alert"
            if event_type == EVENT_CONSUMER_NOT_ACTIVATED:
                return "merchant_consumer_inactive"
            return "merchant_assignment_success"

        if event_type == EVENT_PRODUCT_ASSIGNED:
            return "consumer_product_assigned"
        if event_type == EVENT_BILL_SCANNED:
            return "consumer_bill_scanned"
        if event_type.startswith("WARRANTY_EXPIRY_"):
            return "consumer_warranty_expiry"
        if event_type == EVENT_WARRANTY_EXPIRED:
            return "consumer_warranty_expired"
        if event_type == EVENT_CLAIM_WINDOW_CLOSING:
            return "consumer_claim_window_closing"
        if event_type == EVENT_SUSPICIOUS_OR_DUPLICATE_BILL:
            return "consumer_duplicate_alert"
        return "consumer_bill_scanned"

    def _resolve_targets(
        self,
        *,
        preference: NotificationPreference,
        user_id: str,
    ) -> dict[str, str]:
        targets: dict[str, str] = {}
        if preference.in_app_enabled:
            targets[CHANNEL_IN_APP] = IN_APP_PLACEHOLDER_EMAIL
        normalized_email = str(preference.email or "").strip().lower()
        can_email = (
            "@" in normalized_email
            and not normalized_email.endswith("@local.safebill")
        )
        if self.settings.email_notifications_enabled and preference.email_enabled and can_email:
            targets[CHANNEL_EMAIL] = preference.email
        if self.settings.sms_notifications_enabled and preference.sms_enabled and preference.sms_number:
            targets[CHANNEL_SMS] = preference.sms_number
        if self.settings.push_notifications_enabled and preference.push_enabled:
            targets[CHANNEL_PUSH] = f"{PUSH_PLACEHOLDER_TARGET}:{user_id}"
        if self.settings.whatsapp_notifications_enabled and preference.whatsapp_enabled and preference.whatsapp_number:
            targets[CHANNEL_WHATSAPP] = preference.whatsapp_number
        return targets

    def _recipient_preferences(
        self,
        db: Session,
        *,
        event_type: str,
        consumer_user_id: str,
        consumer_preference: NotificationPreference,
        merchant_user_id: str | None,
        payload: dict[str, object],
    ) -> list[tuple[str, str, NotificationPreference]]:
        recipients: list[tuple[str, str, NotificationPreference]] = [
            ("consumer", consumer_user_id, consumer_preference)
        ]

        if not merchant_user_id:
            return recipients

        should_notify_merchant = event_type in {
            EVENT_PRODUCT_ASSIGNED,
            EVENT_SUSPICIOUS_OR_DUPLICATE_BILL,
            EVENT_CONSUMER_NOT_ACTIVATED,
        } or event_type.startswith("WARRANTY_EXPIRY_")
        if not should_notify_merchant:
            return recipients

        merchant_email_hint = str(payload.get("merchant_email") or "").strip()
        merchant_preference = self.get_or_create_preference(
            db,
            user_id=merchant_user_id,
            email_hint=merchant_email_hint or None,
            full_name_hint=None,
        )
        recipients.append(("merchant", merchant_user_id, merchant_preference))
        return recipients

    def _emit_event(
        self,
        db: Session,
        *,
        event_type: str,
        event_key: str,
        document: Document,
        payload: dict[str, object],
        consumer_user_id: str,
        consumer_preference: NotificationPreference,
        merchant_user_id: str | None = None,
        send_at: datetime,
    ) -> int:
        existing_event = db.execute(
            select(NotificationEvent).where(NotificationEvent.event_key == event_key).limit(1)
        ).scalar_one_or_none()
        if existing_event is not None:
            return 0

        event = NotificationEvent(
            event_type=event_type,
            event_key=event_key,
            actor_user_id=(merchant_user_id or consumer_user_id),
            subject_user_id=consumer_user_id,
            merchant_user_id=merchant_user_id,
            document_id=document.id,
            payload=payload,
            status="scheduled",
            attempt_count=0,
            processed_at=self._utcnow(),
        )
        db.add(event)

        created_jobs = 0
        for role, target_user_id, preference in self._recipient_preferences(
            db,
            event_type=event_type,
            consumer_user_id=consumer_user_id,
            consumer_preference=consumer_preference,
            merchant_user_id=merchant_user_id,
            payload=payload,
        ):
            template_key = self._template_key_for(event_type=event_type, recipient_role=role)
            rendered = self.template_engine.render(
                template_key=template_key,
                locale=preference.locale or "en",
                payload=payload,
            )
            job_payload = dict(payload)
            job_payload["notification_title"] = rendered.subject
            job_payload["notification_message"] = rendered.message
            job_payload["template_locale"] = rendered.locale

            targets = self._resolve_targets(preference=preference, user_id=target_user_id)
            for channel, recipient in targets.items():
                dedupe_key = f"{event_key}:{role}:{channel}"
                status = STATUS_UNREAD if channel == CHANNEL_IN_APP else STATUS_PENDING
                self._create_or_update_job(
                    db,
                    dedupe_key=dedupe_key,
                    user_id=target_user_id,
                    document_id=document.id,
                    channel=channel,
                    job_type=template_key,
                    event_type=event_type,
                    template_key=template_key,
                    template_version=rendered.version,
                    recipient_target=recipient,
                    subject=rendered.subject,
                    send_at=send_at,
                    payload=job_payload,
                    status=status,
                    priority=1 if event_type == EVENT_SUSPICIOUS_OR_DUPLICATE_BILL else 5,
                )
                created_jobs += 1

        return created_jobs

    def _detect_duplicate_or_suspicious(
        self,
        db: Session,
        *,
        document: Document,
        consumer_user_id: str,
    ) -> list[str]:
        reasons: list[str] = []
        if not document.vendor or document.vendor.upper() == "UNKNOWN_VENDOR":
            reasons.append("vendor_unresolved")
        total_amount = _safe_float(document.total_amount)
        if total_amount is not None and total_amount <= 0:
            reasons.append("non_positive_amount")

        sibling_docs = list(
            db.execute(
                select(Document).where(Document.bill_id == document.bill_id).limit(25)
            ).scalars()
        )
        for sibling in sibling_docs:
            if sibling.id == document.id:
                continue
            sibling_refs = sibling.references if isinstance(sibling.references, dict) else {}
            if str(sibling_refs.get("user_id") or "") == consumer_user_id:
                reasons.append("duplicate_bill_id_for_consumer")
                break

        return sorted(set(reasons))

    def schedule_document_notifications(
        self,
        db: Session,
        *,
        document: Document,
        consumer_user_id: str | None,
        consumer_email: str | None,
        consumer_name: str | None,
        merchant_user_id: str | None = None,
    ) -> int:
        user_id = (consumer_user_id or "").strip()
        if not user_id:
            return 0

        references = document.references if isinstance(document.references, dict) else {}
        resolved_merchant_user_id = (
            merchant_user_id
            or str(references.get("merchant_user_id") or "").strip()
            or None
        )
        consumer_preference = self.get_or_create_preference(
            db,
            user_id=user_id,
            email_hint=(consumer_email or str(references.get("consumer_email") or "")),
            full_name_hint=(consumer_name or str(references.get("consumer_name") or "")),
        )

        now = self._utcnow()
        purchase_date, warranty_end = self._derive_warranty_timeline(document)
        base_payload = self._build_payload(
            document=document,
            consumer_user_id=user_id,
            consumer_name=consumer_name,
            merchant_user_id=resolved_merchant_user_id,
            purchase_date=purchase_date,
            warranty_end=warranty_end,
        )

        created_jobs = 0
        base_event = EVENT_PRODUCT_ASSIGNED if resolved_merchant_user_id else EVENT_BILL_SCANNED
        created_jobs += self._emit_event(
            db,
            event_type=base_event,
            event_key=f"{base_event}:{user_id}:{document.id}",
            document=document,
            payload=base_payload,
            consumer_user_id=user_id,
            consumer_preference=consumer_preference,
            merchant_user_id=resolved_merchant_user_id,
            send_at=now,
        )

        alert_days = self._parse_alert_days(consumer_preference.alert_days)
        claim_alert_days = self._parse_claim_alert_days(consumer_preference.claim_alert_days)
        if warranty_end:
            for day in alert_days:
                if day <= 0:
                    continue
                event_type = f"WARRANTY_EXPIRY_{day}_DAYS"
                trigger_date = warranty_end - timedelta(days=day)
                trigger_time = datetime.combine(trigger_date, time(hour=9, minute=0, tzinfo=DEFAULT_TIMEZONE))
                payload = dict(base_payload)
                payload["days_remaining"] = day
                created_jobs += self._emit_event(
                    db,
                    event_type=event_type,
                    event_key=f"{event_type}:{user_id}:{document.id}",
                    document=document,
                    payload=payload,
                    consumer_user_id=user_id,
                    consumer_preference=consumer_preference,
                    merchant_user_id=resolved_merchant_user_id,
                    send_at=(trigger_time if trigger_time > now else now),
                )

            expiry_time = datetime.combine(warranty_end, time(hour=9, minute=0, tzinfo=DEFAULT_TIMEZONE))
            created_jobs += self._emit_event(
                db,
                event_type=EVENT_WARRANTY_EXPIRED,
                event_key=f"{EVENT_WARRANTY_EXPIRED}:{user_id}:{document.id}",
                document=document,
                payload=base_payload,
                consumer_user_id=user_id,
                consumer_preference=consumer_preference,
                merchant_user_id=resolved_merchant_user_id,
                send_at=(expiry_time if expiry_time > now else now),
            )

            for day in claim_alert_days:
                if day <= 0:
                    continue
                trigger_date = warranty_end - timedelta(days=day)
                trigger_time = datetime.combine(trigger_date, time(hour=9, minute=0, tzinfo=DEFAULT_TIMEZONE))
                payload = dict(base_payload)
                payload["days_remaining"] = day
                created_jobs += self._emit_event(
                    db,
                    event_type=EVENT_CLAIM_WINDOW_CLOSING,
                    event_key=f"{EVENT_CLAIM_WINDOW_CLOSING}:{day}:{user_id}:{document.id}",
                    document=document,
                    payload=payload,
                    consumer_user_id=user_id,
                    consumer_preference=consumer_preference,
                    merchant_user_id=resolved_merchant_user_id,
                    send_at=(trigger_time if trigger_time > now else now),
                )

        reasons = self._detect_duplicate_or_suspicious(
            db,
            document=document,
            consumer_user_id=user_id,
        )
        if reasons:
            payload = dict(base_payload)
            payload["detection_reason"] = ", ".join(reasons)
            created_jobs += self._emit_event(
                db,
                event_type=EVENT_SUSPICIOUS_OR_DUPLICATE_BILL,
                event_key=f"{EVENT_SUSPICIOUS_OR_DUPLICATE_BILL}:{user_id}:{document.id}",
                document=document,
                payload=payload,
                consumer_user_id=user_id,
                consumer_preference=consumer_preference,
                merchant_user_id=resolved_merchant_user_id,
                send_at=now,
            )

        if resolved_merchant_user_id:
            inactive_check_at = now + timedelta(days=3)
            created_jobs += self._emit_event(
                db,
                event_type=EVENT_CONSUMER_NOT_ACTIVATED,
                event_key=f"{EVENT_CONSUMER_NOT_ACTIVATED}:{user_id}:{document.id}",
                document=document,
                payload=base_payload,
                consumer_user_id=user_id,
                consumer_preference=consumer_preference,
                merchant_user_id=resolved_merchant_user_id,
                send_at=inactive_check_at,
            )

        db.commit()
        return created_jobs

    def list_in_app_notifications(
        self,
        db: Session,
        *,
        user_id: str,
        include_read: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, object]]:
        safe_user_id = user_id.strip()
        if not safe_user_id:
            return []

        safe_limit = max(1, min(limit, 500))
        safe_offset = max(0, min(offset, 10_000))
        now = self._utcnow()
        stmt = (
            select(NotificationJob)
            .where(NotificationJob.user_id == safe_user_id)
            .where(NotificationJob.channel == CHANNEL_IN_APP)
            .where(NotificationJob.deleted_at.is_(None))
            .where(NotificationJob.send_at <= now)
            .order_by(NotificationJob.send_at.desc())
            .offset(safe_offset)
            .limit(safe_limit)
        )
        if include_read:
            stmt = stmt.where(NotificationJob.status.in_((STATUS_UNREAD, STATUS_READ)))
        else:
            stmt = stmt.where(NotificationJob.status == STATUS_UNREAD)

        jobs = list(db.execute(stmt).scalars())
        items: list[dict[str, object]] = []
        for job in jobs:
            payload = job.payload if isinstance(job.payload, dict) else {}
            title = str(payload.get("notification_title") or job.subject or "Notification")
            message = str(payload.get("notification_message") or "")
            items.append(
                {
                    "notificationId": str(job.id),
                    "docId": str(job.document_id),
                    "userId": safe_user_id,
                    "channel": CHANNEL_IN_APP,
                    "eventType": str(job.event_type or ""),
                    "type": str(job.job_type or "notification"),
                    "title": title,
                    "message": message,
                    "triggerAt": _as_utc(job.send_at).isoformat(),
                    "readAt": (_as_utc(job.read_at).isoformat() if job.read_at else None),
                    "status": job.status,
                }
            )
        return items

    def mark_in_app_notification_read(
        self,
        db: Session,
        *,
        notification_id: UUID,
        user_id: str,
    ) -> bool:
        job = db.execute(
            select(NotificationJob)
            .where(NotificationJob.id == notification_id)
            .where(NotificationJob.user_id == user_id)
            .where(NotificationJob.channel == CHANNEL_IN_APP)
            .where(NotificationJob.deleted_at.is_(None))
            .limit(1)
        ).scalar_one_or_none()
        if job is None:
            return False
        if job.status != STATUS_READ:
            job.status = STATUS_READ
            job.read_at = self._utcnow()
            db.add(job)
            db.commit()
        return True

    def delete_in_app_notification(
        self,
        db: Session,
        *,
        notification_id: UUID,
        user_id: str,
    ) -> bool:
        job = db.execute(
            select(NotificationJob)
            .where(NotificationJob.id == notification_id)
            .where(NotificationJob.user_id == user_id)
            .where(NotificationJob.channel == CHANNEL_IN_APP)
            .where(NotificationJob.deleted_at.is_(None))
            .limit(1)
        ).scalar_one_or_none()
        if job is None:
            return False
        job.deleted_at = self._utcnow()
        job.status = STATUS_DELETED
        db.add(job)
        db.commit()
        return True

    def _resolve_email_sender(self) -> str:
        raw_sender = (self.settings.email_from or "").strip()
        if not raw_sender:
            raise NotificationDeliveryError(
                "Email sender is not configured. Set EMAIL_FROM.",
                permanent=True,
            )

        parsed_name, parsed_email = parseaddr(raw_sender)
        sender_email = (parsed_email or raw_sender).strip()
        if not _is_valid_email_address(sender_email):
            raise NotificationDeliveryError(
                "Invalid EMAIL_FROM value. Use `email@example.com` or `Name <email@example.com>`.",
                permanent=True,
            )

        sender_name = (parsed_name or "").strip() or (self.settings.email_from_name or "").strip()
        return formataddr((sender_name, sender_email)) if sender_name else sender_email

    def _send_via_ses(
        self,
        *,
        from_value: str,
        recipient_email: str,
        subject: str,
        body: str,
    ) -> dict[str, object]:
        if boto3 is None:
            raise NotificationDeliveryError(
                "boto3 is unavailable for SES delivery.",
                permanent=True,
            )

        region = (self.settings.ses_region or self.settings.aws_region or "").strip()
        if not region:
            raise NotificationDeliveryError(
                "SES region is not configured. Set SES_REGION or AWS_REGION.",
                permanent=True,
            )

        parsed_name, parsed_email = parseaddr(from_value)
        from_address = parsed_email or from_value
        if not _is_valid_email_address(from_address):
            raise NotificationDeliveryError(
                "Invalid SES sender address.",
                permanent=True,
            )
        display_from = formataddr((parsed_name, from_address)) if parsed_name else from_address

        reply_to_addresses: list[str] = []
        raw_reply = str(self.settings.ses_reply_to_addresses or "").strip()
        if raw_reply:
            reply_to_addresses = [item.strip() for item in raw_reply.split(",") if item.strip()]

        request_payload: dict[str, object] = {
            "FromEmailAddress": display_from,
            "Destination": {"ToAddresses": [recipient_email]},
            "Content": {
                "Simple": {
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
                }
            },
        }
        if reply_to_addresses:
            request_payload["ReplyToAddresses"] = reply_to_addresses
        configuration_set = str(self.settings.ses_configuration_set or "").strip()
        if configuration_set:
            request_payload["ConfigurationSetName"] = configuration_set
        source_arn = str(self.settings.ses_source_arn or "").strip()
        if source_arn:
            request_payload["FromEmailAddressIdentityArn"] = source_arn
        from_arn = str(self.settings.ses_from_arn or "").strip()
        if from_arn:
            request_payload["FeedbackForwardingEmailAddressIdentityArn"] = from_arn

        try:
            client = boto3.client("sesv2", region_name=region)
            response = client.send_email(**request_payload)
        except Exception as exc:
            retry_after = None
            status_code = None
            permanent = False
            error_code = ""
            response_obj = getattr(exc, "response", None)
            if isinstance(response_obj, dict):
                metadata = response_obj.get("ResponseMetadata", {})
                if isinstance(metadata, dict):
                    status_code = metadata.get("HTTPStatusCode")
                error_payload = response_obj.get("Error", {})
                if isinstance(error_payload, dict):
                    error_code = str(error_payload.get("Code") or "")
            permanent_codes = {
                "MessageRejected",
                "MailFromDomainNotVerifiedException",
                "AccountSuspendedException",
                "NotAuthorizedException",
                "BadRequestException",
            }
            if error_code in permanent_codes:
                permanent = True
            if isinstance(status_code, int) and 400 <= int(status_code) < 500 and int(status_code) != 429:
                permanent = True
            raise NotificationDeliveryError(
                f"SES send failed: {str(exc)[:400]}",
                status_code=(int(status_code) if isinstance(status_code, int) else None),
                retry_after_seconds=retry_after,
                permanent=permanent,
            ) from exc

        message_id = str(response.get("MessageId") or "").strip() or None
        payload: dict[str, object] = {"provider": "aws_ses", "status_code": 200}
        if message_id:
            payload["message_id"] = message_id[:128]
        return payload

    def _send_email(self, *, recipient_email: str, subject: str, body: str) -> dict[str, object]:
        from_value = self._resolve_email_sender()
        provider = str(self.settings.email_provider or "ses").strip().lower()
        if provider in {"ses", "aws_ses"}:
            return self._send_via_ses(
                from_value=from_value,
                recipient_email=recipient_email,
                subject=subject,
                body=body,
            )

        raise NotificationDeliveryError(
            "Email provider is not configured for AWS SES. Set EMAIL_PROVIDER=ses and SES configuration.",
            permanent=True,
        )

    def _send_sms_via_sns(self, *, recipient: str, message: str) -> dict[str, object]:
        if boto3 is None:
            raise NotificationDeliveryError(
                "boto3 is unavailable for SNS SMS delivery.",
                permanent=True,
            )
        region = (self.settings.sns_region or self.settings.aws_region or "").strip()
        if not region:
            raise NotificationDeliveryError(
                "SNS region is not configured. Set SNS_REGION or AWS_REGION.",
                permanent=True,
            )
        phone_number = _normalize_phone(recipient)
        if not phone_number:
            raise NotificationDeliveryError(
                "Invalid SMS recipient phone number.",
                permanent=True,
            )
        attributes: dict[str, str] = {
            "AWS.SNS.SMS.SMSType": str(self.settings.sns_sms_type or "Transactional").strip() or "Transactional",
        }
        sender_id = str(self.settings.sns_sms_sender_id or "").strip()
        if sender_id:
            attributes["AWS.SNS.SMS.SenderID"] = sender_id[:11]
        try:
            client = boto3.client("sns", region_name=region)
            response = client.publish(
                PhoneNumber=phone_number,
                Message=message,
                MessageAttributes={
                    key: {"DataType": "String", "StringValue": value}
                    for key, value in attributes.items()
                    if value
                },
            )
        except Exception as exc:
            permanent = False
            status_code = None
            response_obj = getattr(exc, "response", None)
            if isinstance(response_obj, dict):
                metadata = response_obj.get("ResponseMetadata", {})
                if isinstance(metadata, dict):
                    raw_status = metadata.get("HTTPStatusCode")
                    if isinstance(raw_status, int):
                        status_code = raw_status
                error_payload = response_obj.get("Error", {})
                code = str(error_payload.get("Code") if isinstance(error_payload, dict) else "").strip()
                if code in {"InvalidParameter", "AuthorizationError", "OptedOut", "ThrottlingException"}:
                    permanent = code in {"InvalidParameter", "AuthorizationError", "OptedOut"}
            if isinstance(status_code, int) and 400 <= status_code < 500 and status_code != 429:
                permanent = True
            raise NotificationDeliveryError(
                f"SNS SMS failed: {str(exc)[:400]}",
                status_code=status_code,
                permanent=permanent,
            ) from exc

        message_id = str(response.get("MessageId") or "").strip() or None
        payload: dict[str, object] = {"provider": "aws_sns_sms", "status_code": 200}
        if message_id:
            payload["message_id"] = message_id[:128]
        return payload

    def _publish_to_sns_topic(
        self,
        *,
        topic_arn: str,
        subject: str,
        message: str,
        attributes: dict[str, str] | None = None,
    ) -> dict[str, object]:
        if boto3 is None:
            raise NotificationDeliveryError("boto3 is unavailable for SNS delivery.", permanent=True)
        region = (self.settings.sns_region or self.settings.aws_region or "").strip()
        if not region:
            raise NotificationDeliveryError("SNS region is not configured.", permanent=True)
        if not topic_arn:
            raise NotificationDeliveryError("SNS topic ARN is not configured.", permanent=True)
        try:
            client = boto3.client("sns", region_name=region)
            response = client.publish(
                TopicArn=topic_arn,
                Subject=subject[:100] if subject else "SafeBill Notification",
                Message=message,
                MessageAttributes={
                    key: {"DataType": "String", "StringValue": value}
                    for key, value in (attributes or {}).items()
                    if value
                },
            )
        except Exception as exc:
            raise NotificationDeliveryError(
                f"SNS publish failed: {str(exc)[:400]}",
                permanent=False,
            ) from exc

        message_id = str(response.get("MessageId") or "").strip() or None
        payload: dict[str, object] = {"provider": "aws_sns", "status_code": 200}
        if message_id:
            payload["message_id"] = message_id[:128]
        return payload

    def _send_notification_job(self, job: NotificationJob) -> dict[str, object]:
        payload = job.payload if isinstance(job.payload, dict) else {}
        message = str(payload.get("notification_message") or "")
        if not message:
            message = "You have a new SafeBill notification."

        if job.channel == CHANNEL_EMAIL:
            body = (
                f"{message}\n\n"
                f"Product: {payload.get('product_name', '-')}\n"
                f"Invoice: {payload.get('bill_id', '-')}\n"
                f"Warranty Expiry: {payload.get('expiry_date', '-')}\n"
                f"Amount: {payload.get('total_amount_formatted', '-')}\n\n"
                "Regards,\nSafeBill"
            )
            return self._send_email(recipient_email=job.recipient_email, subject=job.subject, body=body)

        if job.channel == CHANNEL_SMS:
            sms_provider = str(self.settings.sms_provider or "sns").strip().lower()
            if sms_provider in {"sns", "aws_sns"}:
                sms_text = f"{job.subject}\n{message}"
                return self._send_sms_via_sns(recipient=job.recipient_email, message=sms_text[:1400])
            raise NotificationDeliveryError("Unsupported SMS provider.", permanent=True)

        if job.channel == CHANNEL_PUSH:
            push_provider = str(self.settings.push_provider or "sns").strip().lower()
            if push_provider not in {"sns", "aws_sns"}:
                raise NotificationDeliveryError("Unsupported push provider.", permanent=True)
            topic_arn = str(self.settings.sns_push_topic_arn or "").strip()
            message = json.dumps(
                {
                    "recipient": job.recipient_email,
                    "subject": job.subject,
                    "payload": payload,
                    "job_id": str(job.id),
                    "event_type": job.event_type,
                },
                ensure_ascii=True,
            )
            return self._publish_to_sns_topic(
                topic_arn=topic_arn,
                subject=(job.subject or "SafeBill Push")[:100],
                message=message,
                attributes={"channel": "push"},
            )

        if job.channel == CHANNEL_WHATSAPP:
            whatsapp_provider = str(self.settings.whatsapp_provider or "sns").strip().lower()
            if whatsapp_provider not in {"sns", "aws_sns"}:
                raise NotificationDeliveryError("Unsupported WhatsApp provider.", permanent=True)
            topic_arn = str(self.settings.sns_whatsapp_topic_arn or "").strip()
            message = json.dumps(
                {
                    "recipient": job.recipient_email,
                    "subject": job.subject,
                    "payload": payload,
                    "job_id": str(job.id),
                    "event_type": job.event_type,
                },
                ensure_ascii=True,
            )
            return self._publish_to_sns_topic(
                topic_arn=topic_arn,
                subject=(job.subject or "SafeBill WhatsApp")[:100],
                message=message,
                attributes={"channel": "whatsapp"},
            )

        raise RuntimeError(f"Unsupported notification channel: {job.channel}")

    def _queue_fallback_sms(self, db: Session, *, job: NotificationJob, error_message: str) -> bool:
        if not self.settings.sms_notifications_enabled:
            return False
        preference = db.execute(
            select(NotificationPreference)
            .where(NotificationPreference.user_id == job.user_id)
            .where(NotificationPreference.deleted_at.is_(None))
            .limit(1)
        ).scalar_one_or_none()
        if (
            preference is None
            or not preference.sms_enabled
            or not preference.sms_number
        ):
            return False
        payload = job.payload if isinstance(job.payload, dict) else {}
        fallback_payload = dict(payload)
        fallback_payload["fallback_from"] = CHANNEL_EMAIL
        fallback_payload["fallback_error"] = error_message[:300]
        self._create_or_update_job(
            db,
            dedupe_key=f"{job.dedupe_key}:fallback:sms",
            user_id=job.user_id,
            document_id=job.document_id,
            channel=CHANNEL_SMS,
            job_type=(job.job_type or "fallback_sms"),
            event_type=(job.event_type or ""),
            template_key=(job.template_key or "fallback_sms"),
            template_version=int(job.template_version or 1),
            recipient_target=preference.sms_number,
            subject=job.subject,
            send_at=self._utcnow(),
            payload=fallback_payload,
            status=STATUS_PENDING,
            priority=1,
            fallback_channel=CHANNEL_EMAIL,
        )
        return True

    def _consumer_has_activated(self, db: Session, *, document_id: UUID) -> bool:
        document = db.get(Document, document_id)
        if document is None:
            return False
        references = document.references if isinstance(document.references, dict) else {}
        return bool(references.get("consumer_activated_at"))

    def process_due_jobs(self, db: Session, *, limit: int | None = None) -> dict[str, int | str]:
        batch_size = int(limit or self.settings.notification_worker_batch_size)
        safe_batch_size = max(1, min(batch_size, 500))
        max_retries = max(1, int(self.settings.notification_max_retries))
        backoff_minutes = max(1, int(self.settings.notification_retry_backoff_minutes))

        now = self._utcnow()
        stmt = (
            select(NotificationJob)
            .where(NotificationJob.status.in_(PENDING_STATUSES))
            .where(NotificationJob.send_at <= now)
            .where(NotificationJob.retry_count < max_retries)
            .where(NotificationJob.channel != CHANNEL_IN_APP)
            .where(NotificationJob.deleted_at.is_(None))
            .order_by(NotificationJob.priority.asc(), NotificationJob.send_at.asc())
            .limit(safe_batch_size)
        )
        try:
            stmt = stmt.with_for_update(skip_locked=True)
        except Exception:
            pass

        jobs = list(db.execute(stmt).scalars())
        sent = 0
        failed = 0
        dead_lettered = 0

        for job in jobs:
            if job.event_type == EVENT_CONSUMER_NOT_ACTIVATED and self._consumer_has_activated(
                db, document_id=job.document_id
            ):
                job.status = STATUS_CANCELED
                db.add(job)
                continue

            attempt_number = int(job.retry_count or 0) + 1
            started_at = perf_counter()
            try:
                provider_payload = self._send_notification_job(job)
                latency_ms = int((perf_counter() - started_at) * 1000)
                job.status = STATUS_SENT
                job.sent_at = self._utcnow()
                job.last_error = None
                self._create_delivery(
                    db,
                    job=job,
                    attempt_number=attempt_number,
                    status=STATUS_SENT,
                    provider_payload=provider_payload,
                    provider_message_id=(
                        str(provider_payload.get("message_id"))
                        if isinstance(provider_payload, dict) and provider_payload.get("message_id")
                        else None
                    ),
                    latency_ms=latency_ms,
                )
                sent += 1
            except Exception as exc:
                error_text = str(exc)
                latency_ms = int((perf_counter() - started_at) * 1000)
                delivery_error = exc if isinstance(exc, NotificationDeliveryError) else None
                status_code = delivery_error.status_code if delivery_error else None
                is_permanent_failure = bool(delivery_error and delivery_error.permanent)
                if (
                    not is_permanent_failure
                    and status_code is not None
                    and 400 <= int(status_code) < 500
                    and int(status_code) != 429
                ):
                    is_permanent_failure = True

                job.last_error = error_text[:1000]
                logger.warning(
                    "notification_job_failed job_id=%s channel=%s event_type=%s attempt=%s error=%s",
                    str(job.id),
                    str(job.channel),
                    str(job.event_type or ""),
                    attempt_number,
                    error_text[:240],
                )
                if is_permanent_failure:
                    job.retry_count = max_retries
                    job.status = STATUS_DEAD_LETTER
                    dead_lettered += 1
                else:
                    job.retry_count = int(job.retry_count or 0) + 1
                    if job.retry_count >= max_retries:
                        job.status = STATUS_DEAD_LETTER
                        dead_lettered += 1
                    else:
                        delay_multiplier = 2 ** max(job.retry_count - 1, 0)
                        delay_seconds = backoff_minutes * 60 * delay_multiplier
                        retry_after_seconds = delivery_error.retry_after_seconds if delivery_error else None
                        if retry_after_seconds and retry_after_seconds > 0:
                            delay_seconds = max(delay_seconds, int(retry_after_seconds))
                        job.status = STATUS_PENDING
                        job.send_at = self._utcnow() + timedelta(seconds=delay_seconds)
                self._create_delivery(
                    db,
                    job=job,
                    attempt_number=attempt_number,
                    status=STATUS_FAILED,
                    provider_payload=None,
                    error_message=error_text,
                    latency_ms=latency_ms,
                )
                if job.channel == CHANNEL_EMAIL:
                    self._queue_fallback_sms(db, job=job, error_message=error_text)
                failed += 1
            db.add(job)

        if jobs:
            db.commit()

        return {
            "processed": len(jobs),
            "sent": sent,
            "failed": failed,
            "deadLettered": dead_lettered,
        }

    def get_delivery_analytics(
        self,
        db: Session,
        *,
        user_id: str | None,
        window_days: int = 30,
    ) -> dict[str, Any]:
        safe_days = max(1, min(window_days, 365))
        since = self._utcnow() - timedelta(days=safe_days)

        delivery_stmt = (
            select(NotificationDelivery, NotificationJob)
            .join(NotificationJob, NotificationDelivery.job_id == NotificationJob.id)
            .where(NotificationDelivery.created_at >= since)
        )
        if user_id:
            delivery_stmt = delivery_stmt.where(NotificationJob.user_id == user_id)
        delivery_rows = list(db.execute(delivery_stmt).all())

        total_attempts = len(delivery_rows)
        successful_deliveries = sum(1 for row in delivery_rows if row[0].status == STATUS_SENT)
        failed_deliveries = sum(1 for row in delivery_rows if row[0].status == STATUS_FAILED)
        channel_buckets: dict[str, dict[str, int]] = {}
        bounce_events = 0
        spam_events = 0
        failover_jobs: set[str] = set()

        for delivery, job in delivery_rows:
            channel = str(delivery.channel or job.channel or "unknown")
            bucket = channel_buckets.setdefault(
                channel,
                {"attempts": 0, "sent": 0, "failed": 0, "dead_lettered": 0},
            )
            bucket["attempts"] += 1
            status = str(delivery.status or "").lower()
            if status == STATUS_SENT:
                bucket["sent"] += 1
            elif status == STATUS_DEAD_LETTER:
                bucket["dead_lettered"] += 1
            else:
                bucket["failed"] += 1

            provider_payload = delivery.provider_payload if isinstance(delivery.provider_payload, dict) else {}
            provider_status = str(provider_payload.get("status") or provider_payload.get("event_type") or "").lower()
            if "bounce" in provider_status or status == "bounced":
                bounce_events += 1
            if "spam" in provider_status or "complaint" in provider_status:
                spam_events += 1
            job_payload = job.payload if isinstance(job.payload, dict) else {}
            if job_payload.get("fallback_from"):
                failover_jobs.add(str(job.id))

        dead_letter_stmt = select(func.count(NotificationJob.id)).where(
            NotificationJob.status == STATUS_DEAD_LETTER,
            NotificationJob.created_at >= since,
        )
        if user_id:
            dead_letter_stmt = dead_letter_stmt.where(NotificationJob.user_id == user_id)
        dead_lettered = int(db.execute(dead_letter_stmt).scalar_one_or_none() or 0)

        in_app_total_stmt = select(func.count(NotificationJob.id)).where(
            NotificationJob.channel == CHANNEL_IN_APP,
            NotificationJob.deleted_at.is_(None),
            NotificationJob.send_at <= self._utcnow(),
            NotificationJob.created_at >= since,
        )
        in_app_read_stmt = select(func.count(NotificationJob.id)).where(
            NotificationJob.channel == CHANNEL_IN_APP,
            NotificationJob.status == STATUS_READ,
            NotificationJob.deleted_at.is_(None),
            NotificationJob.created_at >= since,
        )
        if user_id:
            in_app_total_stmt = in_app_total_stmt.where(NotificationJob.user_id == user_id)
            in_app_read_stmt = in_app_read_stmt.where(NotificationJob.user_id == user_id)

        in_app_total = int(db.execute(in_app_total_stmt).scalar_one_or_none() or 0)
        in_app_read = int(db.execute(in_app_read_stmt).scalar_one_or_none() or 0)

        success_rate = (successful_deliveries / total_attempts) if total_attempts else 0.0
        open_rate = (in_app_read / in_app_total) if in_app_total else 0.0
        bounce_rate = (bounce_events / total_attempts) if total_attempts else 0.0
        spam_rate = (spam_events / total_attempts) if total_attempts else 0.0
        channel_stats = []
        for channel, bucket in sorted(channel_buckets.items()):
            attempts = bucket["attempts"]
            channel_stats.append(
                {
                    "channel": channel,
                    "attempts": attempts,
                    "sent": bucket["sent"],
                    "failed": bucket["failed"],
                    "deadLettered": bucket["dead_lettered"],
                    "successRate": round((bucket["sent"] / attempts) if attempts else 0.0, 4),
                }
            )

        return {
            "windowDays": safe_days,
            "totalAttempts": total_attempts,
            "successfulDeliveries": successful_deliveries,
            "failedDeliveries": failed_deliveries,
            "deadLettered": dead_lettered,
            "successRate": round(success_rate, 4),
            "openRate": round(open_rate, 4),
            "clickRate": 0.0,
            "bounceRate": round(bounce_rate, 4),
            "spamComplaintRate": round(spam_rate, 4),
            "failoverTriggered": len(failover_jobs),
            "channelStats": channel_stats,
        }
