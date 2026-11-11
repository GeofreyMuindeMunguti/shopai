"""Retail activities: search, fetch, deterministic verification, Shopify store discovery."""
from __future__ import annotations
import logging
from dataclasses import asdict
from typing import Any

from temporalio import activity
from temporalio.exceptions import ApplicationError

from ..fx import convert, within_budget
from ..retail.adapters import AdapterError
from ..retail.canonical import registrable_host
from ..retail.discovery import discover_stores as run_discovery
from ..retail.fetcher import FetchError
from ..retail.taxonomy import category_keys, normalise_category
from ..scout.verification import evaluate
from ..search import SearchProviderError
from . import db
from ._context import get_adapter, get_context, rate_limiter

logger = logging.getLogger(__name__)


def _fail(exc: Exception) -> dict[str, Any] | None:
    """Retryable problems raise (Temporal retries); permanent ones become a tool error for the agent."""
    retryable = getattr(exc, "retryable", False)
    if retryable:
        raise ApplicationError(str(exc), type=type(exc).__name__, non_retryable=False) from exc
    return None


@activity.defn
def retailer_search(request: dict[str, Any]) -> dict[str, Any]:
    """request: {retailer, query, country, max_results?, store_domain?}"""
    retailer = request["retailer"]
    adapter = get_adapter(retailer["adapter_key"])
    domain = request.get("store_domain") if retailer["code"] == "shopify" else retailer.get("domain")
    rate_limiter.wait(retailer["code"], int(retailer.get("rate_limit_per_min") or 30))
    try:
        hits = adapter.search(request["query"], request["country"], domain or "", int(request.get("max_results") or 8))
    except (AdapterError, FetchError, SearchProviderError) as exc:
        _fail(exc)
        return {"ok": False, "error": str(exc), "results": []}
    return {"ok": True, "results": [asdict(h) for h in hits]}


@activity.defn
def fetch_product_page(request: dict[str, Any]) -> dict[str, Any]:
    """request: {retailer, url}. Returns structured data the agent can reason about (untrusted text included)."""
    retailer = request["retailer"]
    adapter = get_adapter(retailer["adapter_key"])
    rate_limiter.wait(retailer["code"], int(retailer.get("rate_limit_per_min") or 30))
    try:
        pd = adapter.fetch_product(request["url"])
    except (AdapterError, FetchError) as exc:
        _fail(exc)
        return {"ok": False, "error": str(exc)}
    return {"ok": pd.status_code == 200, "product": pd.to_dict(), "canonical_url": adapter.canonicalize_url(pd.final_url or pd.url)}


@activity.defn
def verify_candidate(request: dict[str, Any]) -> dict[str, Any]:
    """Deterministic re-fetch + checks (FR-6). request: {retailer, url, item?, fx?, profile_currency?}"""
    retailer = request["retailer"]
    adapter = get_adapter(retailer["adapter_key"])
    rate_limiter.wait(retailer["code"], int(retailer.get("rate_limit_per_min") or 30))
    try:
        pd = adapter.fetch_product(request["url"], fresh=True)
    except (AdapterError, FetchError) as exc:
        _fail(exc)
        return {"verified": False, "reason": f"fetch failed: {exc}", "product": None,
                "canonical_url": adapter.canonicalize_url(request["url"]), "store_domain": registrable_host(request["url"])}

    verified, reason = evaluate(pd, retailer_code=retailer["code"], domain=retailer.get("domain"))
    final_url = pd.final_url or pd.url
    item = request.get("item") or {}
    fx = request.get("fx") or {}
    in_budget = within_budget(pd.price, pd.currency, _num(item.get("max_price")), item.get("currency"), fx)
    converted = None
    if pd.price and pd.currency and request.get("profile_currency"):
        converted = convert(pd.price, pd.currency, request["profile_currency"], fx)
    return {
        "verified": verified,
        "reason": reason,
        "product": pd.to_dict(),
        "canonical_url": adapter.canonicalize_url(final_url),
        "store_domain": registrable_host(final_url),
        "over_budget": in_budget is False,
        "converted_price": round(converted, 2) if converted is not None else None,
    }


def _num(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


@activity.defn
def discover_stores(request: dict[str, Any]) -> dict[str, Any]:
    """request: {category, queries, country, currency, max_price, scout_run_id, fetch_budget}"""
    ctx = get_context()
    path = normalise_category(request.get("category"))
    categories = category_keys(path)
    result = run_discovery(
        fetcher=ctx.fetcher, search=ctx.search,
        find_cached=db.find_shopify_stores, upsert=db.upsert_shopify_store,
        categories=categories, country=request["country"], currency=request.get("currency"),
        queries=[q for q in request.get("queries") or [] if isinstance(q, str) and q.strip()],
        max_price=_num(request.get("max_price")), run_id=request.get("scout_run_id"),
        fetch_budget=int(request.get("fetch_budget") or 12),
    )
    result["category"] = path
    logger.info("store discovery done scout_run_id=%s category=%s stores=%d checked=%d fetches=%d",
                request.get("scout_run_id"), path, len(result["stores"]), len(result["checked"]), result["fetches"])
    return result
