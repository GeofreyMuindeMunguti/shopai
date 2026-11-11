from __future__ import annotations
import logging
import time
from typing import Callable

from ..config import Settings
from .base import BAD_REQUEST, SearchConfigError, SearchProvider, SearchProviderError, SearchQuery, SearchResponse
from .tavily import TavilySearchProvider

logger = logging.getLogger(__name__)

# To add a provider: implement SearchProvider in its own module, add its settings
# to config.py, and register a builder here. Selection is purely by env var.
_BUILDERS: dict[str, Callable[[Settings], SearchProvider]] = {
    "tavily": lambda s: TavilySearchProvider(
        api_key=s.tavily_api_key,
        base_url=s.tavily_base_url,
        search_depth=s.tavily_search_depth,
        default_max_results=s.search_max_results,
        timeout_seconds=s.search_timeout_seconds,
    ),
}


def build_provider(name: str, settings: Settings) -> SearchProvider:
    builder = _BUILDERS.get(name.strip().lower())
    if builder is None:
        raise SearchConfigError(f"unknown search provider '{name}' (available: {', '.join(sorted(_BUILDERS))})")
    return builder(settings)


class SearchClient:
    """Tries providers in order; falls through to the next on any error except a bad request."""

    def __init__(self, providers: list[SearchProvider]):
        if not providers:
            raise SearchConfigError("at least one search provider must be configured")
        self.providers = providers

    def search(self, query: SearchQuery) -> SearchResponse:
        query.validate()
        last_error: SearchProviderError | None = None
        for provider in self.providers:
            started = time.monotonic()
            try:
                response = provider.search(query)
            except SearchProviderError as exc:
                logger.warning(
                    "search provider failed provider=%s kind=%s error=%s",
                    provider.name, exc.kind, exc,
                )
                if exc.kind == BAD_REQUEST:
                    raise
                last_error = exc
                continue
            logger.info(
                "search ok provider=%s results=%d credits=%s duration_ms=%d",
                provider.name, len(response.results), response.credits_used, (time.monotonic() - started) * 1000,
            )
            return response
        assert last_error is not None
        raise last_error


def build_search_client(settings: Settings) -> SearchClient:
    names = [settings.search_provider]
    if settings.search_fallback_provider and settings.search_fallback_provider != settings.search_provider:
        names.append(settings.search_fallback_provider)
    return SearchClient([build_provider(n, settings) for n in names])
