"""AWS Bedrock Converse API provider. Endpoint + region from env; model ref per call."""
from __future__ import annotations
import json
from typing import Any

from .base import ACCESS, INVALID, THROTTLED, UNAVAILABLE, ConverseResult, LLMError, ModelProvider, ModelRef, ToolCall

_ERROR_KINDS = {
    "ThrottlingException": THROTTLED,
    "TooManyRequestsException": THROTTLED,
    "ServiceQuotaExceededException": THROTTLED,
    "ServiceUnavailableException": UNAVAILABLE,
    "InternalServerException": UNAVAILABLE,
    "ModelTimeoutException": UNAVAILABLE,
    "ModelNotReadyException": UNAVAILABLE,
    "ModelStreamErrorException": UNAVAILABLE,
    "ValidationException": INVALID,
    "ModelErrorException": INVALID,
    "AccessDeniedException": ACCESS,
    "ResourceNotFoundException": ACCESS,
    "UnrecognizedClientException": ACCESS,
}


def to_bedrock_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for msg in messages:
        content = []
        for block in msg["content"]:
            kind = block["type"]
            if kind == "text":
                if block["text"]:
                    content.append({"text": block["text"]})
            elif kind == "tool_use":
                content.append({"toolUse": {"toolUseId": block["id"], "name": block["name"], "input": block["input"]}})
            elif kind == "tool_result":
                content.append({"toolResult": {
                    "toolUseId": block["tool_use_id"],
                    "content": [{"text": block["content"] or "(empty)"}],
                    "status": "error" if block.get("is_error") else "success",
                }})
            else:
                raise ValueError(f"unknown content block type {kind}")
        out.append({"role": msg["role"], "content": content})
    return out


def to_bedrock_tools(tools: list[dict[str, Any]]) -> dict[str, Any]:
    return {"tools": [{"toolSpec": {"name": t["name"], "description": t["description"],
                                    "inputSchema": {"json": t["input_schema"]}}} for t in tools]}


def from_bedrock_response(resp: dict[str, Any]) -> ConverseResult:
    message = resp.get("output", {}).get("message", {"role": "assistant", "content": []})
    texts: list[str] = []
    calls: list[ToolCall] = []
    blocks: list[dict[str, Any]] = []
    for block in message.get("content", []):
        if "text" in block:
            texts.append(block["text"])
            blocks.append({"type": "text", "text": block["text"]})
        elif "toolUse" in block:
            tu = block["toolUse"]
            raw = tu.get("input")
            if isinstance(raw, str):  # some models return a JSON string
                try:
                    raw = json.loads(raw)
                except ValueError:
                    raw = {"_raw": raw}
            calls.append(ToolCall(id=tu["toolUseId"], name=tu["name"], input=raw or {}))
            blocks.append({"type": "tool_use", "id": tu["toolUseId"], "name": tu["name"], "input": raw or {}})
    usage = resp.get("usage") or {}
    return ConverseResult(
        text="\n".join(texts).strip(),
        tool_calls=calls,
        stop_reason=resp.get("stopReason", "end_turn"),
        input_tokens=int(usage.get("inputTokens") or 0),
        output_tokens=int(usage.get("outputTokens") or 0),
        message={"role": "assistant", "content": blocks},
    )


class BedrockProvider(ModelProvider):
    name = "bedrock"

    def __init__(self, *, endpoint_url: str, region: str, client: Any = None, timeout_seconds: float = 120.0,
                 access_key_id: str | None = None, secret_access_key: str | None = None, session_token: str | None = None):
        if client is None:
            import boto3
            from botocore.config import Config

            client = boto3.client(
                "bedrock-runtime",
                endpoint_url=endpoint_url,
                region_name=region,
                aws_access_key_id=access_key_id,
                aws_secret_access_key=secret_access_key,
                aws_session_token=session_token,
                # Temporal owns retries; keep botocore's to a minimum so attempts are visible in history.
                config=Config(read_timeout=timeout_seconds, connect_timeout=10, retries={"max_attempts": 1, "mode": "standard"}),
            )
        self._client = client

    def converse(self, messages, tools, model_ref: ModelRef, system=None, max_tokens=None, temperature=None) -> ConverseResult:
        from botocore.exceptions import BotoCoreError, ClientError

        request: dict[str, Any] = {
            "modelId": model_ref.ref,
            "messages": to_bedrock_messages(messages),
            "inferenceConfig": {"maxTokens": min(max_tokens or model_ref.max_output_tokens, model_ref.max_output_tokens)},
        }
        if temperature is not None:
            request["inferenceConfig"]["temperature"] = temperature
        if system:
            request["system"] = [{"text": system}]
        if tools:
            request["toolConfig"] = to_bedrock_tools(tools)
        try:
            resp = self._client.converse(**request)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "Unknown")
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") or 0
            kind = _ERROR_KINDS.get(code, UNAVAILABLE if status >= 500 else INVALID)
            raise LLMError(f"bedrock {code}: {exc.response.get('Error', {}).get('Message', '')[:300]}",
                           kind=kind, provider=self.name) from exc
        except BotoCoreError as exc:
            raise LLMError(f"bedrock transport error: {type(exc).__name__}", kind=UNAVAILABLE, provider=self.name) from exc
        return from_bedrock_response(resp)
