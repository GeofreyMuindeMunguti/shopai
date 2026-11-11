"""Deterministic verification rules (FR-6, ADR-0004). No LLM involved."""
from __future__ import annotations
from typing import Any

from ..retail.canonical import host_matches
from ..retail.models import ProductData

PRICE_MOVE_TOLERANCE = 0.05


def evaluate(pd: ProductData, *, retailer_code: str, domain: str | None) -> tuple[bool, str]:
    """Verified = HTTP 200 after redirects, a product page, and a price + currency from structured data."""
    if pd.status_code != 200:
        return False, f"page returned HTTP {pd.status_code}"
    final = pd.final_url or pd.url
    if retailer_code != "shopify" and domain and domain != "*" and not host_matches(final, domain):
        return False, f"page redirected off {domain}"
    if not pd.is_product_page:
        return False, "not a product page (no structured product data)"
    if not pd.has_price:
        return False, "no price in structured data"
    if pd.price_source not in ("json_ld", "opengraph", "shopify_json", "retailer_api"):
        return False, "price source not trusted"
    return True, "verified"


def stale_reason(existing: dict[str, Any], pd: ProductData, verified: bool, why: str) -> str | None:
    """Re-check of an existing match (scheduled runs). None = still good."""
    if not verified:
        return why
    if pd.availability == "out_of_stock":
        return "out of stock"
    old_price, old_ccy = existing.get("price"), existing.get("currency")
    if old_price and pd.price and old_ccy == pd.currency:
        if abs(pd.price - float(old_price)) / float(old_price) > PRICE_MOVE_TOLERANCE and pd.price > float(old_price):
            return f"price moved from {old_ccy} {old_price} to {pd.currency} {pd.price}"
    return None
