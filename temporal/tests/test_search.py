from __future__ import annotations
import json

import httpx
import pytest

from src.config import Settings
from src.search import SearchClient, SearchConfigError, SearchProviderError, SearchQuery, SearchResponse, build_provider, build_search_client
from src.search.base import SearchProvider
from src.search.tavily import TavilySearchProvider


def _tavily(handler) -> TavilySearchProvider:
    return TavilySearchProvider("tvly-test", transport=httpx.MockTransport(handler))


def test_tavily_maps_request_and_response():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "query": "sony wh-1000xm5",
            "results": [
                {"title": "Sony WH-1000XM5", "url": "https://www.takealot.com/sony/PLID1", "content": "R4199", "score": 0.91},
                {"title": "no url"},
            ],
            "usage": {"credits": 1},
        })

    resp = _tavily(handler).search(SearchQuery(query="sony wh-1000xm5", country_code="za", include_domains=["takealot.com"], max_results=5))

    assert seen["auth"] == "Bearer tvly-test"
    assert seen["body"] == {
        "query": "sony wh-1000xm5", "search_depth": "basic", "max_results": 5, "topic": "general",
        "include_usage": True, "include_domains": ["takealot.com"], "country": "south africa",
    }
    assert resp.provider == "tavily"
    assert resp.credits_used == 1
    assert [r.url for r in resp.results] == ["https://www.takealot.com/sony/PLID1"]
    assert resp.results[0].snippet == "R4199"


def test_tavily_omits_unknown_country():
    def handler(request):
        assert "country" not in json.loads(request.content)
        return httpx.Response(200, json={"results": []})

    _tavily(handler).search(SearchQuery(query="x", country_code="FR"))


@pytest.mark.parametrize("status,kind,retryable", [
    (400, "bad_request", False),
    (401, "auth", False),
    (429, "rate_limited", True),
    (432, "quota", False),
    (500, "unavailable", True),
])
def test_tavily_error_mapping(status, kind, retryable):
    with pytest.raises(SearchProviderError) as info:
        _tavily(lambda r: httpx.Response(status, json={})).search(SearchQuery(query="x"))
    assert info.value.kind == kind
    assert info.value.retryable is retryable


def test_tavily_network_error_is_retryable():
    def handler(request):
        raise httpx.ConnectTimeout("timeout", request=request)

    with pytest.raises(SearchProviderError) as info:
        _tavily(handler).search(SearchQuery(query="x"))
    assert info.value.kind == "unavailable" and info.value.retryable


def test_tavily_requires_api_key():
    with pytest.raises(SearchConfigError):
        TavilySearchProvider(None)


class _Fake(SearchProvider):
    def __init__(self, name, error_kind=None):
        self.name, self.error_kind, self.calls = name, error_kind, 0

    def search(self, query):
        self.calls += 1
        if self.error_kind:
            raise SearchProviderError("boom", provider=self.name, kind=self.error_kind)
        return SearchResponse(provider=self.name, query=query.query, results=[])


def test_client_falls_back_on_quota():
    primary, fallback = _Fake("a", "quota"), _Fake("b")
    assert SearchClient([primary, fallback]).search(SearchQuery(query="x")).provider == "b"


def test_client_does_not_fall_back_on_bad_request():
    primary, fallback = _Fake("a", "bad_request"), _Fake("b")
    with pytest.raises(SearchProviderError):
        SearchClient([primary, fallback]).search(SearchQuery(query="x"))
    assert fallback.calls == 0


def test_client_raises_last_error_when_all_fail():
    with pytest.raises(SearchProviderError) as info:
        SearchClient([_Fake("a", "quota"), _Fake("b", "unavailable")]).search(SearchQuery(query="x"))
    assert info.value.provider == "b"


def test_client_validates_query():
    with pytest.raises(SearchProviderError) as info:
        SearchClient([_Fake("a")]).search(SearchQuery(query="  "))
    assert info.value.kind == "bad_request"


def test_registry_selects_provider_from_settings():
    s = Settings(search_provider="tavily", tavily_api_key="tvly-test")
    assert isinstance(build_provider(s.search_provider, s), TavilySearchProvider)
    assert len(build_search_client(s).providers) == 1


def test_registry_rejects_unknown_provider():
    with pytest.raises(SearchConfigError, match="unknown search provider"):
        build_provider("nope", Settings())
