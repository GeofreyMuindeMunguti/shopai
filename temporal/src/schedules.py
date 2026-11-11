"""Temporal Schedules created idempotently at worker start."""
from __future__ import annotations
import logging
from datetime import timedelta

from temporalio.client import (
    Client,
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleAlreadyRunningError,
    ScheduleIntervalSpec,
    ScheduleOverlapPolicy,
    SchedulePolicy,
    ScheduleSpec,
)

logger = logging.getLogger(__name__)

FX_SCHEDULE_ID = "refresh-fx-rates-daily"
RESCOUT_SCHEDULE_ID = "enqueue-due-rescouts-hourly"


async def ensure_schedules(client: Client, task_queue: str) -> None:
    specs = [
        # Daily at 01:17 UTC (ExchangeRate-API updates once a day; don't poll more than needed).
        (FX_SCHEDULE_ID, "RefreshFxRatesWorkflow", ScheduleSpec(cron_expressions=["17 1 * * *"]), True),
        (RESCOUT_SCHEDULE_ID, "EnqueueDueRescoutsWorkflow",
         ScheduleSpec(intervals=[ScheduleIntervalSpec(every=timedelta(hours=1))]), False),
    ]
    for schedule_id, workflow_name, spec, trigger_now in specs:
        schedule = Schedule(
            action=ScheduleActionStartWorkflow(workflow_name, id=f"{schedule_id}-run", task_queue=task_queue),
            spec=spec,
            policy=SchedulePolicy(overlap=ScheduleOverlapPolicy.SKIP),
        )
        try:
            # First creation of the FX schedule runs once immediately so a fresh install has rates.
            await client.create_schedule(schedule_id, schedule, trigger_immediately=trigger_now)
            logger.info("schedule created schedule_id=%s workflow=%s", schedule_id, workflow_name)
        except ScheduleAlreadyRunningError:
            logger.info("schedule exists schedule_id=%s", schedule_id)
