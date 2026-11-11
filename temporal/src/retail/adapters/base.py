"""Retailer adapter interface (ADR-0006): search, fetch_product, canonicalize_url."""
from __future__ import annotations
import logging
import re
from dataclasses import dataclass

from ...search import SearchClient, SearchQuery
from ..canonical import canonicalize_url, host_matches
from ..extract import extract_product
from ..fetcher import FetchError, RendererClient, SafeFetcher
from ..models import ProductData

logger = logging.getLogger(__name__)


@dataclass
class SearchHit:
    url: str
    title: str = ""
    snippet: str = ""
    price_hint: str | None = None   # informational only; never shown to users


@dataclass
class AdapterContext:
    fetcher: SafeFetcher
    search: SearchClient | None
    renderer: RendererClient | None = None
    amazon_credentials: tuple[str, str, str] | None = None  # (access_key, secret_key, partner_tag)


class AdapterError(Exception):
    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


class RetailerAdapter:
    key = "generic"
    product_url_pattern: re.Pattern[str] | None = None
    always_render = False        # JS-heavy sites (Temu)
    render_fallback = True       # render when the plain fetch has no structured price
    price_may_vary = False

    def __init__(self, ctx: AdapterContext):
        self.ctx = ctx

    def canonicalize_url(self, url: str) -> str:
        return canonicalize_url(url)

    def is_product_url(self, url: str) -> bool:
        return self.product_url_pattern is None or bool(self.product_url_pattern.search(url))

    def search(self, query: str, country: str, domain: str, max_results: int = 8) -> list[SearchHit]:
        """Site-scoped web search (shared fallback for every retailer)."""
        if self.ctx.search is None:
            raise AdapterError("no search provider configured")
        resp = self.ctx.search.search(SearchQuery(query=query, country_code=country, include_domains=[domain],
                                                  max_results=min(max(max_results * 2, 5), 20)))
        hits, seen = [], set()
        for r in resp.results:
            if not host_matches(r.url, domain) or not self.is_product_url(r.url):
                continue
            key = self.canonicalize_url(r.url)
            if key in seen:
                continue
            seen.add(key)
            hits.append(SearchHit(url=r.url, title=r.title, snippet=r.snippet[:300]))
            if len(hits) >= max_results:
                break
        return hits

    def fetch_product(self, url: str, *, fresh: bool = False) -> ProductData:
        """fresh=True bypasses the fetch cache (verification always re-fetches the live page)."""
        canonical = self.canonicalize_url(url)
        pd = ProductData(url=url)
        if not self.always_render:
            res = self.ctx.fetcher.get(url, cache_key=canonical, use_cache=not fresh)
            pd = extract_product(res.text, res.final_url) if res.ok and "html" in res.content_type.lower() else ProductData(url=url)
            pd.url, pd.final_url, pd.status_code = url, res.final_url, res.status_code
            if res.status_code != 200 or pd.has_price or not self.render_fallback:
                return self._finish(pd)
        if self.ctx.renderer is None:
            return self._finish(pd)
        try:
            rendered = self.ctx.renderer.render(url, self.ctx.fetcher.resolver)
        except FetchError as exc:
            logger.warning("render failed adapter=%s url=%s error=%s", self.key, url, exc)
            return self._finish(pd)
        rpd = extract_product(rendered.text, rendered.final_url)
        rpd.url, rpd.final_url, rpd.status_code, rpd.rendered = url, rendered.final_url, rendered.status_code, True
        return self._finish(rpd)

    def _finish(self, pd: ProductData) -> ProductData:
        if self.price_may_vary:
            pd.attributes["price_may_vary"] = True
        return pd
