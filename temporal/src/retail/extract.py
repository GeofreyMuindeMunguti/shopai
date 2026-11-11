"""Deterministic product extraction: schema.org JSON-LD first, OpenGraph second (ADR-0004)."""
from __future__ import annotations
import json
import re
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin

from .models import ProductData

MAX_DESCRIPTION_CHARS = 1200

_AVAILABILITY = {
    "instock": "in_stock", "instoreonly": "in_stock", "onlineonly": "in_stock", "limitedavailability": "in_stock",
    "outofstock": "out_of_stock", "soldout": "out_of_stock", "discontinued": "out_of_stock",
    "preorder": "preorder", "presale": "preorder", "backorder": "preorder",
}
_CONDITION = {"newcondition": "new", "usedcondition": "used", "refurbishedcondition": "refurb", "damagedcondition": "used",
              "new": "new", "used": "used", "refurbished": "refurb"}


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.json_ld: list[str] = []
        self.meta: dict[str, str] = {}
        self.title = ""
        self.text: list[str] = []
        self._in_ld = False
        self._in_title = False
        self._skip = 0
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "script":
            if "ld+json" in a.get("type", "").lower():
                self._in_ld, self._buf = True, []
            else:
                self._skip += 1
        elif tag in ("style", "noscript", "svg"):
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
            if key and "content" in a and key not in self.meta:
                self.meta[key] = a["content"].strip()

    def handle_endtag(self, tag):
        if tag == "script":
            if self._in_ld:
                self.json_ld.append("".join(self._buf))
                self._in_ld = False
            elif self._skip:
                self._skip -= 1
        elif tag in ("style", "noscript", "svg") and self._skip:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_ld:
            self._buf.append(data)
        elif self._in_title:
            self.title += data
        elif not self._skip and data.strip():
            self.text.append(data.strip())


def _loads_lenient(raw: str) -> Any:
    raw = raw.strip().removeprefix("<!--").removesuffix("-->").strip()
    try:
        return json.loads(raw)
    except ValueError:
        pass
    # Common breakage: trailing commas, control characters.
    fixed = re.sub(r",\s*([}\]])", r"\1", raw)
    fixed = re.sub(r"[\x00-\x1f]", " ", fixed)
    try:
        return json.loads(fixed)
    except ValueError:
        return None


def _types(node: dict[str, Any]) -> set[str]:
    t = node.get("@type")
    values = t if isinstance(t, list) else [t]
    return {str(v).split("/")[-1].lower() for v in values if v}


def _walk(node: Any):
    if isinstance(node, list):
        for item in node:
            yield from _walk(item)
    elif isinstance(node, dict):
        yield node
        for key in ("@graph", "mainEntity", "itemListElement", "item"):
            if key in node:
                yield from _walk(node[key])


def _first(value: Any) -> Any:
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _text(value: Any) -> str | None:
    value = _first(value)
    if isinstance(value, dict):
        value = value.get("name") or value.get("@id") or value.get("url")
    if value is None:
        return None
    s = unescape(str(value)).strip()
    return s or None


def _price(value: Any) -> float | None:
    value = _first(value)
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if value > 0 else None
    s = re.sub(r"[^\d.,]", "", str(value))
    if not s:
        return None
    # "1.299,00" -> 1299.00 ; "1,299.00" -> 1299.00 ; "4199" -> 4199
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        head, _, tail = s.rpartition(",")
        s = f"{head.replace(',', '')}.{tail}" if len(tail) == 2 else s.replace(",", "")
    try:
        p = float(s)
    except ValueError:
        return None
    return p if p > 0 else None


def _enum(value: Any, table: dict[str, str]) -> str | None:
    s = _text(value)
    if not s:
        return None
    return table.get(s.split("/")[-1].replace(" ", "").lower())


def _offer(offers: Any) -> dict[str, Any] | None:
    """Pick the best offer: first with a price; AggregateOffer uses lowPrice."""
    candidates = [o for o in _walk(offers) if isinstance(o, dict)]
    for o in candidates:
        types = _types(o)
        price = _price(o.get("price"))
        if price is None and "aggregateoffer" in types:
            price = _price(o.get("lowPrice"))
        if price is None and isinstance(o.get("priceSpecification"), (dict, list)):
            spec = _first(o["priceSpecification"])
            if isinstance(spec, dict):
                price = _price(spec.get("price"))
                o = {**o, "priceCurrency": o.get("priceCurrency") or spec.get("priceCurrency")}
        if price is not None:
            return {**o, "_price": price}
    return None


