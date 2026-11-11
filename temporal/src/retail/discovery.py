"""Shopify store discovery (spec: Store discovery, steps 1-7). Deterministic; the LLM only proposes queries."""
from __future__ import annotations
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from ..search import SearchClient, SearchProviderError, SearchQuery
from .canonical import registrable_host
from .fetcher import FetchError, SafeFetcher

logger = logging.getLogger(__name__)

# Marketplaces and aggregators that show up in "shop" searches but aren't independent stores.
_NOT_STORES = {
    "amazon.com", "amazon.co.za", "takealot.com", "jumia.co.ke", "temu.com", "ebay.com", "etsy.com", "walmart.com",
    "aliexpress.com", "google.com", "facebook.com", "instagram.com", "youtube.com", "pinterest.com", "reddit.com",
    "tiktok.com", "shopify.com", "wikipedia.org", "makro.co.za", "kilimall.co.ke", "bestbuy.com", "target.com",
}


@dataclass
class StoreCheck:
    domain: str
    is_shopify: bool = False
    ships_to: list[str] = field(default_factory=list)
    currency: str | None = None
    display_name: str | None = None
    product_count: int = 0
    priced_products: int = 0
    min_price: float | None = None
    quality_score: float = 0.0
    reasons: list[str] = field(default_factory=list)
    fetches: int = 0

    def details(self) -> dict[str, Any]:
        return {"product_count": self.product_count, "priced_products": self.priced_products,
                "min_price": self.min_price, "reasons": self.reasons}


def _json(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return None


def check_store(fetcher: SafeFetcher, domain: str, *, country: str, currency: str | None,
                max_price: float | None = None) -> StoreCheck:
    """Steps 3-5: confirm Shopify, check ships-to + currency, compute a 0-1 quality score."""
    chk = StoreCheck(domain=domain)
    try:
        res = fetcher.get(f"https://{domain}/products.json?limit=30")
        chk.fetches += 1
    except FetchError as exc:
        chk.reasons.append(f"products.json unreachable: {exc.kind}")
        return chk
    data = _json(res.text) if res.ok else None
    shopify_header = any(h in res.headers for h in ("x-shopid", "x-shopify-stage", "x-sorting-hat-shopid", "x-shardid")) \
        or "shopify" in res.headers.get("powered-by", "").lower()
    if not (isinstance(data, dict) and isinstance(data.get("products"), list)) and not shopify_header:
        chk.reasons.append("not a Shopify storefront")
        return chk
    chk.is_shopify = True
    products = (data or {}).get("products") or []
    chk.product_count = len(products)
    prices = []
    for p in products:
        for v in (p.get("variants") or [])[:1]:
            try:
                price = float(v.get("price"))
            except (TypeError, ValueError):
                continue
            if price > 0:
                prices.append(price)
    chk.priced_products = len(prices)
    chk.min_price = min(prices) if prices else None

    try:
        meta_res = fetcher.get(f"https://{domain}/meta.json")
        chk.fetches += 1
        meta = _json(meta_res.text) if meta_res.ok else None
    except FetchError:
        meta = None
    if isinstance(meta, dict):
        chk.display_name = meta.get("name")
        chk.currency = (meta.get("currency") or "").upper() or None
        chk.ships_to = sorted({str(c).upper() for c in meta.get("ships_to_countries") or [] if isinstance(c, str)})
    if not chk.ships_to:
        chk.reasons.append("ships-to countries unknown")
    elif country.upper() not in chk.ships_to and "*" not in chk.ships_to:
        chk.reasons.append(f"does not ship to {country}")

    # Quality gate (step 5). HTTPS is implied by the https:// fetch succeeding.
    score = 0.2 + 0.2  # https + confirmed Shopify
    if country.upper() in chk.ships_to or "*" in chk.ships_to:
        score += 0.25
    score += 0.15 * min(chk.product_count, 20) / 20
    score += 0.1 if chk.priced_products >= max(1, chk.product_count // 2) else 0
    if currency and chk.currency == currency.upper():
        score += 0.1
    if max_price and chk.min_price and chk.currency == (currency or "").upper() and chk.min_price > 3 * max_price:
        chk.reasons.append("prices far above budget")
        score -= 0.3
    if chk.product_count < 3:
        chk.reasons.append("catalogue too small")
        score -= 0.2
    chk.quality_score = round(max(0.0, min(1.0, score)), 3)
    return chk


def store_is_usable(chk: StoreCheck, country: str, min_score: float = 0.5) -> bool:
    ships = country.upper() in chk.ships_to or "*" in chk.ships_to
    return chk.is_shopify and ships and chk.quality_score >= min_score and chk.priced_products > 0


def discover_stores(
    *,
    fetcher: SafeFetcher,
    search: SearchClient | None,
    find_cached: Callable[[list[str], str, int], list[dict[str, Any]]],
    upsert: Callable[[dict[str, Any]], dict[str, Any]],
    categories: list[str],
    country: str,
    currency: str | None,
    queries: list[str],
    max_price: float | None = None,
    run_id: str | None = None,
    min_cached: int = 8,
    top_k: int = 5,
    max_new_checks: int = 6,
    fetch_budget: int = 12,
) -> dict[str, Any]:
    """Cache first, search for more if thin, check + save new stores, return the top K."""
    stores = {s["domain"]: s for s in find_cached(categories, country, min_cached * 2)}
    fetches = 0
    checked: list[dict[str, Any]] = []
    if len(stores) < min_cached and queries and search is not None:
        candidates: list[str] = []
        for q in queries[:4]:
            try:
                resp = search.search(SearchQuery(query=q, country_code=country, max_results=10))
            except SearchProviderError as exc:
                logger.warning("store discovery search failed kind=%s error=%s", exc.kind, exc)
                continue
            for r in resp.results:
                domain = registrable_host(r.url)
                if domain and domain not in _NOT_STORES and domain not in stores and domain not in candidates:
                    candidates.append(domain)
        for domain in candidates[:max_new_checks]:
            if fetches + 2 > fetch_budget:
                break
            chk = check_store(fetcher, domain, country=country, currency=currency, max_price=max_price)
            fetches += chk.fetches
            if not chk.is_shopify:
                checked.append({"domain": domain, "accepted": False, "reasons": chk.reasons})
                continue
            row = upsert({
                "domain": domain, "display_name": chk.display_name, "ships_to": chk.ships_to, "currency": chk.currency,
                "categories": categories, "quality_score": chk.quality_score, "discovered_by_run_id": run_id,
                "check_details": chk.details(),
            })
            accepted = row.get("status") != "blocked" and store_is_usable(chk, country)
            checked.append({"domain": domain, "accepted": accepted, "score": chk.quality_score, "reasons": chk.reasons})
            if accepted:
                stores[domain] = row

    ranked = sorted(stores.values(), key=lambda s: (s.get("status") != "seed", -(float(s.get("quality_score") or 0))))
    top = [{"domain": s["domain"], "display_name": s.get("display_name"), "currency": s.get("currency"),
            "quality_score": s.get("quality_score"), "seed": s.get("status") == "seed"} for s in ranked[:top_k]]
    return {"stores": top, "checked": checked, "fetches": fetches}
