"""Scout helper activities: merge_and_rank and FX fetching."""
from __future__ import annotations
from dataclasses import asdict
from typing import Any

from temporalio import activity
from temporalio.exceptions import ApplicationError

from ..config import settings
from ..fx import FxProviderError, fetch_rates
from ..scout.ranking import merge_and_rank as rank
from ..scout.types import CandidateSummary


@activity.defn
def merge_and_rank(candidates: list[dict[str, Any]], profile_currency: str | None, fx: dict[str, float]) -> dict[str, Any]:
    return rank([CandidateSummary(**c) for c in candidates], profile_currency=profile_currency, usd_rates=fx)


@activity.defn
def fetch_fx_rates() -> dict[str, Any]:
    try:
        return asdict(fetch_rates(settings))
    except FxProviderError as exc:
        # Both providers down: keep last known rates in the DB; retry later via Temporal.
        raise ApplicationError(str(exc), type="FxProviderError") from exc