def _product_nodes(data: Any) -> list[dict[str, Any]]:
    nodes = []
    for node in _walk(data):
        types = _types(node)
        if "product" in types or "productgroup" in types or "individualproduct" in types:
            nodes.append(node)
    return nodes


def _from_json_ld(blocks: list[str], base_url: str) -> ProductData | None:
    for raw in blocks:
        data = _loads_lenient(raw)
        if data is None:
            continue
        for node in _product_nodes(data):
            offer = _offer(node.get("offers"))
            if offer is None and isinstance(node.get("hasVariant"), list):
                for variant in node["hasVariant"]:
                    offer = _offer(variant.get("offers")) if isinstance(variant, dict) else None
                    if offer:
                        break
            image = _first(node.get("image"))
            if isinstance(image, dict):
                image = image.get("url") or image.get("contentUrl")
            pd = ProductData(
                url=base_url,
                title=_text(node.get("name")),
                brand=_text(node.get("brand")),
                gtin=_text(node.get("gtin13") or node.get("gtin12") or node.get("gtin14") or node.get("gtin8") or node.get("gtin")),
                mpn=_text(node.get("mpn")),
                sku=_text(node.get("sku")),
                image_url=urljoin(base_url, image) if isinstance(image, str) else None,
                condition=_enum((offer or {}).get("itemCondition") or node.get("itemCondition"), _CONDITION),
                is_product_page=True,
            )
            if offer:
                pd.price = offer["_price"]
                pd.currency = (_text(offer.get("priceCurrency")) or "").upper() or None
                pd.availability = _enum(offer.get("availability"), _AVAILABILITY) or "unknown"
                pd.price_source = "json_ld"
            return pd
    return None


def _from_open_graph(meta: dict[str, str], base_url: str) -> ProductData | None:
    og_type = meta.get("og:type", "").lower()
    price = _price(meta.get("product:price:amount") or meta.get("og:price:amount") or meta.get("price"))
    if "product" not in og_type and price is None:
        return None
    pd = ProductData(
        url=base_url,
        title=meta.get("og:title") or None,
        brand=meta.get("product:brand") or meta.get("og:brand") or None,
        image_url=urljoin(base_url, meta["og:image"]) if meta.get("og:image") else None,
        condition=_enum(meta.get("product:condition") or meta.get("og:condition"), _CONDITION),
        gtin=meta.get("product:upc") or meta.get("product:ean") or meta.get("gtin13") or None,
        mpn=meta.get("product:mfr_part_no") or None,
        is_product_page=True,
    )
    if price is not None:
        currency = meta.get("product:price:currency") or meta.get("og:price:currency") or meta.get("pricecurrency")
        pd.price = price
        pd.currency = currency.upper() if currency else None
        pd.availability = _enum(meta.get("product:availability") or meta.get("og:availability"), _AVAILABILITY) or "unknown"
        pd.price_source = "opengraph"
    return pd


def extract_product(html: str, url: str) -> ProductData:
    """Extract structured product data. Never guesses a price from free text."""
    parser = _PageParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # malformed markup: keep whatever was parsed
        pass
    pd = _from_json_ld(parser.json_ld, url)
    og = _from_open_graph(parser.meta, url)
    if pd is None:
        pd = og or ProductData(url=url)
    elif og is not None:
        # Fill gaps from OpenGraph, but never mix a JSON-LD price with an OG currency.
        pd.title = pd.title or og.title
        pd.image_url = pd.image_url or og.image_url
        pd.brand = pd.brand or og.brand
        if not pd.has_price and og.has_price:
            pd.price, pd.currency, pd.availability, pd.price_source = og.price, og.currency, og.availability, og.price_source
    pd.title = pd.title or (unescape(parser.title).strip() or None)
    description = parser.meta.get("og:description") or parser.meta.get("description") or " ".join(parser.text)
    pd.description = re.sub(r"\s+", " ", description)[:MAX_DESCRIPTION_CHARS] if description else None
    return pd
