from __future__ import annotations

import httpx

from src.retail.adapters import AdapterContext
from src.retail.adapters.shopify import ShopifyAdapter
from src.retail.discovery import discover_stores
from src.retail.fetcher import SafeFetcher
from src.retail.taxonomy import category_keys, normalise_category
from src.search import SearchClient, SearchQuery, SearchResponse, SearchResult
from src.search.base import SearchProvider

PRODUCTS = {"products": [{"title": f"Boot {i}", "variants": [{"price": "4500.00"}]} for i in range(12)]}


def handler(request: httpx.Request) -> httpx.Response:
    host, path = request.url.host, request.url.path
    if path == "/robots.txt":
        return httpx.Response(404)
    if host == "trailshop.co.ke":
        if path == "/products.json":
            return httpx.Response(200, json=PRODUCTS, headers={"x-shopid": "1"})
        if path == "/meta.json":
            return httpx.Response(200, json={"name": "Trail Shop", "currency": "KES", "ships_to_countries": ["KE", "UG"]})
        if path == "/cart.js":
            return httpx.Response(200, json={"currency": "KES"})
        if path == "/search/suggest.json":
            return httpx.Response(200, json={"resources": {"results": {"products": [
                {"title": "Trail Boot", "url": "/products/trail-boot?_pos=1&_sid=x"}]}}})
        if path == "/products/trail-boot.js":
            return httpx.Response(200, json={"title": "Trail Boot", "handle": "trail-boot", "vendor": "Merrell",
                                             "featured_image": "//cdn.shopify.com/boot.jpg", "available": True,
                                             "variants": [{"id": 7, "price": 450000, "available": True, "barcode": "123"}]})
    if host == "usonly.com" and path == "/products.json":
        return httpx.Response(200, json=PRODUCTS)
    if host == "usonly.com" and path == "/meta.json":
        return httpx.Response(200, json={"currency": "USD", "ships_to_countries": ["US"]})
    if host == "blog.example":
        return httpx.Response(200, text="<html>not a shop</html>", headers={"content-type": "text/html"})
    return httpx.Response(404)


class _Search(SearchProvider):
    name = "fake"

    def search(self, query: SearchQuery) -> SearchResponse:
        return SearchResponse(provider="fake", query=query.query, results=[
            SearchResult(title="a", url="https://trailshop.co.ke/collections/boots"),
            SearchResult(title="b", url="https://www.usonly.com/"),
            SearchResult(title="c", url="https://blog.example/best-boots"),
            SearchResult(title="d", url="https://www.amazon.com/dp/B000000001"),
        ])


def _fetcher():
    return SafeFetcher(user_agent="t", transport=httpx.MockTransport(handler), resolver=lambda h: ["93.184.216.34"])


def test_discovery_checks_ships_to_and_saves_stores():
    saved = []
    result = discover_stores(
        fetcher=_fetcher(), search=SearchClient([_Search()]),
        find_cached=lambda cats, country, limit: [], upsert=lambda s: saved.append(s) or {**s, "status": "discovered"},
        categories=category_keys(normalise_category("hiking boots")), country="KE", currency="KES",
        queries=["hiking boots shop Nairobi"], max_price=6000)
    assert [s["domain"] for s in result["stores"]] == ["trailshop.co.ke"]
    assert {s["domain"] for s in saved} == {"trailshop.co.ke", "usonly.com"}  # both are Shopify; only one ships to KE
    accepted = {c["domain"]: c["accepted"] for c in result["checked"]}
    assert accepted == {"trailshop.co.ke": True, "usonly.com": False, "blog.example": False}
    assert saved[0]["categories"] == ["Apparel & Accessories > Shoes", "Apparel & Accessories"]


def test_shopify_adapter_search_and_fetch():
    adapter = ShopifyAdapter(AdapterContext(fetcher=_fetcher(), search=None))
    hits = adapter.search("trail boot", "KE", "trailshop.co.ke")
    assert hits[0].url == "https://trailshop.co.ke/products/trail-boot"
    pd = adapter.fetch_product(hits[0].url, fresh=True)
    assert (pd.price, pd.currency, pd.availability, pd.price_source, pd.gtin) == (4500.0, "KES", "in_stock", "shopify_json", "123")
    assert pd.image_url == "https://cdn.shopify.com/boot.jpg"
