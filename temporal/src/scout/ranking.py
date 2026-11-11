"""merge_and_rank (FR-4): dedupe by canonical URL / GTIN / MPN, best per retailer, rank by score then price."""
from __future__ import annotations
from dataclasses import asdict
from typing import Any

from ..fx import convert
from .types import CandidateSummary


def _identity(c: CandidateSummary) -> str:
    if c.gtin:
        return "gtin:" + c.gtin.lstrip("0")
    if c.mpn:
        return f"mpn:{(c.brand or '').lower()}:{c.mpn.lower()}"
    return "url:" + c.canonical_url


def merge_and_rank(candidates: list[CandidateSummary], *, profile_currency: str | None,
                   usd_rates: dict[str, float]) -> dict[str, Any]:
    """Returns {"ranked": [...], "duplicates": [{"match_id", "duplicate_of"}]}.

    The same product on two retailers is NOT a duplicate (users compare prices across retailers);
    duplicates are the same identity at the same store. Over-budget candidates sort after in-budget ones.
    """
    best: dict[tuple[str, str], CandidateSummary] = {}
    duplicates: list[dict[str, str]] = []
    for c in candidates:
        key = (c.store_domain, _identity(c))
        cur = best.get(key)
        if cur is None:
            best[key] = c
            continue
        keep, drop = (c, cur) if (c.match_score, -(c.price or 0)) > (cur.match_score, -(cur.price or 0)) else (cur, c)
        best[key] = keep
        if drop.match_id != keep.match_id:
            duplicates.append({"match_id": drop.match_id, "duplicate_of": keep.match_id})

    def sort_price(c: CandidateSummary) -> float:
        if c.price is None:
            return float("inf")
        if profile_currency and c.currency:
            converted = convert(c.price, c.currency, profile_currency, usd_rates)
            if converted is not None:
                return converted
        return c.price

    ranked = sorted(best.values(), key=lambda c: (c.over_budget, -c.match_score, sort_price(c)))
    best_per_retailer: dict[str, str] = {}
    for c in ranked:
        best_per_retailer.setdefault(c.retailer_code, c.match_id)
    out = []
    for i, c in enumerate(ranked, start=1):
        row = asdict(c)
        row["rank"] = i
        row["best_for_retailer"] = best_per_retailer.get(c.retailer_code) == c.match_id
        out.append(row)
    return {"ranked": out, "duplicates": duplicates, "best_per_retailer": best_per_retailer}
