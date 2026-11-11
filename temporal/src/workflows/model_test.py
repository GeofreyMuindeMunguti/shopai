"""ModelTestWorkflow: a Converse call plus a tool-use round trip before a model can be enabled (ADR-0003)."""
from __future__ import annotations
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from ..activities import db as db_acts
    from ..activities.llm import llm_converse
    from .common import LLM_TIMEOUT, classify, db_call

TEST_TOOL = {
    "name": "record_check",
    "description": "Record the result of a connectivity check.",
    "input_schema": {"type": "object", "properties": {
        "status": {"type": "string", "enum": ["ok"]},
        "number": {"type": "integer"},
    }, "required": ["status", "number"]},
}
TEST_RETRY = RetryPolicy(initial_interval=timedelta(seconds=2), maximum_attempts=3,
                         non_retryable_error_types=["LLMError.invalid", "LLMError.access", "LLMConfigError"])


def check_tool_call(resp: dict[str, Any]) -> str | None:
    """None when the model called record_check with valid JSON arguments."""
    calls = resp.get("tool_calls") or []
    if not calls:
        return "model did not call the test tool (tool use is required for scouting)"
    call = calls[0]
    args = call.get("input") or {}
    if call.get("name") != "record_check":
        return f"model called an unexpected tool: {call.get('name')}"
    if args.get("status") != "ok" or not isinstance(args.get("number"), int) or args.get("number") != 42:
        return f"model sent invalid tool arguments: {str(args)[:200]}"
    return None


@workflow.defn
class ModelTestWorkflow:
    @workflow.run
    async def run(self, model_id: str) -> dict[str, Any]:
        model = await db_call(db_acts.model_test_context, model_id)
        if not model:
            return {"model_id": model_id, "ok": False, "error": "model not found"}
        messages: list[dict[str, Any]] = [{"role": "user", "content": [{"type": "text", "text":
            "This is a connectivity check. Call the record_check tool with status \"ok\" and number 42."}]}]
        error: str | None = None
        try:
            first = await workflow.execute_activity(
                llm_converse, {"model": model, "messages": messages, "tools": [TEST_TOOL], "max_tokens": 300,
                               "task": "model_test"},
                start_to_close_timeout=LLM_TIMEOUT, retry_policy=TEST_RETRY)
            error = check_tool_call(first)
            if error is None:
                call = first["tool_calls"][0]
                messages += [first["message"], {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": call["id"], "content": "recorded", "is_error": False}]}]
                await workflow.execute_activity(
                    llm_converse, {"model": model, "messages": messages, "tools": [TEST_TOOL], "max_tokens": 100,
                                   "task": "model_test"},
                    start_to_close_timeout=LLM_TIMEOUT, retry_policy=TEST_RETRY)
        except Exception as exc:
            error = classify(exc)[1]
        await db_call(db_acts.complete_model_test, model_id, error is None, error)
        return {"model_id": model_id, "ok": error is None, "error": error}
