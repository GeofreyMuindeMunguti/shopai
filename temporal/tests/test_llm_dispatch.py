from __future__ import annotations

import boto3
import pytest
from botocore.stub import Stubber
from temporalio.exceptions import WorkflowAlreadyStartedError

from src.config import Settings, missing_required
from src.dispatcher import JobDispatcher, UnknownJobError, workflow_for_job
from src.llm import LLMError, ModelRef
from src.llm.bedrock import BedrockProvider
from src.logging_setup import RedactFilter
from src.scout.tools import tool_specs, validate_submit
from src.workflows.model_test import check_tool_call

REF = ModelRef(provider="bedrock", ref="anthropic.test-model", max_output_tokens=1000)


def _provider():
    client = boto3.client("bedrock-runtime", region_name="us-east-1", endpoint_url="https://bedrock.example",
                          aws_access_key_id="x", aws_secret_access_key="y")
    return BedrockProvider(endpoint_url="unused", region="us-east-1", client=client), Stubber(client)


def test_bedrock_request_and_tool_call_mapping():
    provider, stub = _provider()
    expected = {
        "modelId": "anthropic.test-model",
        "messages": [
            {"role": "user", "content": [{"text": "find boots"}]},
            {"role": "assistant", "content": [{"toolUse": {"toolUseId": "t1", "name": "finish", "input": {"reason": "x"}}}]},
            {"role": "user", "content": [{"toolResult": {"toolUseId": "t1", "content": [{"text": "ok"}], "status": "error"}}]},
        ],
        "inferenceConfig": {"maxTokens": 500},
        "system": [{"text": "sys"}],
        "toolConfig": {"tools": [{"toolSpec": {"name": "finish", "description": "End", "inputSchema": {"json": {"type": "object"}}}}]},
    }
    stub.add_response("converse", {
        "output": {"message": {"role": "assistant", "content": [
            {"text": "Searching."}, {"toolUse": {"toolUseId": "t2", "name": "retailer_search", "input": {"query": "boots"}}}]}},
        "stopReason": "tool_use", "usage": {"inputTokens": 120, "outputTokens": 30, "totalTokens": 150},
        "metrics": {"latencyMs": 10},
    }, expected)
    with stub:
        res = provider.converse(
            [{"role": "user", "content": [{"type": "text", "text": "find boots"}]},
             {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "finish", "input": {"reason": "x"}}]},
             {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok", "is_error": True}]}],
            [{"name": "finish", "description": "End", "input_schema": {"type": "object"}}], REF, system="sys", max_tokens=500)
    assert res.text == "Searching." and res.stop_reason == "tool_use"
    assert (res.input_tokens, res.output_tokens) == (120, 30)
    assert res.tool_calls[0].name == "retailer_search" and res.tool_calls[0].input == {"query": "boots"}
    assert res.message["content"][1] == {"type": "tool_use", "id": "t2", "name": "retailer_search", "input": {"query": "boots"}}


@pytest.mark.parametrize("code,status,kind,retryable", [
    ("ThrottlingException", 429, "throttled", True),
    ("ServiceUnavailableException", 503, "unavailable", True),
    ("ValidationException", 400, "invalid", False),
    ("AccessDeniedException", 403, "access", False),
    ("SomethingNew", 500, "unavailable", True),
])
def test_bedrock_error_mapping(code, status, kind, retryable):
    provider, stub = _provider()
    stub.add_client_error("converse", service_error_code=code, http_status_code=status)
    with stub, pytest.raises(LLMError) as info:
        provider.converse([{"role": "user", "content": [{"type": "text", "text": "hi"}]}], None, REF)
    assert info.value.kind == kind and info.value.retryable is retryable


def test_required_config():
    assert missing_required(Settings(bedrock_endpoint_url=None, aws_region=None)) == ["BEDROCK_ENDPOINT_URL", "AWS_REGION"]
    assert missing_required(Settings(bedrock_endpoint_url="https://x", aws_region="us-east-1")) == []


def test_settings_read_env(monkeypatch):
    monkeypatch.setenv("SCOUT_MAX_ITERATIONS", "7")
    monkeypatch.setenv("bedrock_endpoint_url", "https://bedrock-runtime.us-east-1.amazonaws.com")
    s = Settings()
    assert s.scout_max_iterations == 7 and s.bedrock_endpoint_url.startswith("https://bedrock-runtime")


