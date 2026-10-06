from __future__ import annotations

from app.services.service_centers import ServiceCenterLocator


def test_service_center_query_detection() -> None:
    locator = ServiceCenterLocator(directory_entries=[])
    assert locator.is_service_center_query("Where is the nearest Samsung service center?")
    assert locator.is_service_center_query("Need a repair centre for my LG TV")
    assert not locator.is_service_center_query("Show me invoices for June")


def test_find_service_centers_sorts_by_distance(monkeypatch) -> None:
    locator = ServiceCenterLocator(directory_entries=[], live_lookup_enabled=True)
    mocked_results = [
        {
            "display_name": "Samsung Service Center A, MG Road, Bengaluru, Karnataka, India",
            "lat": "12.9750",
            "lon": "77.6050",
        },
        {
            "display_name": "Samsung Service Center B, Whitefield, Bengaluru, Karnataka, India",
            "lat": "12.9900",
            "lon": "77.7300",
        },
    ]

    monkeypatch.setattr(locator, "_search_nominatim", lambda **kwargs: mocked_results)
    monkeypatch.setattr(locator, "_search_overpass", lambda **kwargs: [])
    monkeypatch.setattr(locator, "_search_google_places", lambda **kwargs: [])

    centers = locator.find_service_centers(
        company_name="Samsung",
        user_latitude=12.9716,
        user_longitude=77.5946,
        limit=3,
    )

    assert len(centers) == 2
    assert centers[0].distance_km is not None
    assert centers[1].distance_km is not None
    assert centers[0].distance_km <= centers[1].distance_km


def test_find_service_centers_without_location_has_no_distance(monkeypatch) -> None:
    locator = ServiceCenterLocator(directory_entries=[], live_lookup_enabled=True)
    mocked_results = [
        {
            "display_name": "LG Service Center, Connaught Place, New Delhi, India",
            "lat": "28.6300",
            "lon": "77.2200",
        }
    ]
    monkeypatch.setattr(locator, "_search_nominatim", lambda **kwargs: mocked_results)
    monkeypatch.setattr(locator, "_search_overpass", lambda **kwargs: [])
    monkeypatch.setattr(locator, "_search_google_places", lambda **kwargs: [])

    centers = locator.find_service_centers(company_name="LG", limit=2)
    assert len(centers) == 1
    assert centers[0].distance_km is None


def test_parse_radius_km_supports_km_and_miles() -> None:
    locator = ServiceCenterLocator(directory_entries=[])
    assert locator.parse_radius_km("find service center within 12 km") == 12.0
    assert locator.parse_radius_km("show centers in a 10 miles range") == 16.09


def test_parse_radius_km_uses_default_when_missing() -> None:
    locator = ServiceCenterLocator(directory_entries=[])
    assert locator.parse_radius_km("nearest service center please", default_km=25) == 25


def test_parse_pincode_extracts_valid_indian_pincode() -> None:
    locator = ServiceCenterLocator(directory_entries=[])
    assert locator.parse_pincode("nearest service center in 560001") == "560001"
    assert locator.parse_pincode("pin code: 110001") == "110001"
    assert locator.parse_pincode("zip 001234") is None


def test_normalize_company_name_strips_corporate_suffixes() -> None:
    locator = ServiceCenterLocator(directory_entries=[])
    assert locator.normalize_company_name("Apple India Private Limited") == "Apple"
    assert locator.normalize_company_name("Samsung Electronics India Pvt. Ltd.") == "Samsung"


def test_find_service_centers_returns_official_fallback_when_fast_mode_requested(monkeypatch) -> None:
    locator = ServiceCenterLocator(directory_entries=[])
    monkeypatch.setattr(locator, "_search_nominatim", lambda **kwargs: (_ for _ in ()).throw(AssertionError("should not call nominatim")))
    monkeypatch.setattr(locator, "_search_overpass", lambda **kwargs: (_ for _ in ()).throw(AssertionError("should not call overpass")))
    monkeypatch.setattr(locator, "_search_google_places", lambda **kwargs: (_ for _ in ()).throw(AssertionError("should not call google places")))

    centers = locator.find_service_centers(
        company_name="Apple India Private Limited",
        location_hint="Bengaluru",
        limit=3,
        allow_external_lookup=False,
    )

    assert len(centers) == 1
    assert centers[0].source == "official_support"
    assert centers[0].website == "https://support.apple.com/en-in/repair"
    assert centers[0].map_url is not None


