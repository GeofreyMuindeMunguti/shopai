from __future__ import annotations
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class ProductData:
    """Structured product facts. Price/currency/availability come only from structured data (ADR-0004)."""

    url: str
    final_url: str | None = None
    status_code: int | None = None
    title: str | None = None
    price: float | None = None
    currency: str | None = None
    availability: str = "unknown"          # in_stock | out_of_stock | preorder | unknown
    brand: str | None = None
    gtin: str | None = None
    mpn: str | None = None
    sku: str | None = None
    image_url: str | None = None
    condition: str | None = None           # new | used | refurb
    description: str | None = None         # untrusted page text, truncated
    price_source: str | None = None        # json_ld | opengraph | shopify_json | retailer_api
    is_product_page: bool = False
    rendered: bool = False
    attributes: dict[str, Any] = field(default_factory=dict)

    @property
    def has_price(self) -> bool:
        return self.price is not None and self.price > 0 and bool(self.currency)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ProductData":
        known = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        return cls(**known)
