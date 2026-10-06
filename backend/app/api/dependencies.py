from functools import lru_cache

from app.agents.auditor_agent import AuditorAgent
from app.agents.calculation_agent import CalculationAgent
from app.agents.policy_agent import PolicyAgent
from app.agents.retrieval_agent import RetrievalAgent
from app.core.config import get_settings
from app.services.generation import GroundedAnswerGenerator
from app.services.bharat_ai import BharatAIService
from app.services.dynamodb_store import DynamoDBMirrorStore
from app.services.ingestion import IngestionService
from app.services.object_storage import S3ObjectStore
from app.services.planner import QueryPlanner
from app.services.product_image import ProductImageService
from app.services.service_centers import ServiceCenterLocator


class ServiceRegistry:
    def __init__(self) -> None:
        settings = get_settings()
        self.ingestion = IngestionService()
        self.retrieval_agent = RetrievalAgent()
        self.calculation_agent = CalculationAgent()
        self.policy_agent = PolicyAgent()
        self.auditor_agent = AuditorAgent()
        self.planner = QueryPlanner()
        self.generator = GroundedAnswerGenerator()
        self.bharat_ai = BharatAIService()
        self.product_images = ProductImageService()
        self.object_store = S3ObjectStore()
        self.dynamodb_store = DynamoDBMirrorStore()
        maps_api_key = settings.google_maps_api_key or settings.google_vision_api_key
        self.service_center_locator = ServiceCenterLocator(
            google_maps_api_key=maps_api_key,
            enable_google_lookup=settings.service_center_google_lookup_enabled,
            live_lookup_enabled=settings.service_center_live_lookup_enabled,
            google_credentials_file=settings.google_vision_credentials_file,
            google_oauth_scope=settings.google_vision_scope,
            directory_path=(settings.service_center_directory_path or None),
        )


@lru_cache(maxsize=1)
def get_services() -> ServiceRegistry:
    return ServiceRegistry()
