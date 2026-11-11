from __future__ import annotations

from typing import Any

import pytest

from src.retail.adapters import AdapterContext
from src.retail.adapters.amazon import AmazonAdapter
from src.scout.prompts import MAX_SEARCH_OUTPUT_CHARS, untrusted
from src.scout.tools import MAX_SEARCH_RESULTS, tool_specs


def _item(n: int) -> dict[str, Any]:
    return {"DetailPageURL": f"https://www.amazon.com/dp/B0{n:08d}", "ItemInfo": {"Title": {"DisplayValue": f"Item {n}"}}}


class _FakeAmazon(AmazonAdapter):
    def __init__(self, total: int):
        super().__init__(AdapterContext(fetcher=None, search=None, amazon_credentials=("ak", "sk", "tag")))  # type: ignore[arg-type]
        self.total, self.calls = total, []

    def _api(self, domain: str, operation: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(payload)
        start = (payload["ItemPage"] - 1) * payload["ItemCount"]
        return {"SearchResult": {"Items": [_item(i) for i in range(start, min(start + payload["ItemCount"], self.total))]}}


@pytest.mark.parametrize("is_shopify", [False, True])
def test_retailer_search_tool_allows_30_results(is_shopify):
    search = next(t for t in tool_specs(is_shopify) if t["name"] == "retailer_search")
    assert MAX_SEARCH_RESULTS == 30
    assert search["input_schema"]["properties"]["max_results"]["maximum"] == 30


def test_30_search_rows_fit_untruncated():
    rows = [{"url": f"https://www.takealot.com/sony-wh-1000xm5-black-{i}/PLID{90000000 + i}",
             "title": f"Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black {i}", "snippet": "x" * 150}
            for i in range(MAX_SEARCH_RESULTS)]
    out = untrusted(rows, MAX_SEARCH_OUTPUT_CHARS)
    assert "[truncated]" not in out
    assert out.count('"url"') == 30


def test_amazon_search_pages_to_30_with_fixed_item_count():
    adapter = _FakeAmazon(total=100)
    hits = adapter.search("headphones", "US", "amazon.com", max_results=30)
    assert [c["ItemPage"] for c in adapter.calls] == [1, 2, 3]
    assert {c["ItemCount"] for c in adapter.calls} == {10}
    assert len(hits) == 30 and len({h.url for h in hits}) == 30


def test_amazon_search_stops_on_short_page():
    adapter = _FakeAmazon(total=14)
    hits = adapter.search("headphones", "US", "amazon.com", max_results=30)
    assert [c["ItemPage"] for c in adapter.calls] == [1, 2]
    assert len(hits) == 14


def test_amazon_search_small_request_is_single_call():
    adapter = _FakeAmazon(total=100)
    hits = adapter.search("headphones", "US", "amazon.com", max_results=6)
    assert adapter.calls == [{"Keywords": "headphones", "ItemCount": 6, "ItemPage": 1}]
    assert len(hits) == 6
