from __future__ import annotations
import asyncio
import logging
import sys
from concurrent.futures import ThreadPoolExecutor

from temporalio.client import Client
from temporalio.worker import Worker

from .config import missing_required, settings
from .logging_setup import configure_logging
from .activities import db, llm, notifications, retail, scout, search, supabase_core
from .dispatcher import JobDispatcher
from .schedules import ensure_schedules
from .search import SearchConfigError, build_search_client
from .supabase_client import SupabaseError
from .workflows.example.approval_workflow import ApprovalWorkflow
from .workflows.maintenance import EnqueueDueRescoutsWorkflow, RefreshFxRatesWorkflow
from .workflows.model_test import ModelTestWorkflow
from .workflows.scout_item import ScoutItemWorkflow
from .workflows.scout_retailer import ScoutRetailerWorkflow

logger = logging.getLogger(__name__)


async def _bootstrap_model() -> None:
    """First llm_models row from BEDROCK_BOOTSTRAP_MODEL_ID (no-op once any platform model exists)."""
    if not settings.bedrock_bootstrap_model_id:
        return
    try:
        model_id = await asyncio.to_thread(db.bootstrap_platform_model, settings.bedrock_bootstrap_model_id)
    except SupabaseError as exc:
        logger.warning("bootstrap model failed error=%s", exc)
        return
    if model_id:
        logger.info("bootstrap model created llm_model_id=%s model_ref=%s", model_id, settings.bedrock_bootstrap_model_id)


async def main() -> None:
    configure_logging(settings)
    missing = missing_required(settings)
    if missing:
        logger.error("worker config invalid: missing required env vars %s (see .env.example)", ",".join(missing))
        sys.exit(2)
    try:
        build_search_client(settings)
    except SearchConfigError as exc:
        # Don't block boot: workflows that don't search keep working; web_search fails non-retryably until fixed.
        logger.warning("search provider misconfigured provider=%s error=%s", settings.search_provider, exc)

    await _bootstrap_model()

    logger.info("connecting to temporal address=%s namespace=%s", settings.temporal_address, settings.temporal_namespace)
    client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    if settings.enable_schedules:
        try:
            await ensure_schedules(client, settings.temporal_task_queue)
        except Exception as exc:
            logger.warning("schedule setup failed error=%s", exc)

    activity_executor = ThreadPoolExecutor(max_workers=32)
    worker = Worker(
        client,
        task_queue=settings.temporal_task_queue,
        workflows=[
            ApprovalWorkflow,
            ScoutItemWorkflow,
            ScoutRetailerWorkflow,
            ModelTestWorkflow,
            RefreshFxRatesWorkflow,
            EnqueueDueRescoutsWorkflow,
        ],
        activities=[
            supabase_core.create_entity,
            supabase_core.update_entity_scd2,
            supabase_core.get_entity,
            supabase_core.append_event,
            supabase_core.create_relationship,
            notifications.send_email,
            notifications.send_notification,
            search.web_search,
            llm.llm_converse,
            db.begin_scout_run,
            db.set_retailer_result,
            db.record_candidate,
            db.mark_match_stale,
            db.finish_scout_run,
            db.model_test_context,
            db.complete_model_test,
            db.upsert_fx_rates,
            db.enqueue_due_rescouts,
            retail.retailer_search,
            retail.fetch_product_page,
            retail.verify_candidate,
            retail.discover_stores,
            scout.merge_and_rank,
            scout.fetch_fx_rates,
        ],
        activity_executor=activity_executor,
        max_concurrent_activities=32,
    )
    dispatcher = JobDispatcher(client, task_queue=settings.temporal_task_queue,
                               poll_interval=settings.job_poll_interval_seconds,
                               batch_size=settings.job_claim_batch_size)

    logger.info("worker started task_queue=%s", settings.temporal_task_queue)
    await asyncio.gather(worker.run(), dispatcher.run_forever())


if __name__ == "__main__":
    asyncio.run(main())
