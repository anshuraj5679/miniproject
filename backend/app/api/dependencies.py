from functools import lru_cache

from app.agents.auditor_agent import AuditorAgent
from app.agents.calculation_agent import CalculationAgent
from app.agents.policy_agent import PolicyAgent
from app.agents.retrieval_agent import RetrievalAgent
from app.core.config import get_settings
from app.services.generation import GroundedAnswerGenerator
from app.services.ingestion import IngestionService
from app.services.planner import QueryPlanner
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
        self.service_center_locator = ServiceCenterLocator(
            google_maps_api_key=settings.google_maps_api_key,
            enable_google_lookup=settings.enable_google_service_center_lookup,
            directory_path=(settings.service_center_directory_path or None),
        )


@lru_cache(maxsize=1)
def get_services() -> ServiceRegistry:
    return ServiceRegistry()
