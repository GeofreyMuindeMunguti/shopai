from __future__ import annotations
from pydantic import Field
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    temporal_address: str = Field("temporal:7233", env="TEMPORAL_ADDRESS")
    temporal_namespace: str = Field("default", env="TEMPORAL_NAMESPACE")
    temporal_task_queue: str = Field("main", env="TEMPORAL_TASK_QUEUE")
    supabase_url: str = Field("http://host.docker.internal:54321", env="SUPABASE_URL")
    supabase_service_role_key: str = Field("dev-service-role-key", env="SUPABASE_SERVICE_ROLE_KEY")

    # Web search. Provider is selected by name; see src/search/registry.py for available providers.
    search_provider: str = Field("tavily", env="SEARCH_PROVIDER")
    search_fallback_provider: str | None = Field(None, env="SEARCH_FALLBACK_PROVIDER")
    search_max_results: int = Field(10, env="SEARCH_MAX_RESULTS")
    search_timeout_seconds: float = Field(15.0, env="SEARCH_TIMEOUT_SECONDS")

    # Tavily (https://docs.tavily.com)
    tavily_api_key: str | None = Field(None, env="TAVILY_API_KEY")
    tavily_base_url: str = Field("https://api.tavily.com", env="TAVILY_BASE_URL")
    tavily_search_depth: str = Field("basic", env="TAVILY_SEARCH_DEPTH")

    class Config:
        case_sensitive = False

settings = Settings()
