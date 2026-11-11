"""Workflow I/O types. Plain dataclasses so Temporal's default JSON converter handles them."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Budget:
    iterations: int
    fetches: int
    tokens: int


@dataclass
class RetailerScoutInput:
    scout_run_id: str
    retailer: dict[str, Any]            # {code, display_name, adapter_key, domain, is_cross_border, rate_limit_per_min}
    item: dict[str, Any]
    country_code: str
    profile_currency: str | None
    model: dict[str, Any]               # model_ref_json from begin_scout_run
    task_models: dict[str, Any]
    preferences: dict[str, Any]
    preference_summary: str | None
    category: str | None
    existing_canonical_urls: list[str]
    fx: dict[str, float]
    budget: Budget
    discovery_queries: list[str] = field(default_factory=list)


@dataclass
class CandidateSummary:
    match_id: str
    retailer_code: str
    store_domain: str
    canonical_url: str
    title: str
    match_score: float
    price: float | None
    currency: str | None
    gtin: str | None = None
    mpn: str | None = None
    brand: str | None = None
    over_budget: bool = False


@dataclass
class RetailerScoutResult:
    retailer_code: str
    status: str                          # completed | no_matches | failed
    matches: int = 0
    candidates: list[CandidateSummary] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    tool_calls: int = 0
    pages_fetched: int = 0
    iterations: int = 0
    budget_exhausted: bool = False
    error: str | None = None
    error_kind: str | None = None        # llm_unavailable | llm_invalid | adapter | internal