def test_find_service_centers_uses_live_lookup_when_enabled(monkeypatch) -> None:
    locator = ServiceCenterLocator(directory_entries=[], live_lookup_enabled=True)
    monkeypatch.setattr(locator, "_search_overpass", lambda **kwargs: [])
    monkeypatch.setattr(
        locator,
        "_search_google_places",
        lambda **kwargs: [
            {
                "name": "Apple Authorized Service Provider - Indiranagar",
                "formatted_address": "100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038, India",
                "place_id": "apple-place-1",
                "geometry": {"location": {"lat": 12.9719, "lng": 77.6408}},
            }
        ],
    )
    monkeypatch.setattr(locator, "_search_nominatim", lambda **kwargs: [])

    centers = locator.find_service_centers(
        company_name="Apple India Private Limited",
        user_latitude=12.9716,
        user_longitude=77.5946,
        location_hint="Bengaluru",
        limit=3,
    )

    assert len(centers) == 1
    assert centers[0].source == "google_maps"
    assert centers[0].distance_km is not None


def test_directory_results_prioritized_and_verified(monkeypatch) -> None:
    directory_entries = [
        {
            "brand": "Samsung",
            "aliases": ["samsung"],
            "name": "Samsung Directory A",
            "address": "MG Road, Bengaluru",
            "city": "Bengaluru",
            "latitude": 12.975,
            "longitude": 77.605,
            "is_verified": True,
        },
        {
            "brand": "Samsung",
            "aliases": ["samsung"],
            "name": "Samsung Directory B",
            "address": "Jayanagar, Bengaluru",
            "city": "Bengaluru",
            "latitude": 12.930,
            "longitude": 77.585,
            "is_verified": True,
        },
    ]
    locator = ServiceCenterLocator(directory_entries=directory_entries, live_lookup_enabled=True)
    monkeypatch.setattr(
        locator,
        "_search_nominatim",
        lambda **kwargs: [
            {
                "display_name": "Samsung OSM Center, Bengaluru",
                "lat": "12.9900",
                "lon": "77.7300",
            }
        ],
    )

    centers = locator.find_service_centers(company_name="Samsung", limit=2)
    assert len(centers) == 2
    assert centers[0].source == "brand_directory"
    assert centers[1].source == "brand_directory"
    assert centers[0].confidence == "verified"


def test_directory_city_fuzzy_match_for_typo_city_name(monkeypatch) -> None:
    directory_entries = [
        {
            "brand": "Samsung",
            "aliases": ["samsung"],
            "name": "Samsung Directory A",
            "address": "Indiranagar, Bengaluru",
            "city": "Bengaluru",
            "latitude": 12.9719,
            "longitude": 77.6408,
            "is_verified": True,
        }
    ]
    locator = ServiceCenterLocator(directory_entries=directory_entries)
    monkeypatch.setattr(locator, "_search_nominatim", lambda **kwargs: [])
    monkeypatch.setattr(locator, "_search_overpass", lambda **kwargs: [])
    monkeypatch.setattr(locator, "_search_google_places", lambda **kwargs: [])
    centers = locator.find_service_centers(
        company_name="Samsung",
        location_hint="banglore",
        limit=3,
    )
    assert len(centers) == 1
    assert centers[0].source == "brand_directory"


def test_directory_lookup_supports_pincode_hint_and_adds_ops_metadata(monkeypatch) -> None:
    directory_entries = [
        {
            "brand": "Samsung",
            "aliases": ["samsung"],
            "name": "Samsung Directory Pincode",
            "address": "MG Road, Bengaluru, Karnataka 560001",
            "city": "Bengaluru",
            "latitude": 12.975,
            "longitude": 77.605,
            "is_verified": True,
            "pincode": "560001",
            "pickup_available": True,
        }
    ]
    locator = ServiceCenterLocator(directory_entries=directory_entries)
    monkeypatch.setattr(locator, "_search_nominatim", lambda **kwargs: [])
    monkeypatch.setattr(locator, "_search_overpass", lambda **kwargs: [])
    monkeypatch.setattr(locator, "_search_google_places", lambda **kwargs: [])

    centers = locator.find_service_centers(company_name="Samsung", location_hint="560001", limit=2)
    assert len(centers) == 1
    assert centers[0].pincode == "560001"
    assert centers[0].pickup_available is True
    assert centers[0].estimated_tat_days is not None


def test_directory_lookup_accepts_same_prefix_pincode_cluster(monkeypatch) -> None:
    directory_entries = [
        {
            "brand": "Samsung",
            "aliases": ["samsung"],
            "name": "Samsung Cluster Center",
            "address": "Indiranagar, Bengaluru",
            "city": "Bengaluru",
            "latitude": 12.9719,
            "longitude": 77.6408,
            "is_verified": True,
            "pincode": "560038",
        }
    ]
    locator = ServiceCenterLocator(directory_entries=directory_entries)
    monkeypatch.setattr(locator, "_search_nominatim", lambda **kwargs: [])
    monkeypatch.setattr(locator, "_search_overpass", lambda **kwargs: [])
    monkeypatch.setattr(locator, "_search_google_places", lambda **kwargs: [])

    centers = locator.find_service_centers(company_name="Samsung", location_hint="560001", radius_km=25, limit=3)
    assert len(centers) == 1
    assert centers[0].pincode == "560038"
