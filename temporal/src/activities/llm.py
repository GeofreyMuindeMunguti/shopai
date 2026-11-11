"""LLM activity: one model turn per activity, model ref per call (ADR-0003)."""
from __future__ import annotations
import logging
import time
from dataclasses import asdict
from typing import Any

from temporalio import activity
from temporalio.exceptions import ApplicationError

from ..config import settings
from ..llm import LLMConfigError, LLMError, ModelRef, get_provider

logger = logging.getLogger(__name__)


@activity.defn
def llm_converse(request: dict[str, Any]) -> dict[str, Any]:
    """request: {model: model_ref_json, messages, tools?, system?, max_tokens?, temperature?, task?, scout_run_id?}"""
    ref = ModelRef.from_json(request["model"])
    started = time.monotonic()
    try:
        provider = get_provider(ref.provider, settings)
        result = provider.converse(
            request["messages"], request.get("tools"), ref,
            system=request.get("system"), max_tokens=request.get("max_tokens"), temperature=request.get("temperature"),
        )
    except LLMConfigError as exc:
        raise ApplicationError(str(exc), type="LLMConfigError", non_retryable=True) from exc
    except LLMError as exc:
        logger.warning("llm call failed task=%s model_id=%s kind=%s scout_run_id=%s error=%s",
                       request.get("task"), ref.ref, exc.kind, request.get("scout_run_id"), exc)
        raise ApplicationError(str(exc), type=f"LLMError.{exc.kind}", non_retryable=not exc.retryable) from exc
    logger.info("llm call ok task=%s model_id=%s scout_run_id=%s input_tokens=%d output_tokens=%d stop=%s latency_ms=%d",
                request.get("task"), ref.ref, request.get("scout_run_id"), result.input_tokens, result.output_tokens,
                result.stop_reason, (time.monotonic() - started) * 1000)
    out = asdict(result)
    return out
