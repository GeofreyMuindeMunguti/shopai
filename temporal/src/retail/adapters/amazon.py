"""Amazon: Product Advertising API when credentials are configured, else site-scoped search + fetch.

PA-API 5.0 (SearchItems/GetItems, SigV4 service "ProductAdvertisingAPI"). Amazon has announced a
successor API for affiliates; confirm the current version and eligibility before relying on it.
Any API failure falls back to search + fetch, so the retailer keeps working without it.
"""
from __future__ import annotations
import json
import logging
import re
from typing import Any

import httpx

from ..canonical import registrable_host
from ..models import ProductData
from .base import AdapterError, RetailerAdapter, SearchHit

logger = logging.getLogger(__name__)

_ASIN = re.compile(r"/(?:dp|gp/product|gp/aw/d)/([A-Z0-9]{10})", re.IGNORECASE)
# domain -> (api host, region, marketplace)
_MARKETPLACES = {
    "amazon.com": ("webservices.amazon.com", "us-east-1", "www.amazon.com"),
    "amazon.co.za": ("webservices.amazon.co.za", "eu-west-1", "www.amazon.co.za"),
}
_RESOURCES = [
    "ItemInfo.Title", "ItemInfo.ByLineInfo", "ItemInfo.ExternalIds", "ItemInfo.ManufactureInfo",
    "Images.Primary.Large", "Offers.Listings.Price", "Offers.Listings.Availability.Type", "Offers.Listings.Condition",
]


class AmazonAdapter(RetailerAdapter):
    key = "amazon"
    product_url_pattern = _ASIN

    def _api(self, domain: str, operation: str, payload: dict[str, Any]) -> dict[str, Any]:
        creds = self.ctx.amazon_credentials
        market = _MARKETPLACES.get(domain.removeprefix("www."))
        if not creds or not market:
            raise AdapterError("amazon api not configured for this marketplace")
        from botocore.auth import SigV4Auth
        from botocore.awsrequest import AWSRequest
        from botocore.credentials import Credentials

        access, secret, tag = creds
        host, region, marketplace = market
        body = json.dumps({**payload, "PartnerTag": tag, "PartnerType": "Associates", "Marketplace": marketplace,
                           "Resources": _RESOURCES})
        url = f"https://{host}/paapi5/{operation.lower()}"
        headers = {"content-type": "application/json; charset=utf-8", "content-encoding": "amz-1.0",
                   "x-amz-target": f"com.amazon.paapi5.v1.ProductAdvertisingAPIv1.{operation}", "host": host}
        req = AWSRequest(method="POST", url=url, data=body, headers=headers)
        SigV4Auth(Credentials(access, secret), "ProductAdvertisingAPI", region).add_auth(req)
        try:
            resp = httpx.post(url, content=body, headers=dict(req.headers.items()), timeout=15)
        except httpx.HTTPError as exc:
            raise AdapterError(f"amazon api request failed: {type(exc).__name__}", retryable=True) from exc
        if resp.status_code != 200:
            raise AdapterError(f"amazon api HTTP {resp.status_code}", retryable=resp.status_code in (429, 500, 503))
        return resp.json()

    @staticmethod
    def _item_to_product(item: dict[str, Any], url: str) -> ProductData:
        info = item.get("ItemInfo", {})
        listing = (item.get("Offers", {}).get("Listings") or [{}])[0]
        price = listing.get("Price", {})
        avail = (listing.get("Availability", {}).get("Type") or "").lower()
        eans = info.get("ExternalIds", {}).get("EANs", {}).get("DisplayValues") or []
        upcs = info.get("ExternalIds", {}).get("UPCs", {}).get("DisplayValues") or []
        return ProductData(
            url=url, final_url=item.get("DetailPageURL") or url, status_code=200,
            title=info.get("Title", {}).get("DisplayValue"),
            price=price.get("Amount"), currency=price.get("Currency"),
            availability="in_stock" if avail == "now" else "preorder" if avail in ("backorder", "preorderable") else "unknown",
            brand=info.get("ByLineInfo", {}).get("Brand", {}).get("DisplayValue"),
            gtin=(eans or upcs or [None])[0],
            mpn=info.get("ManufactureInfo", {}).get("Model", {}).get("DisplayValue"),
            sku=item.get("ASIN"),
            image_url=item.get("Images", {}).get("Primary", {}).get("Large", {}).get("URL"),
            condition=(listing.get("Condition", {}).get("Value") or "").lower() or None,
            price_source="retailer_api" if price.get("Amount") else None,
            is_product_page=True,
        )

    def search(self, query: str, country: str, domain: str, max_results: int = 8) -> list[SearchHit]:
        if self.ctx.amazon_credentials:
            try:
                # SearchItems returns at most 10 per page; ItemCount must stay fixed across pages (offset = page * count).
                per_page = min(max_results, 10)
                items: list[dict[str, Any]] = []
                for page in range(1, -(-max_results // per_page) + 1):
                    data = self._api(domain, "SearchItems", {"Keywords": query, "ItemCount": per_page, "ItemPage": page})
                    batch = data.get("SearchResult", {}).get("Items", [])
                    items.extend(batch)
                    if len(batch) < per_page or len(items) >= max_results:
                        break
                return [SearchHit(url=i["DetailPageURL"], title=i.get("ItemInfo", {}).get("Title", {}).get("DisplayValue", ""))
                        for i in items[:max_results] if i.get("DetailPageURL")]
            except AdapterError as exc:
                logger.warning("amazon api search failed, falling back to web search error=%s", exc)
        return super().search(query, country, domain, max_results)

    def fetch_product(self, url: str, *, fresh: bool = False) -> ProductData:
        m = _ASIN.search(url)
        if self.ctx.amazon_credentials and m:
            try:
                data = self._api(registrable_host(url), "GetItems", {"ItemIds": [m.group(1).upper()]})
                items = data.get("ItemsResult", {}).get("Items", [])
                if items:
                    return self._item_to_product(items[0], url)
            except AdapterError as exc:
                logger.warning("amazon api get failed, falling back to page fetch error=%s", exc)
        return super().fetch_product(url, fresh=fresh)
