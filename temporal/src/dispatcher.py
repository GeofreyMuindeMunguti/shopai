"""JobDispatcher: polls the workflow_jobs outbox and starts workflows idempotently (ADR-0002)."""
from __future__ import annotations
import asyncio
import logging
from typing import Any, Callable

from temporalio.client import Client
from temporalio.exceptions import WorkflowAlreadyStartedError

from .activities import db

logger = logging.getLogger(__name__)

# job_type -> (workflow name, payload key passed as the single argument, or None for no args)
JOB_WORKFLOWS: dict[str, tuple[str, str | None]] = {
    "scout_item": ("ScoutItemWorkflow", "scout_run_id"),
    "scheduled_rescout": ("ScoutItemWorkflow", "scout_run_id"),
    "model_test": ("ModelTestWorkflow", "model_id"),
    "refresh_fx_rates": ("RefreshFxRatesWorkflow", None),
}


class UnknownJobError(ValueError):
    pass


def workflow_for_job(job: dict[str, Any]) -> tuple[str, list[Any]]:
    try:
        name, key = JOB_WORKFLOWS[job["job_type"]]
    except KeyError:
        raise UnknownJobError(f"unknown job_type {job.get('job_type')}") from None
    if key is None:
        return name, []
    value = (job.get("payload") or {}).get(key)
    if not value:
        raise UnknownJobError(f"job payload is missing {key}")
    return name, [value]


class JobDispatcher:
    def __init__(
        self,
        client: Client,
        *,
        task_queue: str,
        poll_interval: float = 2.0,
        batch_size: int = 10,
        claim: Callable[[int], list[dict[str, Any]]] = db.claim_workflow_jobs,
        mark_dispatched: Callable[[str, str], None] = db.mark_job_dispatched,
        release: Callable[[str, str, bool], Any] = db.release_workflow_job,
    ):
        self.client = client
        self.task_queue = task_queue
        self.poll_interval = poll_interval
        self.batch_size = batch_size
        self._claim, self._mark, self._release = claim, mark_dispatched, release
        self._stopping = asyncio.Event()

    def stop(self) -> None:
        self._stopping.set()

    async def run_forever(self) -> None:
        logger.info("job dispatcher started task_queue=%s poll_interval=%s batch=%d",
                    self.task_queue, self.poll_interval, self.batch_size)
        while not self._stopping.is_set():
            try:
                claimed = await self.poll_once()
            except Exception as exc:  # Supabase down: jobs wait in Postgres, nothing is lost
                logger.warning("job poll failed error=%s", exc)
                claimed = 0
            if claimed < self.batch_size:
                try:
                    await asyncio.wait_for(self._stopping.wait(), timeout=self.poll_interval)
                except asyncio.TimeoutError:
                    pass

    async def poll_once(self) -> int:
        jobs = await asyncio.to_thread(self._claim, self.batch_size)
        for job in jobs:
            await self.dispatch(job)
        return len(jobs)

    async def dispatch(self, job: dict[str, Any]) -> str:
        job_id = str(job["id"])
        workflow_id = f"job-{job_id}"
        try:
            name, args = workflow_for_job(job)
        except UnknownJobError as exc:
            await asyncio.to_thread(self._release, job_id, str(exc), False)
            logger.error("job rejected job_id=%s job_type=%s error=%s", job_id, job.get("job_type"), exc)
            return "rejected"
        try:
            await self.client.start_workflow(name, args=args, id=workflow_id, task_queue=self.task_queue)
            outcome = "started"
        except WorkflowAlreadyStartedError:
            outcome = "already_started"  # idempotent: a previous claim already started it
        except Exception as exc:
            state = await asyncio.to_thread(self._release, job_id, f"{type(exc).__name__}: {exc}", True)
            logger.warning("job start failed job_id=%s job_type=%s attempts=%s next=%s error=%s",
                           job_id, job.get("job_type"), job.get("attempts"), state, exc)
            return "released"
        await asyncio.to_thread(self._mark, job_id, workflow_id)
        logger.info("job dispatched job_id=%s job_type=%s workflow_id=%s outcome=%s",
                    job_id, job["job_type"], workflow_id, outcome)
        return outcome
