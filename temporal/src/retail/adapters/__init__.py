"""Adapter registry keyed by retailers.adapter_key. Adding a retailer = one adapter + one retailers row."""
from __future__ import annotations

from .amazon import AmazonAdapter
from .base import AdapterContext, AdapterError, RetailerAdapter, SearchHit
from .shopify import ShopifyAdapter
from .simple import JumiaAdapter, TakealotAdapter, TemuAdapter

ADAPTERS: dict[str, type[RetailerAdapter]] = {
    "takealot": TakealotAdapter,
    "jumia": JumiaAdapter,
    "amazon": AmazonAdapter,
    "temu": TemuAdapter,
    "shopify": ShopifyAdapter,
    "generic": RetailerAdapter,
}


def adapter_class(adapter_key: str) -> type[RetailerAdapter]:
    try:
        return ADAPTERS[adapter_key]
    except KeyError:
        raise AdapterError(f"no adapter for '{adapter_key}' (available: {', '.join(sorted(ADAPTERS))})") from None


__all__ = ["ADAPTERS", "AdapterContext", "AdapterError", "RetailerAdapter", "SearchHit", "adapter_class"]