def test_redaction():
    f = RedactFilter(["super-secret-service-key"])
    assert f.redact("key=super-secret-service-key auth=Bearer abc.def tvly-123456") == "key=*** auth=Bearer *** tvly-***"


def test_workflow_for_job():
    assert workflow_for_job({"job_type": "scout_item", "payload": {"scout_run_id": "r1"}}) == ("ScoutItemWorkflow", ["r1"])
    assert workflow_for_job({"job_type": "scheduled_rescout", "payload": {"scout_run_id": "r2"}}) == ("ScoutItemWorkflow", ["r2"])
    assert workflow_for_job({"job_type": "model_test", "payload": {"model_id": "m"}}) == ("ModelTestWorkflow", ["m"])
    assert workflow_for_job({"job_type": "refresh_fx_rates", "payload": {}}) == ("RefreshFxRatesWorkflow", [])
    with pytest.raises(UnknownJobError):
        workflow_for_job({"job_type": "nope"})
    with pytest.raises(UnknownJobError):
        workflow_for_job({"job_type": "scout_item", "payload": {}})


class _Client:
    def __init__(self, error=None):
        self.error, self.started = error, []

    async def start_workflow(self, name, args, id, task_queue):
        self.started.append((name, args, id))
        if self.error:
            raise self.error


def _dispatcher(client, log):
    return JobDispatcher(client, task_queue="main", claim=lambda n: [],
                         mark_dispatched=lambda j, w: log.append(("mark", j, w)),
                         release=lambda j, e, r: log.append(("release", j, r)) or "queued")


async def test_dispatch_outcomes():
    log: list = []
    client = _Client()
    job = {"id": "j1", "job_type": "scout_item", "payload": {"scout_run_id": "r1"}, "attempts": 1}
    assert await _dispatcher(client, log).dispatch(job) == "started"
    assert client.started == [("ScoutItemWorkflow", ["r1"], "job-j1")] and log == [("mark", "j1", "job-j1")]

    log.clear()
    already = _Client(WorkflowAlreadyStartedError("job-j1", "ScoutItemWorkflow"))
    assert await _dispatcher(already, log).dispatch(job) == "already_started"
    assert log == [("mark", "j1", "job-j1")]

    log.clear()
    assert await _dispatcher(_Client(RuntimeError("temporal down")), log).dispatch(job) == "released"
    assert log == [("release", "j1", True)]

    log.clear()
    assert await _dispatcher(_Client(), log).dispatch({"id": "j2", "job_type": "bogus"}) == "rejected"
    assert log == [("release", "j2", False)]


def test_submit_candidate_validation():
    ok, err = validate_submit({"url": "https://www.takealot.com/x/PLID1", "rationale": "Black, over-ear, ANC as requested.",
                               "match_score": 0.92, "attributes": {"colour": "black", "price": 1}})
    assert err is None and ok.attributes == {"colour": "black"}  # price is never accepted from the model
    for bad in ({"url": "javascript:alert(1)", "rationale": "long enough text", "match_score": 0.5},
                {"url": "https://x.example/p", "rationale": "long enough text", "match_score": 1.5},
                {"url": "https://x.example/p", "match_score": 0.5}):
        cand, err = validate_submit(bad)
        assert cand is None and err.startswith("invalid submit_candidate")


def test_tool_specs_shopify_only_discovery():
    assert "discover_stores" not in {t["name"] for t in tool_specs(False)}
    shopify = {t["name"]: t for t in tool_specs(True)}
    assert "discover_stores" in shopify
    assert "store_domain" in shopify["retailer_search"]["input_schema"]["required"]


def test_model_test_tool_check():
    good = {"tool_calls": [{"id": "1", "name": "record_check", "input": {"status": "ok", "number": 42}}]}
    assert check_tool_call(good) is None
    assert "did not call" in check_tool_call({"tool_calls": []})
    assert "invalid tool arguments" in check_tool_call({"tool_calls": [{"name": "record_check", "input": {"status": "ok", "number": "42"}}]})
