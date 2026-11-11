from __future__ import annotations

import httpx
import pytest

from src.config import Settings
from src.fx import FxProviderError, convert, fetch_rates, within_budget
from src.scout.ranking import merge_and_rank
from src.scout.types import CandidateSummary

RATES = {"KES": 129.0, "ZAR": 18.0, "USD": 1.0}


def c(mid, retailer, score, price, ccy="ZAR", store=None, gtin=None, over=False):
    return CandidateSummary(match_id=mid, retailer_code=retailer, store_domain=store or f"{retailer}.com",
                            canonical_url=f"https://{retailer}.com/{mid}", title=mid, match_score=score,
                            price=price, currency=ccy, gtin=gtin, over_budget=over)


def test_rank_by_score_then_price_and_best_per_retailer():
    out = merge_and_rank([
        c("a", "takealot", 0.9, 4199), c("b", "amazon", 0.9, 220, "USD"), c("d", "takealot", 0.7, 100),
        c("e", "shopify", 0.6, 1299),
    ], profile_currency="ZAR", usd_rates=RATES)
    ids = [r["match_id"] for r in out["ranked"]]
    # equal scores: b ($220 ≈ R3960) beats a (R4199) on converted price
    assert ids == ["b", "a", "d", "e"]
    assert round(convert(220, "USD", "ZAR", RATES)) == 3960
    assert [r["match_id"] for r in out["ranked"] if r["best_for_retailer"]] == ["b", "a", "e"]


def test_tie_break_uses_converted_price():
    out = merge_and_rank([c("a", "takealot", 0.9, 4199), c("b", "amazon", 0.9, 200, "USD")],
                         profile_currency="ZAR", usd_rates=RATES)
    assert [r["match_id"] for r in out["ranked"]] == ["b", "a"]


def test_dedupe_same_store_by_gtin_keeps_best_but_not_across_retailers():
    out = merge_and_rank([
        c("a", "shopify", 0.8, 100, store="s.com", gtin="0123"), c("b", "shopify", 0.9, 110, store="s.com", gtin="123"),
        c("x", "amazon", 0.5, 7, "USD", gtin="123"),
    ], profile_currency="ZAR", usd_rates=RATES)
    assert out["duplicates"] == [{"match_id": "a", "duplicate_of": "b"}]
    assert {r["match_id"] for r in out["ranked"]} == {"b", "x"}
    assert all(r["best_for_retailer"] for r in out["ranked"])


def test_over_budget_sorts_last():
    out = merge_and_rank([c("a", "takealot", 0.95, 9000, over=True), c("b", "jumia", 0.5, 10)],
                         profile_currency="ZAR", usd_rates=RATES)
    assert [r["match_id"] for r in out["ranked"]] == ["b", "a"]


def test_convert_cross_rate_and_missing():
    assert round(convert(100, "ZAR", "KES", RATES), 2) == round(100 / 18 * 129, 2)
    assert convert(1, "EUR", "KES", RATES) is None
    assert convert(5, "kes", "KES", {}) == 5


def test_within_budget_tolerance():
    # $129 ≈ KSh 16,641; budget 16,200 KES: over by 2.7% -> allowed by the 3% cross-currency tolerance
    assert within_budget(129, "USD", 16200, "KES", RATES) is True
    assert within_budget(140, "USD", 16200, "KES", RATES) is False
    assert within_budget(101, "USD", 100, "USD", RATES) is False   # same currency: no tolerance
    assert within_budget(10, "EUR", 100, "USD", RATES) is None
    assert within_budget(10, "USD", None, None, RATES) is True


def test_fx_primary_then_fallback():
    def handler(request):
        if "er-api" in request.url.host:
            return httpx.Response(500)
        if "jsdelivr" in request.url.host:
            raise httpx.ConnectError("down", request=request)
        return httpx.Response(200, json={"date": "2026-11-11", "usd": {"kes": 129.1, "zar": 17.9, "bad": "x"}})

    snap = fetch_rates(Settings(), transport=httpx.MockTransport(handler))
    assert snap.source == "fawazahmed0" and snap.as_of == "2026-11-11"
    assert snap.rates == {"KES": 129.1, "ZAR": 17.9}


def test_fx_primary_ok_and_both_fail():
    ok = httpx.MockTransport(lambda r: httpx.Response(200, json={
        "result": "success", "time_last_update_unix": 1762819201, "rates": {"USD": 1, "KES": 129.2}}))
    snap = fetch_rates(Settings(), transport=ok)
    assert snap.source == "exchangerate_api_open" and snap.rates["KES"] == 129.2
    with pytest.raises(FxProviderError):
        fetch_rates(Settings(), transport=httpx.MockTransport(lambda r: httpx.Response(503)))
