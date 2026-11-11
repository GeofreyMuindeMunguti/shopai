from __future__ import annotations
import httpx

from .base import (
    AUTH, BAD_REQUEST, QUOTA, RATE_LIMITED, UNAVAILABLE,
    SearchConfigError, SearchProvider, SearchProviderError, SearchQuery, SearchResponse, SearchResult,
)

# Tavily's `country` parameter takes lowercase English names, not ISO codes.
_COUNTRY_NAMES = {
    "KE": "kenya",
    "US": "united states",
    "ZA": "south africa",
}

_STATUS_KINDS = {
    400: BAD_REQUEST,
    401: AUTH,
    422: BAD_REQUEST,
    429: RATE_LIMITED,
    432: QUOTA,   # key/plan usage limit
    433: QUOTA,   # pay-as-you-go limit
    434: UNAVAILABLE,
}


class TavilySearchProvider(SearchProvider):
    """https://docs.tavily.com/documentation/api-reference/endpoint/search"""

    name = "tavily"

    def __init__(
        self,
        api_key: str | None,
        *,
        base_url: str = "https://api.tavily.com",
        search_depth: str = "basic",
        default_max_results: int = 10,
        timeout_seconds: float = 15.0,
        transport: httpx.BaseTransport | None = None,
    ):
        if not api_key:
            raise SearchConfigError("TAVILY_API_KEY is required when tavily is a configured search provider")
        self._search_depth = search_depth
        self._default_max_results = default_max_results
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout_seconds,
            headers={"Authorization": f"Bearer {api_key}"},
            transport=transport,
        )

    def search(self, query: SearchQuery) -> SearchResponse:
        body: dict = {
            "query": query.query,
            "search_depth": self._search_depth,
            "max_results": query.max_results or self._default_max_results,
            "topic": "general",
            "include_usage": True,
        }
        if query.include_domains:
            body["include_domains"] = query.include_domains
        if query.exclude_domains:
            body["exclude_domains"] = query.exclude_domains
        country = _COUNTRY_NAMES.get((query.country_code or "").upper())
        if country:
            body["country"] = country

        try:
            resp = self._client.post("/search", json=body)
        except httpx.HTTPError as exc:
            raise SearchProviderError(f"tavily request failed: {type(exc).__name__}", provider=self.name, kind=UNAVAILABLE) from exc

        if resp.status_code != 200:
            kind = _STATUS_KINDS.get(resp.status_code, UNAVAILABLE)
            raise SearchProviderError(f"tavily returned HTTP {resp.status_code}", provider=self.name, kind=kind)

        data = resp.json()
        results = [
            SearchResult(
                title=r.get("title") or "",
                url=r["url"],
                snippet=r.get("content") or "",
                score=r.get("score"),
            )
            for r in data.get("results", [])
            if r.get("url")
        ]
        usage = data.get("usage") or {}
        return SearchResponse(provider=self.name, query=query.query, results=results, credits_used=usage.get("credits"))
