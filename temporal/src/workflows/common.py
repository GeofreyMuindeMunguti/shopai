"""Shared workflow helpers: retry policies and error classification. Deterministic code only."""
from __future__ import annotations
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError, ChildWorkflowError, TimeoutError as TemporalTimeoutError

DB_RETRY = RetryPolicy(initial_interval=timedelta(seconds=1), backoff_coefficient=2.0,
                       maximum_interval=timedelta(seconds=20), maximum_attempts=6)
LLM_RETRY = RetryPolicy(initial_interval=timedelta(seconds=2), backoff_coefficient=2.0,
                        maximum_interval=timedelta(seconds=30), maximum_attempts=5,
                        non_retryable_error_types=["LLMError.invalid", "LLMError.access", "LLMConfigError"])
RETAIL_RETRY = RetryPolicy(initial_interval=timedelta(seconds=2), backoff_coefficient=2.0,
                           maximum_interval=timedelta(seconds=20), maximum_attempts=3,
                           non_retryable_error_types=["AdapterError"])

DB_TIMEOUT = timedelta(seconds=30)
LLM_TIMEOUT = timedelta(minutes=3)
RETAIL_TIMEOUT = timedelta(minutes=2)


async def db_call(fn: Any, *args: Any) -> Any:
    return await workflow.execute_activity(fn, args=list(args), start_to_close_timeout=DB_TIMEOUT, retry_policy=DB_RETRY)


def error_type(exc: BaseException) -> str | None:
    """ApplicationError.type at the root of an activity/child failure."""
    cur: BaseException | None = exc
    while cur is not None:
        if isinstance(cur, ApplicationError) and cur.type:
            return cur.type
        cur = getattr(cur, "cause", None) or cur.__cause__
    return None


def classify(exc: BaseException) -> tuple[str, str]:
    """(error_kind, message) for run records. llm_unavailable triggers an automatic retry of the run."""
    etype = error_type(exc) or ""
    message = str(getattr(exc, "cause", None) or exc)[:500]
    if etype in ("LLMError.throttled", "LLMError.unavailable"):
        return "llm_unavailable", message
    if etype.startswith("LLMError") or etype == "LLMConfigError":
        return "llm_invalid", message
    if isinstance(exc, (ActivityError, ChildWorkflowError)) and isinstance(getattr(exc, "cause", None), TemporalTimeoutError):
        return "timeout", message
    if etype.startswith(("SearchError", "AdapterError", "FetchError")):
        return "adapter", message
    return "internal", message
