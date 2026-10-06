from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import httpx
import requests

try:
    from google.auth.transport.requests import Request as GoogleAuthRequest
    from google.oauth2 import service_account
except Exception:  # pragma: no cover - optional runtime dependency
    GoogleAuthRequest = None  # type: ignore[assignment]
    service_account = None  # type: ignore[assignment]


@dataclass
class ServiceCenterCandidate:
    name: str
    address: str
    latitude: float | None
    longitude: float | None
    distance_km: float | None
    source: str = "brand_directory"
    confidence: str = "verified"
    map_url: str | None = None
    city: str | None = None
    phone: str | None = None
    website: str | None = None
    pincode: str | None = None
    pickup_available: bool | None = None
    estimated_tat_days: int | None = None


class ServiceCenterLocator:
    GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
    NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
    OVERPASS_URLS = (
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
    )
    USER_AGENT = "SafeBill-ServiceCenterLocator/1.0"
    DEFAULT_TIMEOUT_SECONDS = 8.0
    OVERPASS_CLIENT_TIMEOUT_SECONDS = 10.0
    OVERPASS_QUERY_TIMEOUT_SECONDS = 16
    DEFAULT_LIMIT = 5
    DEFAULT_RADIUS_KM = 30.0
    MAX_RADIUS_KM = 100.0
    DIRECTORY_FILENAME = "service_center_directory.json"

    SERVICE_CENTER_HINTS = (
        "service center",
        "service centre",
        "nearest service",
        "authorized service",
        "repair center",
        "repair centre",
        "support center",
        "customer care center",
    )

    INVALID_COMPANY_TOKENS = {"", "unknown", "unknown_vendor", "service center", "service centre"}
    SOURCE_PRIORITY = {
        "brand_directory": 0,
        "official_support": 1,
        "openstreetmap_overpass": 2,
        "google_maps": 3,
        "openstreetmap_nominatim": 4,
    }
    CORPORATE_SUFFIX_TOKENS = {
        "inc",
        "inc.",
        "corp",
        "corp.",
        "corporation",
        "company",
        "co",
        "co.",
        "ltd",
        "ltd.",
        "limited",
        "private",
        "pvt",
        "pvt.",
        "llc",
        "llp",
        "plc",
    }
    BRAND_DESCRIPTOR_TOKENS = {
        "india",
        "electronics",
        "electronic",
        "appliances",
        "appliance",
        "technology",
        "technologies",
        "digital",
        "devices",
        "device",
        "systems",
        "system",
        "retail",
        "store",
        "stores",
        "care",
    }
    OFFICIAL_SUPPORT_LINKS: dict[str, dict[str, str | None]] = {
        "apple": {
            "name": "Apple Support",
            "website": "https://support.apple.com/en-in/repair",
            "phone": None,
        },
        "samsung": {
            "name": "Samsung Support",
            "website": "https://www.samsung.com/in/support/service-center/",
            "phone": "+91-1800-40-7267864",
        },
        "lg": {
            "name": "LG Support",
            "website": "https://www.lg.com/in/support/repair-warranty",
            "phone": "+91-1800-315-9999",
        },
        "sony": {
            "name": "Sony Support",
            "website": "https://www.sony.co.in/electronics/support",
            "phone": None,
        },
        "xiaomi": {
            "name": "Xiaomi Support",
            "website": "https://www.mi.com/in/service/repair/",
            "phone": None,
        },
        "oneplus": {
            "name": "OnePlus Support",
            "website": "https://www.oneplus.in/support",
            "phone": None,
        },
        "dell": {
            "name": "Dell Support",
            "website": "https://www.dell.com/support/home/en-in",
            "phone": None,
        },
        "hp": {
            "name": "HP Support",
            "website": "https://support.hp.com/in-en",
            "phone": None,
        },
        "lenovo": {
            "name": "Lenovo Support",
            "website": "https://support.lenovo.com/in/en/repair-status",
            "phone": None,
        },
    }
    SERVICE_SIGNAL = re.compile(r"\b(service|centre|center|repair|support|care|authorized|authorised)\b", re.I)
    PINCODE_SIGNAL = re.compile(r"\b([1-9][0-9]{5})\b")
    INDIA_LOCATION_HINTS: dict[str, tuple[float, float]] = {
        "delhi": (28.6139, 77.2090),
        "new delhi": (28.6139, 77.2090),
        "mumbai": (19.0760, 72.8777),
        "maharashtra": (19.7515, 75.7139),
        "bangalore": (12.9716, 77.5946),
        "bengaluru": (12.9716, 77.5946),
        "karnataka": (15.3173, 75.7139),
        "chennai": (13.0827, 80.2707),
        "tamil nadu": (11.1271, 78.6569),
        "hyderabad": (17.3850, 78.4867),
        "telangana": (18.1124, 79.0193),
        "kolkata": (22.5726, 88.3639),
        "west bengal": (22.9868, 87.8550),
        "ahmedabad": (23.0225, 72.5714),
        "gujarat": (22.2587, 71.1924),
        "pune": (18.5204, 73.8567),
        "jaipur": (26.9124, 75.7873),
        "rajasthan": (27.0238, 74.2179),
        "lucknow": (26.8467, 80.9462),
        "uttar pradesh": (26.8467, 80.9462),
        "bhopal": (23.2599, 77.4126),
        "madhya pradesh": (22.9734, 78.6569),
        "patna": (25.5941, 85.1376),
        "bihar": (25.0961, 85.3131),
        "chandigarh": (30.7333, 76.7794),
        "punjab": (31.1471, 75.3412),
        "haryana": (29.0588, 76.0856),
        "bhubaneswar": (20.2961, 85.8245),
        "odisha": (20.9517, 85.0985),
        "kochi": (9.9312, 76.2673),
        "kerala": (10.8505, 76.2711),
        "thiruvananthapuram": (8.5241, 76.9366),
        "indore": (22.7196, 75.8577),
        "nagpur": (21.1458, 79.0882),
        "surat": (21.1702, 72.8311),
        "noida": (28.5355, 77.3910),
        "gurugram": (28.4595, 77.0266),
        "ghaziabad": (28.6692, 77.4538),
        "faridabad": (28.4089, 77.3178),
        "goa": (15.2993, 74.1240),
        "assam": (26.2006, 92.9376),
        "guwahati": (26.1445, 91.7362),
        "jammu": (32.7266, 74.8570),
        "srinagar": (34.0837, 74.7973),
        "jammu and kashmir": (33.7782, 76.5762),
        "himachal pradesh": (31.1048, 77.1734),
        "shimla": (31.1048, 77.1734),
        "uttarakhand": (30.0668, 79.0193),
        "dehradun": (30.3165, 78.0322),
        "andhra pradesh": (15.9129, 79.7400),
        "vijayawada": (16.5062, 80.6480),
        "visakhapatnam": (17.6868, 83.2185),
    }
    PINCODE_HINTS: dict[str, tuple[float, float, str, str]] = {
        "560001": (12.9791, 77.5913, "Bengaluru", "Karnataka"),
        "110001": (28.6315, 77.2167, "New Delhi", "Delhi"),
        "400001": (18.9388, 72.8354, "Mumbai", "Maharashtra"),
        "600001": (13.0827, 80.2707, "Chennai", "Tamil Nadu"),
        "700001": (22.5726, 88.3639, "Kolkata", "West Bengal"),
        "500001": (17.3850, 78.4867, "Hyderabad", "Telangana"),
        "411001": (18.5204, 73.8567, "Pune", "Maharashtra"),
        "380001": (23.0225, 72.5714, "Ahmedabad", "Gujarat"),
        "682001": (9.9312, 76.2673, "Kochi", "Kerala"),
        "695001": (8.5241, 76.9366, "Thiruvananthapuram", "Kerala"),
    }

    def __init__(
        self,
        google_maps_api_key: str | None = None,
        *,
        enable_google_lookup: bool = False,
        live_lookup_enabled: bool = False,
        google_credentials_file: str | None = None,
        google_oauth_scope: str | None = None,
        directory_path: str | None = None,
        directory_entries: list[dict[str, Any]] | None = None,
    ) -> None:
        self.google_maps_api_key = (google_maps_api_key or "").strip()
        self.google_credentials_file = (google_credentials_file or "").strip()
        self.google_oauth_scope = (google_oauth_scope or "").strip() or "https://www.googleapis.com/auth/cloud-platform"
        self.live_lookup_enabled = bool(live_lookup_enabled)
        self.enable_google_lookup = bool(enable_google_lookup and (self.google_maps_api_key or self.google_credentials_file))
        self.directory_entries = (
            self._load_directory_entries(directory_path=directory_path)
            if directory_entries is None
            else directory_entries
        )

    @classmethod
    def is_service_center_query(cls, query: str) -> bool:
        lowered = query.lower()
        if any(token in lowered for token in cls.SERVICE_CENTER_HINTS):
            return True
        return "nearest" in lowered and ("service" in lowered or "repair" in lowered)

    @classmethod
    def normalize_company_name(cls, value: str | None) -> str | None:
        if not value:
            return None
        cleaned = re.sub(r"\s+", " ", value).strip(" ,.-:!?")
        if not cleaned:
            return None
        cleaned = re.sub(r"(?i)^\s*the\s+", "", cleaned).strip()
        tokens = [token for token in cleaned.split(" ") if token]
        while len(tokens) > 1:
            tail = tokens[-1].strip(".,").lower()
            if tail in cls.CORPORATE_SUFFIX_TOKENS or tail in cls.BRAND_DESCRIPTOR_TOKENS or tail == "of":
                tokens.pop()
                continue
            break
        if tokens:
            cleaned = " ".join(tokens).strip(" ,.-:!?")
        if not cleaned:
            return None
        lowered = cleaned.lower()
        if lowered in cls.INVALID_COMPANY_TOKENS:
            return None
        return cleaned[:120]

    @staticmethod
    def _maps_search_url(query: str) -> str:
        return f"https://www.google.com/maps/search/?api=1&query={quote_plus(query)}"

    def _official_support_fallbacks(
        self,
        *,
        company_name: str,
        location_hint: str | None,
        anchor_latitude: float | None,
        anchor_longitude: float | None,
        limit: int,
    ) -> list[ServiceCenterCandidate]:
        if limit <= 0:
            return []

        normalized_key = self._normalize_text(company_name)
        if not normalized_key:
            return []
        brand_key = normalized_key.split(" ", 1)[0]
        official = self.OFFICIAL_SUPPORT_LINKS.get(brand_key, {})
        place_label = (location_hint or "your area").strip()
        maps_query = f"{company_name} authorized service center {place_label}".strip()
        website = str(official.get("website") or "").strip() or None
        phone = str(official.get("phone") or "").strip() or None
        support_name = str(official.get("name") or f"{company_name} Support").strip()
        address = (
            f"Use the official {company_name} support channel to locate an authorized service provider near {place_label}."
            if place_label
            else f"Use the official {company_name} support channel to locate an authorized service provider."
        )
        fallback = ServiceCenterCandidate(
            name=support_name,
            address=address,
            latitude=anchor_latitude,
            longitude=anchor_longitude,
            distance_km=None,
            source="official_support",
            confidence="official",
            map_url=self._maps_search_url(maps_query),
            city=place_label if place_label and place_label.lower() != "your area" else None,
            phone=phone,
            website=website,
            pincode=self.parse_pincode(place_label),
            pickup_available=None,
            estimated_tat_days=None,
        )
        return [fallback][:limit]

    @classmethod
    def parse_radius_km(cls, query: str, default_km: float | None = None) -> float:
        default_radius = cls.DEFAULT_RADIUS_KM if default_km is None else default_km
        safe_default = max(1.0, min(default_radius, cls.MAX_RADIUS_KM))
        if not query:
            return safe_default
        patterns = (
            r"(?i)\bwithin\s+(\d+(?:\.\d+)?)\s*(km|kms|kilometer|kilometers|mile|miles)\b",
            r"(?i)\b(\d+(?:\.\d+)?)\s*(km|kms|kilometer|kilometers|mile|miles)\s*(?:radius|range)?\b",
        )
        for pattern in patterns:
            match = re.search(pattern, query)
            if not match:
                continue
            value = float(match.group(1))
            unit = match.group(2).lower()
            if unit.startswith("mile"):
                value *= 1.60934
            return round(max(1.0, min(value, cls.MAX_RADIUS_KM)), 2)
        return safe_default

    @classmethod
    def parse_pincode(cls, value: str | None) -> str | None:
        if not value:
            return None
        match = cls.PINCODE_SIGNAL.search(value)
        if not match:
            return None
        return match.group(1)

    @staticmethod
    def _normalize_text(value: str | None) -> str:
        if not value:
            return ""
        lowered = value.lower()
        lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
        return re.sub(r"\s+", " ", lowered).strip()

    @staticmethod
    def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        earth_radius_km = 6371.0
        lat1_rad = math.radians(lat1)
        lon1_rad = math.radians(lon1)
        lat2_rad = math.radians(lat2)
        lon2_rad = math.radians(lon2)
        dlat = lat2_rad - lat1_rad
        dlon = lon2_rad - lon1_rad
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return earth_radius_km * c

    @classmethod
    def _default_directory_path(cls) -> Path:
        return Path(__file__).resolve().parents[1] / "data" / cls.DIRECTORY_FILENAME

    @classmethod
    def _load_directory_entries(cls, directory_path: str | None) -> list[dict[str, Any]]:
        raw_path = directory_path.strip() if isinstance(directory_path, str) else ""
        candidate_path = Path(raw_path) if raw_path else cls._default_directory_path()
        if not candidate_path.exists():
            return []
        try:
            payload = json.loads(candidate_path.read_text(encoding="utf-8"))
        except Exception:
            return []
        return [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []

    @staticmethod
    def _openstreetmap_url(latitude: float, longitude: float) -> str:
        return f"https://www.openstreetmap.org/?mlat={latitude:.6f}&mlon={longitude:.6f}#map=16/{latitude:.6f}/{longitude:.6f}"

    @staticmethod
    def _google_map_url(name: str, address: str, place_id: str | None = None) -> str:
        query = quote_plus(address or name)
        if place_id:
            return f"https://www.google.com/maps/search/?api=1&query={query}&query_place_id={quote_plus(place_id)}"
        return f"https://www.google.com/maps/search/?api=1&query={query}"

    def _google_places_auth_headers(self) -> dict[str, str]:
        if self.google_maps_api_key:
            return {"X-Goog-Api-Key": self.google_maps_api_key}
        if not self.google_credentials_file or service_account is None or GoogleAuthRequest is None:
            return {}
        try:
            session = requests.Session()
            session.trust_env = False
            creds = service_account.Credentials.from_service_account_file(
                self.google_credentials_file,
                scopes=[self.google_oauth_scope],
            )
            creds.refresh(GoogleAuthRequest(session=session))
            token = str(creds.token or "").strip()
            project_id = str(getattr(creds, "project_id", "") or "").strip()
        except Exception:
            return {}
        if not token or not project_id:
            return {}
        return {
            "Authorization": f"Bearer {token}",
            "X-Goog-User-Project": project_id,
        }

    def _matches_company(self, company_name: str, name: str, address: str) -> bool:
        normalized_company = self._normalize_text(company_name)
        haystack = self._normalize_text(f"{name} {address}")
        if not normalized_company or not haystack:
            return False
        if len(normalized_company) <= 3:
            return re.search(rf"\b{re.escape(normalized_company)}\b", haystack) is not None
        if normalized_company in haystack:
            return True
        tokens = [token for token in normalized_company.split(" ") if len(token) >= 2]
        for token in tokens:
            if len(token) <= 2:
                if re.search(rf"\b{re.escape(token)}\b", haystack):
                    return True
            elif token in haystack:
                return True
        return False

    def _location_match(
        self,
        location_hint: str | None,
        *,
        city: str | None,
        address: str,
        pincode: str | None = None,
    ) -> bool:
        if not location_hint:
            return True
        hint = self._normalize_text(location_hint)
        if not hint:
            return True
        hint_pincode = self.parse_pincode(hint)
        if hint_pincode:
            known_pincode = self.parse_pincode(pincode) or self._extract_pincode_from_address(address)
            if known_pincode:
                if known_pincode == hint_pincode:
                    return True
                # Relax exact pincode constraint to sorting-district level (first 3 digits)
                # so nearby authorized centers are not hidden for the same city cluster.
                if known_pincode[:3] == hint_pincode[:3]:
                    return True
                return False
            # If center pincode is unknown, defer to radius/city heuristics instead of hard fail.
            return True
        city_norm = self._normalize_text(city)
        address_norm = self._normalize_text(address)
        haystack = f"{city_norm} {address_norm}".strip()
        if hint in haystack:
            return True
        compact_hint = re.sub(r"[aeiou]", "", hint)
        compact_haystack = re.sub(r"[aeiou]", "", haystack)
        if compact_hint and compact_hint in compact_haystack:
            return True
        return SequenceMatcher(None, hint, haystack).ratio() >= 0.72

    @staticmethod
    def _bbox_from_radius(latitude: float, longitude: float, radius_km: float) -> tuple[float, float, float, float]:
        lat_delta = radius_km / 111.0
        lon_delta = radius_km / (111.0 * max(0.2, abs(math.cos(math.radians(latitude)))))
        south = max(-90.0, latitude - lat_delta)
        north = min(90.0, latitude + lat_delta)
        west = max(-180.0, longitude - lon_delta)
        east = min(180.0, longitude + lon_delta)
        return south, west, north, east

    def _geocode_location(self, location_hint: str | None) -> tuple[float, float] | None:
        if not location_hint or not location_hint.strip():
            return None
        headers = {"User-Agent": self.USER_AGENT}
        for query in (f"{location_hint.strip()}, India", location_hint.strip()):
            try:
                with httpx.Client(timeout=self.DEFAULT_TIMEOUT_SECONDS, headers=headers) as client:
                    response = client.get(
                        self.NOMINATIM_SEARCH_URL,
                        params={"q": query, "format": "jsonv2", "limit": 1},
                    )
                    response.raise_for_status()
                    payload = response.json()
            except Exception:
                continue
            if isinstance(payload, list) and payload:
                item = payload[0] if isinstance(payload[0], dict) else {}
                try:
                    return float(item.get("lat")), float(item.get("lon"))
                except (TypeError, ValueError):
                    continue
        return None

    def _fallback_anchor_for_location_hint(self, location_hint: str | None) -> tuple[float, float] | None:
        normalized_hint = self._normalize_text(location_hint)
        if not normalized_hint:
            return None
        pincode = self.parse_pincode(normalized_hint)
        if pincode and pincode in self.PINCODE_HINTS:
            lat, lon, _, _ = self.PINCODE_HINTS[pincode]
            return lat, lon
        if normalized_hint in self.INDIA_LOCATION_HINTS:
            return self.INDIA_LOCATION_HINTS[normalized_hint]
        for key, value in self.INDIA_LOCATION_HINTS.items():
            if key in normalized_hint or normalized_hint in key:
                return value
        return None

    @classmethod
    def _extract_pincode_from_address(cls, value: str | None) -> str | None:
        if not value:
            return None
        match = cls.PINCODE_SIGNAL.search(value)
        if not match:
            return None
        return match.group(1)

    @staticmethod
    def _coerce_bool(value: object) -> bool | None:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"true", "1", "yes", "y"}:
                return True
            if lowered in {"false", "0", "no", "n"}:
                return False
        return None

    def _infer_pickup_available(
        self,
        *,
        source: str,
        confidence: str,
        name: str,
        address: str,
        website: str | None,
        explicit_flag: bool | None = None,
    ) -> bool | None:
        if explicit_flag is not None:
            return explicit_flag
        combined = self._normalize_text(f"{name} {address} {website or ''}")
        if combined and any(token in combined for token in ("pickup", "pick up", "doorstep", "home service")):
            return True
        if source == "brand_directory" and confidence in {"verified", "curated"}:
            return True
        return None

    @staticmethod
    def _estimate_tat_days(*, source: str, confidence: str, distance_km: float | None) -> int:
        if source == "brand_directory":
            base = 4
        elif source == "google_maps":
            base = 5
        elif source == "openstreetmap_overpass":
            base = 6
        else:
            base = 7

        if confidence == "verified":
            base -= 1
        elif confidence == "unverified":
            base += 2

        if distance_km is not None:
            if distance_km > 25:
                base += 2
            elif distance_km > 10:
                base += 1
        return max(2, min(14, int(round(base))))

    def _search_directory(
        self,
        *,
        company_name: str,
        anchor_latitude: float | None,
        anchor_longitude: float | None,
        location_hint: str | None,
        radius_km: float,
        limit: int,
    ) -> list[ServiceCenterCandidate]:
        company = self._normalize_text(company_name)
        out: list[ServiceCenterCandidate] = []
        for entry in self.directory_entries:
            brand = self._normalize_text(str(entry.get("brand") or ""))
            aliases = [self._normalize_text(str(item)) for item in (entry.get("aliases") or []) if item]
            if not (company == brand or company in aliases or brand in company or any(alias in company for alias in aliases)):
                continue
            try:
                lat = float(entry.get("latitude"))
                lon = float(entry.get("longitude"))
            except (TypeError, ValueError):
                continue
            name = str(entry.get("name") or "").strip() or "Service Center"
            address = str(entry.get("address") or "").strip()
            if not address:
                continue
            city = str(entry.get("city")).strip() if entry.get("city") else None
            entry_pincode = (
                self.parse_pincode(str(entry.get("pincode")))
                if entry.get("pincode") is not None
                else self._extract_pincode_from_address(address)
            )
            if not self._location_match(location_hint, city=city, address=address, pincode=entry_pincode):
                continue
            distance_km: float | None = None
            if anchor_latitude is not None and anchor_longitude is not None:
                distance_km = round(self._haversine_km(anchor_latitude, anchor_longitude, lat, lon), 2)
                if distance_km > radius_km:
                    continue
            confidence = ("verified" if bool(entry.get("is_verified", True)) else "curated")
            pickup_flag = self._coerce_bool(entry.get("pickup_available"))
            website = (str(entry.get("website")).strip() if entry.get("website") else None)
            entry_tat_days: int | None = None
            try:
                if entry.get("estimated_tat_days") is not None:
                    entry_tat_days = int(entry.get("estimated_tat_days"))  # type: ignore[arg-type]
            except (TypeError, ValueError):
                entry_tat_days = None
            out.append(
                ServiceCenterCandidate(
                    name=name,
                    address=address,
                    latitude=lat,
                    longitude=lon,
                    distance_km=distance_km,
                    source="brand_directory",
                    confidence=confidence,
                    map_url=self._openstreetmap_url(lat, lon),
                    city=city,
                    phone=(str(entry.get("phone")).strip() if entry.get("phone") else None),
                    website=website,
                    pincode=entry_pincode,
                    pickup_available=self._infer_pickup_available(
                        source="brand_directory",
                        confidence=confidence,
                        name=name,
                        address=address,
                        website=website,
                        explicit_flag=pickup_flag,
                    ),
                    estimated_tat_days=(
                        entry_tat_days
                        if entry_tat_days is not None
                        else self._estimate_tat_days(
                            source="brand_directory",
                            confidence=confidence,
                            distance_km=distance_km,
                        )
                    ),
                )
            )
        if anchor_latitude is not None and anchor_longitude is not None:
            out.sort(key=lambda item: item.distance_km if item.distance_km is not None else float("inf"))
        return out[:limit]

    def _search_overpass(
        self,
        *,
        company_name: str,
        bbox: tuple[float, float, float, float] | None,
    ) -> list[dict[str, Any]]:
        if bbox is None:
            return []
        south, west, north, east = bbox
        company_regex = re.escape(company_name).replace(r"\ ", r"\s+")
        query = f"""
[out:json][timeout:{self.OVERPASS_QUERY_TIMEOUT_SECONDS}];
(
  nwr({south},{west},{north},{east})["name"~"{company_regex}.*(service|repair|support|care|center|centre)",i];
  nwr({south},{west},{north},{east})["brand"~"{company_regex}",i]["shop"~"mobile_phone|electronics|appliance",i];
  nwr({south},{west},{north},{east})["name"~"{company_regex}",i]["shop"~"mobile_phone|electronics|appliance",i];
  nwr({south},{west},{north},{east})["operator"~"{company_regex}",i]["shop"~"mobile_phone|electronics|appliance",i];
);
out tags center 120;
"""
        headers = {"User-Agent": self.USER_AGENT}
        for endpoint in self.OVERPASS_URLS:
            try:
                with httpx.Client(timeout=self.OVERPASS_CLIENT_TIMEOUT_SECONDS, headers=headers) as client:
                    response = client.post(endpoint, data={"data": query})
                    response.raise_for_status()
                    payload = response.json()
            except Exception:
                continue
            elements = payload.get("elements") if isinstance(payload, dict) else None
            if isinstance(elements, list) and elements:
                return [item for item in elements if isinstance(item, dict)]
        return []

    def _candidate_from_overpass(
        self,
        item: dict[str, Any],
        *,
        company_name: str,
        anchor_latitude: float | None,
        anchor_longitude: float | None,
        radius_km: float,
    ) -> ServiceCenterCandidate | None:
        tags = item.get("tags")
        if not isinstance(tags, dict):
            return None
        if item.get("type") == "node":
            lat = item.get("lat")
            lon = item.get("lon")
        else:
            center = item.get("center")
            lat = center.get("lat") if isinstance(center, dict) else None
            lon = center.get("lon") if isinstance(center, dict) else None
        try:
            latitude = float(lat)
            longitude = float(lon)
        except (TypeError, ValueError):
            return None

        name = str(tags.get("name") or tags.get("brand") or tags.get("operator") or "").strip()
        if not name:
            return None
        address_parts = [
            str(tags.get("addr:housenumber") or "").strip(),
            str(tags.get("addr:street") or "").strip(),
            str(tags.get("addr:suburb") or "").strip(),
            str(tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village") or "").strip(),
            str(tags.get("addr:state") or "").strip(),
        ]
        address = ", ".join([part for part in address_parts if part]).strip() or name
        if not self._matches_company(company_name, name, address):
            return None

        distance_km: float | None = None
        if anchor_latitude is not None and anchor_longitude is not None:
            distance_km = round(self._haversine_km(anchor_latitude, anchor_longitude, latitude, longitude), 2)
            if distance_km > radius_km:
                return None

        signal = " ".join([name, address, str(tags.get("shop") or ""), str(tags.get("description") or "")])
        shop_type = str(tags.get("shop") or "").lower()
        has_service_word = self.SERVICE_SIGNAL.search(signal) is not None
        confidence = "likely" if (has_service_word or shop_type in {"electronics", "mobile_phone", "appliance"}) else "unverified"
        website = (str(tags.get("website") or tags.get("contact:website") or "").strip() or None)
        return ServiceCenterCandidate(
            name=name[:120],
            address=address[:280],
            latitude=latitude,
            longitude=longitude,
            distance_km=distance_km,
            source="openstreetmap_overpass",
            confidence=confidence,
            map_url=self._openstreetmap_url(latitude, longitude),
            city=(str(tags.get("addr:city")).strip() if tags.get("addr:city") else None),
            phone=(str(tags.get("phone") or tags.get("contact:phone") or "").strip() or None),
            website=website,
            pincode=self._extract_pincode_from_address(
                str(tags.get("addr:postcode") or tags.get("postal_code") or address)
            ),
            pickup_available=self._infer_pickup_available(
                source="openstreetmap_overpass",
                confidence=confidence,
                name=name,
                address=address,
                website=website,
            ),
            estimated_tat_days=self._estimate_tat_days(
                source="openstreetmap_overpass",
                confidence=confidence,
                distance_km=distance_km,
            ),
        )

    def _search_google_places(
        self,
        *,
        query: str,
        limit: int,
        anchor_latitude: float | None,
        anchor_longitude: float | None,
        radius_km: float,
        location_hint: str | None,
    ) -> list[dict[str, Any]]:
        if not self.enable_google_lookup:
            return []
        normalized_query = query.strip()
        if not normalized_query:
            return []

        auth_headers = self._google_places_auth_headers()
        if not auth_headers:
            return []

        search_query = normalized_query if not location_hint else f"{normalized_query} {location_hint.strip()}"
        headers = {
            "Content-Type": "application/json",
            "X-Goog-FieldMask": (
                "places.id,"
                "places.displayName,"
                "places.formattedAddress,"
                "places.location,"
                "places.googleMapsUri,"
                "places.nationalPhoneNumber,"
                "places.websiteUri"
            ),
            "User-Agent": self.USER_AGENT,
        }
        headers.update(auth_headers)
        payload: dict[str, Any] = {
            "textQuery": search_query,
            "pageSize": max(1, min(limit, 20)),
            "languageCode": "en",
            "regionCode": "IN",
        }
        if anchor_latitude is not None and anchor_longitude is not None:
            payload["locationBias"] = {
                "circle": {
                    "center": {
                        "latitude": anchor_latitude,
                        "longitude": anchor_longitude,
                    },
                    "radius": float(max(1000, min(int(radius_km * 1000), 50000))),
                }
            }

        try:
            with httpx.Client(timeout=self.DEFAULT_TIMEOUT_SECONDS, trust_env=False) as client:
                response = client.post(self.GOOGLE_TEXT_SEARCH_URL, headers=headers, json=payload)
                response.raise_for_status()
                response_payload = response.json()
        except Exception:
            return []

        results = response_payload.get("places") if isinstance(response_payload, dict) else None
        if not isinstance(results, list):
            return []
        return [item for item in results if isinstance(item, dict)][:limit]

    def _candidate_from_google(
        self,
        item: dict[str, Any],
        *,
        company_name: str,
        anchor_latitude: float | None,
        anchor_longitude: float | None,
        radius_km: float,
    ) -> ServiceCenterCandidate | None:
        location = item.get("location")
        if not isinstance(location, dict):
            geometry = item.get("geometry")
            location = geometry.get("location") if isinstance(geometry, dict) else None
        if not isinstance(location, dict):
            return None
        try:
            latitude = float(location.get("latitude") if location.get("latitude") is not None else location.get("lat"))
            longitude = float(location.get("longitude") if location.get("longitude") is not None else location.get("lng"))
        except (TypeError, ValueError):
            return None
        display_name = item.get("displayName")
        if isinstance(display_name, dict):
            name = str(display_name.get("text") or "").strip()
        else:
            name = str(item.get("name") or "").strip()
        name = name or "Service Center"
        address = str(item.get("formatted_address") or item.get("formattedAddress") or name).strip()
        if not self._matches_company(company_name, name, address):
            return None
        distance_km: float | None = None
        if anchor_latitude is not None and anchor_longitude is not None:
            distance_km = round(self._haversine_km(anchor_latitude, anchor_longitude, latitude, longitude), 2)
            if distance_km > radius_km:
                return None
        place_id = str(item.get("id") or item.get("place_id") or "").strip() or None
        confidence = "likely"
        website = str(item.get("websiteUri") or "").strip() or None
        phone = str(item.get("nationalPhoneNumber") or "").strip() or None
        google_maps_uri = str(item.get("googleMapsUri") or "").strip() or None
        return ServiceCenterCandidate(
            name=name[:120],
            address=address[:280],
            latitude=latitude,
            longitude=longitude,
            distance_km=distance_km,
            source="google_maps",
            confidence=confidence,
            map_url=google_maps_uri or self._google_map_url(name=name, address=address, place_id=place_id),
            phone=phone,
            website=website,
            pincode=self._extract_pincode_from_address(address),
            pickup_available=self._infer_pickup_available(
                source="google_maps",
                confidence=confidence,
                name=name,
                address=address,
                website=website,
            ),
            estimated_tat_days=self._estimate_tat_days(
                source="google_maps",
                confidence=confidence,
                distance_km=distance_km,
            ),
        )

    def _search_nominatim(self, *, query: str, limit: int, location_hint: str | None) -> list[dict[str, Any]]:
        normalized_query = query.strip()
        if not normalized_query:
            return []
        search_query = normalized_query if not location_hint else f"{normalized_query} {location_hint.strip()}"
        headers = {"User-Agent": self.USER_AGENT}
        try:
            with httpx.Client(timeout=self.DEFAULT_TIMEOUT_SECONDS, headers=headers) as client:
                response = client.get(
                    self.NOMINATIM_SEARCH_URL,
                    params={"q": search_query, "format": "jsonv2", "limit": max(limit, self.DEFAULT_LIMIT)},
                )
                response.raise_for_status()
                payload = response.json()
        except Exception:
            return []
        return payload if isinstance(payload, list) else []

    def _candidate_from_nominatim(
        self,
        item: dict[str, Any],
        *,
        company_name: str,
        anchor_latitude: float | None,
        anchor_longitude: float | None,
        radius_km: float,
    ) -> ServiceCenterCandidate | None:
        try:
            latitude = float(item.get("lat"))
            longitude = float(item.get("lon"))
        except (TypeError, ValueError):
            return None
        address = str(item.get("display_name") or "").strip()
        if not address:
            return None
        name = address.split(",", 1)[0].strip() or "Service Center"
        if not self._matches_company(company_name, name, address):
            return None
        distance_km: float | None = None
        if anchor_latitude is not None and anchor_longitude is not None:
            distance_km = round(self._haversine_km(anchor_latitude, anchor_longitude, latitude, longitude), 2)
            if distance_km > radius_km:
                return None
        confidence = "likely"
        return ServiceCenterCandidate(
            name=name[:120],
            address=address[:280],
            latitude=latitude,
            longitude=longitude,
            distance_km=distance_km,
            source="openstreetmap_nominatim",
            confidence=confidence,
            map_url=self._openstreetmap_url(latitude, longitude),
            pincode=self._extract_pincode_from_address(address),
            pickup_available=self._infer_pickup_available(
                source="openstreetmap_nominatim",
                confidence=confidence,
                name=name,
                address=address,
                website=None,
            ),
            estimated_tat_days=self._estimate_tat_days(
                source="openstreetmap_nominatim",
                confidence=confidence,
                distance_km=distance_km,
            ),
        )

    def find_service_centers(
        self,
        *,
        company_name: str,
        user_latitude: float | None = None,
        user_longitude: float | None = None,
        location_hint: str | None = None,
        radius_km: float | None = None,
        limit: int = DEFAULT_LIMIT,
        allow_external_lookup: bool = True,
    ) -> list[ServiceCenterCandidate]:
        normalized_company = self.normalize_company_name(company_name)
        if not normalized_company:
            return []
        use_live_lookup = bool(allow_external_lookup and self.live_lookup_enabled)

        safe_limit = max(1, min(limit, 10))
        safe_radius = self.parse_radius_km("", default_km=radius_km)
        target_count = min(3, safe_limit)

        anchor_lat = user_latitude
        anchor_lon = user_longitude
        if anchor_lat is None or anchor_lon is None:
            location_pincode = self.parse_pincode(location_hint)
            if location_pincode and location_pincode in self.PINCODE_HINTS:
                anchor_lat, anchor_lon, _, _ = self.PINCODE_HINTS[location_pincode]
            else:
                geocoded = self._geocode_location(location_hint)
                if geocoded:
                    anchor_lat, anchor_lon = geocoded
                else:
                    fallback = self._fallback_anchor_for_location_hint(location_hint)
                    if fallback:
                        anchor_lat, anchor_lon = fallback

        bbox = (
            self._bbox_from_radius(anchor_lat, anchor_lon, min(max(safe_radius, 20.0), 30.0))
            if anchor_lat is not None and anchor_lon is not None
            else None
        )

        candidates: list[ServiceCenterCandidate] = []
        seen: set[tuple[str, int, int]] = set()

        def append(candidate: ServiceCenterCandidate | None) -> None:
            if candidate is None:
                return
            lat_key = int(round(candidate.latitude * 1000)) if candidate.latitude is not None else -999999
            lon_key = int(round(candidate.longitude * 1000)) if candidate.longitude is not None else -999999
            key = (candidate.name.lower(), lat_key, lon_key)
            if key in seen:
                return
            seen.add(key)
            candidates.append(candidate)

        for center in self._search_directory(
            company_name=normalized_company,
            anchor_latitude=anchor_lat,
            anchor_longitude=anchor_lon,
            location_hint=location_hint,
            radius_km=safe_radius,
            limit=safe_limit,
        ):
            append(center)

        if candidates and not use_live_lookup:
            if anchor_lat is not None and anchor_lon is not None:
                candidates.sort(
                    key=lambda item: (
                        self.SOURCE_PRIORITY.get(item.source, 99),
                        item.distance_km if item.distance_km is not None else float("inf"),
                        item.name.lower(),
                    )
                )
            else:
                candidates.sort(key=lambda item: (self.SOURCE_PRIORITY.get(item.source, 99), item.name.lower()))
            return candidates[:safe_limit]

        if not candidates and not use_live_lookup:
            fallback_centers = self._official_support_fallbacks(
                company_name=normalized_company,
                location_hint=location_hint,
                anchor_latitude=anchor_lat,
                anchor_longitude=anchor_lon,
                limit=safe_limit,
            )
            for center in fallback_centers:
                append(center)
            return candidates[:safe_limit]

        if use_live_lookup and len(candidates) < safe_limit:
            overpass_raw = self._search_overpass(company_name=normalized_company, bbox=bbox)
            if not overpass_raw and anchor_lat is not None and anchor_lon is not None:
                expanded_bbox = self._bbox_from_radius(anchor_lat, anchor_lon, min(max(safe_radius * 1.35, 30.0), 35.0))
                overpass_raw = self._search_overpass(company_name=normalized_company, bbox=expanded_bbox)
            for raw in overpass_raw:
                append(
                    self._candidate_from_overpass(
                        raw,
                        company_name=normalized_company,
                        anchor_latitude=anchor_lat,
                        anchor_longitude=anchor_lon,
                        radius_km=safe_radius,
                    )
                )

        query_variants = [
            f"{normalized_company} service center",
            f"{normalized_company} repair center",
        ]
        if use_live_lookup and len(candidates) < target_count:
            for query in query_variants:
                for raw in self._search_google_places(
                    query=query,
                    limit=max(10, safe_limit * 2),
                    anchor_latitude=anchor_lat,
                    anchor_longitude=anchor_lon,
                    radius_km=safe_radius,
                    location_hint=location_hint,
                ):
                    append(
                        self._candidate_from_google(
                            raw,
                            company_name=normalized_company,
                            anchor_latitude=anchor_lat,
                            anchor_longitude=anchor_lon,
                            radius_km=safe_radius,
                        )
                    )
                if len(candidates) >= target_count:
                    break

        if use_live_lookup and len(candidates) < target_count:
            for query in query_variants:
                for raw in self._search_nominatim(query=query, limit=max(8, safe_limit * 2), location_hint=location_hint):
                    append(
                        self._candidate_from_nominatim(
                            raw,
                            company_name=normalized_company,
                            anchor_latitude=anchor_lat,
                            anchor_longitude=anchor_lon,
                            radius_km=safe_radius,
                        )
                    )
                if len(candidates) >= target_count:
                    break

        if not candidates:
            for center in self._official_support_fallbacks(
                company_name=normalized_company,
                location_hint=location_hint,
                anchor_latitude=anchor_lat,
                anchor_longitude=anchor_lon,
                limit=safe_limit,
            ):
                append(center)

        if anchor_lat is not None and anchor_lon is not None:
            candidates.sort(
                key=lambda item: (
                    self.SOURCE_PRIORITY.get(item.source, 99),
                    item.distance_km if item.distance_km is not None else float("inf"),
                    item.name.lower(),
                )
            )
        else:
            candidates.sort(key=lambda item: (self.SOURCE_PRIORITY.get(item.source, 99), item.name.lower()))
        return candidates[:safe_limit]
