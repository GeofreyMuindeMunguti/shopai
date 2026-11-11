"""Scheduled maintenance workflows: daily FX refresh (ADR-0009) and the hourly re-scout sweep (FR-10)."""
from __future__ import annotations
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from ..activities import db as db_acts
    from ..activities.scout import fetch_fx_rates
    from .common import db_call

FX_RETRY = RetryPolicy(initial_interval=timedelta(minutes=1), backoff_coefficient=2.0,
                       maximum_interval=timedelta(minutes=30), maximum_attempts=5)


@workflow.defn
class RefreshFxRatesWorkflow:
    @workflow.run
    async def run(self) -> dict[str, Any]:
        snap = await workflow.execute_activity(fetch_fx_rates, start_to_close_timeout=timedelta(minutes=1),
                                               retry_policy=FX_RETRY)
        count = await db_call(db_acts.upsert_fx_rates, snap["as_of"], snap["source"], snap["rates"], snap["base"])
        return {"as_of": snap["as_of"], "source": snap["source"], "rates": count}


@workflow.defn
class EnqueueDueRescoutsWorkflow:
    @workflow.run
    async def run(self) -> int:
        return await db_call(db_acts.enqueue_due_rescouts, 200)
