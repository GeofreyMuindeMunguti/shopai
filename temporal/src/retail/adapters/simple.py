"""Search + fetch + JSON-LD adapters (spec: Retailer coverage)."""
from __future__ import annotations
import re

from .base import RetailerAdapter


class TakealotAdapter(RetailerAdapter):
    """ZA. No public product API; pages may be client-rendered, so render as a fallback."""

    key = "takealot"
    product_url_pattern = re.compile(r"/PLID\d+", re.IGNORECASE)


class JumiaAdapter(RetailerAdapter):
    """KE. Product pages end in -<sku>.html; stock and price move often (re-verified on every scheduled run)."""

    key = "jumia"
    product_url_pattern = re.compile(r"/[^/]+-\d+\.html(?:$|\?)", re.IGNORECASE)


class TemuAdapter(RetailerAdapter):
    """US only. JS-heavy with anti-bot measures: always headless-render, and flag prices as variable."""

    key = "temu"
    product_url_pattern = re.compile(r"-g-\d{6,}\.html", re.IGNORECASE)
    always_render = True
    price_may_vary = True
