"""Activities wrapping the worker RPCs in supabase/migrations/20261111120100_wishlist_rpcs.sql."""
from __future__ import annotations
import logging
from typing import Any

from temporalio import activity

from ..supabase_client import SupabaseError, get_supabase
from ._context import supabase_app_error

logger = logging.getLogger(__name__)


def _rpc(fn: str, params: dict[str, Any]) -> Any:
    try:
        return get_supabase().rpc(fn, params)
    except SupabaseError as exc:
        raise supabase_app_error(exc) from exc


@activity.defn
def begin_scout_run(scout_run_id: str, workflow_id: str) -> dict[str, Any]:
    return _rpc("begin_scout_run", {"p_scout_run_id": scout_run_id, "p_workflow_id": workflow_id})


@activity.defn
def set_retailer_result(scout_run_id: str, retailer_code: str, result: dict[str, Any]) -> None:
    _rpc("set_retailer_result", {"p_scout_run_id": scout_run_id, "p_retailer_code": retailer_code, "p_result": result})


@activity.defn
def record_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    return _rpc("record_candidate", {"p_candidate": candidate})


@activity.defn
def mark_match_stale(match_id: str, reason: str) -> str:
    return _rpc("mark_match_stale", {"p_match_id": match_id, "p_reason": reason})


@activity.defn
def finish_scout_run(scout_run_id: str, status: str, stats: dict[str, Any], error: str | None) -> dict[str, Any]:
    # Persist merge_and_rank output (rank, best-per-retailer, hidden duplicates) before the
    # run finishes, so the UI never sees a finished run without its ordering.
    ranking, duplicates = stats.pop("ranking", None), stats.pop("duplicates", None)
    if ranking or duplicates:
        _rpc("apply_scout_ranking", {"p_scout_run_id": scout_run_id, "p_ranking": ranking or [],
                                     "p_duplicates": duplicates or []})
    result = _rpc("finish_scout_run", {"p_scout_run_id": scout_run_id, "p_status": status, "p_stats": stats,
                                       "p_error": error})
    logger.info("scout run finished scout_run_id=%s status=%s input_tokens=%s output_tokens=%s pages=%s",
                scout_run_id, status, stats.get("input_tokens"), stats.get("output_tokens"), stats.get("pages_fetched"))
    return result or {}


@activity.defn
def model_test_context(model_id: str) -> dict[str, Any] | None:
    return _rpc("model_test_context", {"p_model_id": model_id})


@activity.defn
def complete_model_test(model_id: str, ok: bool, error: str | None) -> None:
    _rpc("complete_model_test", {"p_model_id": model_id, "p_ok": ok, "p_error": error})
    logger.info("model test completed model_id=%s ok=%s", model_id, ok)


@activity.defn
def upsert_fx_rates(as_of: str, source: str, rates: dict[str, float], base: str) -> int:
    return _rpc("upsert_fx_rates", {"p_as_of": as_of, "p_source": source, "p_rates": rates, "p_base": base})


@activity.defn
def enqueue_due_rescouts(limit: int) -> int:
    count = _rpc("enqueue_due_rescouts", {"p_limit": limit})
    logger.info("due rescouts enqueued count=%s", count)
    return int(count or 0)


# Not activities: used directly by the dispatcher loop and worker startup.

def claim_workflow_jobs(limit: int) -> list[dict[str, Any]]:
    return get_supabase().rpc("claim_workflow_jobs", {"p_limit": limit}) or []


def mark_job_dispatched(job_id: str, workflow_id: str) -> None:
    get_supabase().rpc("mark_job_dispatched", {"p_job_id": job_id, "p_workflow_id": workflow_id})


def release_workflow_job(job_id: str, error: str, retryable: bool) -> str | None:
    return get_supabase().rpc("release_workflow_job", {"p_job_id": job_id, "p_error": error, "p_retryable": retryable})


def bootstrap_platform_model(ref: str, display_name: str | None = None) -> str | None:
    return get_supabase().rpc("bootstrap_platform_model", {"p_ref": ref, "p_display_name": display_name})


def find_shopify_stores(categories: list[str], country: str, limit: int) -> list[dict[str, Any]]:
    return get_supabase().rpc("find_shopify_stores", {"p_categories": categories, "p_country": country, "p_limit": limit}) or []


def upsert_shopify_store(store: dict[str, Any]) -> dict[str, Any]:
    return get_supabase().rpc("upsert_shopify_store", {"p_store": store}) or {}
