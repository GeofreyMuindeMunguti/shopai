from __future__ import annotations
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Worker settings. Field names map to env vars case-insensitively (e.g. BEDROCK_ENDPOINT_URL)."""

    # env_ignore_empty: compose passes unset vars as "" (e.g. AWS_SESSION_TOKEN), which must mean "not set".
    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore", env_ignore_empty=True)

    temporal_address: str = "temporal:7233"
    temporal_namespace: str = "default"
    temporal_task_queue: str = "main"
    supabase_url: str = "http://host.docker.internal:54321"
    supabase_service_role_key: str = "dev-service-role-key"
    supabase_timeout_seconds: float = 15.0

    # AWS Bedrock (spec: Configuration). The endpoint comes from env; model IDs live in llm_models.
    bedrock_endpoint_url: str | None = None
    aws_region: str | None = None
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_session_token: str | None = None
    bedrock_bootstrap_model_id: str | None = None
    bedrock_timeout_seconds: float = 120.0

    # Web search. Provider is selected by name; see src/search/registry.py for available providers.
    search_provider: str = "tavily"
    search_fallback_provider: str | None = None
    search_max_results: int = 10
    search_timeout_seconds: float = 15.0

    # Tavily (https://docs.tavily.com)
    tavily_api_key: str | None = None
    tavily_base_url: str = "https://api.tavily.com"
    tavily_search_depth: str = "basic"

    # Amazon product API (optional; without it Amazon falls back to search + fetch)
    amazon_api_access_key: str | None = None
    amazon_api_secret_key: str | None = None
    amazon_partner_tag: str | None = None

    # FX rates (ADR-0009)
    fx_rates_provider: str = "exchangerate_api_open"
    fx_rates_fallback_provider: str | None = "fawazahmed0"
    fx_timeout_seconds: float = 15.0

    # Fetching
    headless_renderer_url: str | None = None
    fetch_timeout_seconds: float = 15.0
    fetch_max_bytes: int = 2_000_000
    fetch_cache_ttl_seconds: int = 3 * 3600
    fetch_user_agent: str = "ScoutBot/0.1 (wishlist price checker; respects robots.txt)"
    fetch_respect_robots: bool = True

    # Outbox dispatcher (ADR-0002)
    job_poll_interval_seconds: float = 2.0
    job_claim_batch_size: int = 10

    # Per-run budgets, split across retailer children
    scout_max_iterations: int = 12
    scout_max_fetches: int = 25
    scout_max_tokens: int = 60000
    scout_child_timeout_seconds: int = 600

    # Temporal Schedules (daily FX refresh, hourly re-scout sweep)
    enable_schedules: bool = True


REQUIRED = ("bedrock_endpoint_url", "aws_region")


def missing_required(s: Settings) -> list[str]:
    return [name.upper() for name in REQUIRED if not getattr(s, name)]


settings = Settings()
