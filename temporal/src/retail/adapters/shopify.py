"""Shopify storefronts: public /search/suggest.json and /products/<handle>.js, JSON-LD fallback."""
from __future__ import annotations
import json
import logging
import re
from urllib.parse import parse_qs, quote_plus, urlsplit

from ..canonical import registrable_host
from ..fetcher import FetchError
from ..models import ProductData
from .base import AdapterError, RetailerAdapter, SearchHit

logger = logging.getLogger(__name__)

_HANDLE = re.compile(r"/products/([^/?#.]+)")


def _json(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return None


class ShopifyAdapter(RetailerAdapter):
    key = "shopify"
    product_url_pattern = _HANDLE

    def __init__(self, ctx):
        super().__init__(ctx)
        self._currency: dict[str, str | None] = {}

    def store_currency(self, domain: str) -> str | None:
        """Storefront currency from /cart.js (falls back to /meta.json)."""
        if domain not in self._currency:
            currency = None
            for path in ("/cart.js", "/meta.json"):
                try:
                    res = self.ctx.fetcher.get(f"https://{domain}{path}")
                except FetchError:
                    continue
                data = _json(res.text) if res.ok else None
                if isinstance(data, dict) and data.get("currency"):
                    currency = str(data["currency"]).upper()
                    break
            self._currency[domain] = currency
        return self._currency[domain]

    def search(self, query: str, country: str, domain: str, max_results: int = 8) -> list[SearchHit]:
        if not domain or domain == "*":
            raise AdapterError("store_domain is required for Shopify searches (use discover_stores first)")
        domain = registrable_host(f"https://{domain}") if "://" not in domain else registrable_host(domain)
        url = (f"https://{domain}/search/suggest.json?q={quote_plus(query)}"
               f"&resources[type]=product&resources[limit]={min(max_results, 10)}")
        try:
            res = self.ctx.fetcher.get(url)
        except FetchError as exc:
            raise AdapterError(f"store search failed: {exc}", retryable=exc.retryable) from exc
        data = _json(res.text) if res.ok else None
        products = (((data or {}).get("resources") or {}).get("results") or {}).get("products") or []
        hits = []
        for p in products[:max_results]:
            path = (p.get("url") or "").split("?")[0]
            if not path:
                continue
            hits.append(SearchHit(url=f"https://{domain}{path}", title=p.get("title") or "",
                                  snippet=(p.get("body") or "")[:200], price_hint=str(p.get("price") or "") or None))
        if not hits and self.ctx.search is not None:
            return super().search(query, country, domain, max_results)
        return hits

    def fetch_product(self, url: str, *, fresh: bool = False) -> ProductData:
        parts = urlsplit(url)
        m = _HANDLE.search(parts.path)
        if not m:
            return super().fetch_product(url, fresh=fresh)
        domain = parts.netloc.lower()
        try:
            res = self.ctx.fetcher.get(f"https://{domain}/products/{m.group(1)}.js", use_cache=not fresh)
        except FetchError:
            return super().fetch_product(url, fresh=fresh)
        data = _json(res.text) if res.ok else None
        if not isinstance(data, dict) or "variants" not in data:
            return super().fetch_product(url, fresh=fresh)  # JSON endpoints disabled on this store

        variant_id = (parse_qs(parts.query).get("variant") or [None])[0]
        variants = data.get("variants") or []
        variant = next((v for v in variants if str(v.get("id")) == variant_id), None) or \
            next((v for v in variants if v.get("available")), None) or (variants[0] if variants else {})
        cents = variant.get("price", data.get("price"))
        currency = self.store_currency(domain)
        image = data.get("featured_image") or ""
        if image.startswith("//"):
            image = "https:" + image
        pd = ProductData(
            url=url, final_url=f"https://{domain}/products/{data.get('handle') or m.group(1)}", status_code=200,
            title=data.get("title"),
            price=round(float(cents) / 100, 2) if isinstance(cents, (int, float)) and cents > 0 else None,
            currency=currency,
            availability="in_stock" if variant.get("available", data.get("available")) else "out_of_stock",
            brand=data.get("vendor"), gtin=variant.get("barcode") or None, sku=variant.get("sku") or None,
            image_url=image or None,
            description=re.sub(r"<[^>]+>", " ", data.get("description") or "")[:1200] or None,
            price_source="shopify_json", is_product_page=True,
            attributes={"variant": variant.get("title"), "product_type": data.get("type"), "tags": (data.get("tags") or [])[:10]},
        )
        if not pd.has_price:  # no currency from cart.js: try JSON-LD on the page
            page = super().fetch_product(url, fresh=fresh)
            if page.has_price:
                return page
        return pd
