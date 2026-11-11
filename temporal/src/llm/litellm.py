"""LiteLLM proxy provider: Anthropic Messages API (/v1/messages) with a proxy key. Model ref per call."""
from __future__ import annotations
from typing import Any

import httpx

from .base import ACCESS, INVALID, THROTTLED, UNAVAILABLE, ConverseResult, LLMError, ModelProvider, ModelRef, ToolCall

ANTHROPIC_VERSION = "2023-06-01"


def to_anthropic_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The normalised format is already Anthropic-shaped; this drops empty text blocks and unknown keys."""
    out = []
    for msg in messages:
        content = []
        for block in msg["content"]:
            kind = block["type"]
            if kind == "text":
                if block["text"]:
                    content.append({"type": "text", "text": block["text"]})
            elif kind == "tool_use":
                content.append({"type": "tool_use", "id": block["id"], "name": block["name"], "input": block["input"]})
            elif kind == "tool_result":
                content.append({"type": "tool_result", "tool_use_id": block["tool_use_id"],
                                "content": block["content"] or "(empty)", "is_error": bool(block.get("is_error"))})
            else:
                raise ValueError(f"unknown content block type {kind}")
        out.append({"role": msg["role"], "content": content})
    return out


def from_anthropic_response(resp: dict[str, Any]) -> ConverseResult:
    texts: list[str] = []
    calls: list[ToolCall] = []
    blocks: list[dict[str, Any]] = []
    for block in resp.get("content") or []:
        if block.get("type") == "text":
            texts.append(block["text"])
            blocks.append({"type": "text", "text": block["text"]})
        elif block.get("type") == "tool_use":
            calls.append(ToolCall(id=block["id"], name=block["name"], input=block.get("input") or {}))
            blocks.append({"type": "tool_use", "id": block["id"], "name": block["name"], "input": block.get("input") or {}})
    usage = resp.get("usage") or {}
    return ConverseResult(
        text="\n".join(texts).strip(),
        tool_calls=calls,
        stop_reason=resp.get("stop_reason") or "end_turn",
        input_tokens=int(usage.get("input_tokens") or 0),
        output_tokens=int(usage.get("output_tokens") or 0),
        message={"role": "assistant", "content": blocks},
    )


def _error_kind(status: int) -> str:
    if status == 429:
        return THROTTLED
    if status in (401, 403, 404):
        return ACCESS
    if status >= 500 or status == 408:
        return UNAVAILABLE
    return INVALID


class LiteLLMProvider(ModelProvider):
    name = "litellm"

    def __init__(self, *, messages_url: str, api_key: str, timeout_seconds: float = 120.0, client: httpx.Client | None = None):
        self._url = messages_url
        self._headers = {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json"}
        self._client = client or httpx.Client(timeout=httpx.Timeout(timeout_seconds, connect=10.0))

    def converse(self, messages, tools, model_ref: ModelRef, system=None, max_tokens=None, temperature=None) -> ConverseResult:
        request: dict[str, Any] = {
            "model": model_ref.ref,
            "messages": to_anthropic_messages(messages),
            "max_tokens": min(max_tokens or model_ref.max_output_tokens, model_ref.max_output_tokens),
        }
        if temperature is not None:
            request["temperature"] = temperature
        if system:
            request["system"] = system
        if tools:
            request["tools"] = [{"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]}
                                for t in tools]
        try:
            resp = self._client.post(self._url, json=request, headers=self._headers)
        except httpx.HTTPError as exc:
            raise LLMError(f"litellm transport error: {type(exc).__name__}", kind=UNAVAILABLE, provider=self.name) from exc
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("error", {})
                detail = detail.get("message", "") if isinstance(detail, dict) else str(detail)
            except ValueError:
                detail = resp.text
            raise LLMError(f"litellm http {resp.status_code}: {detail[:300]}", kind=_error_kind(resp.status_code),
                           provider=self.name)
        return from_anthropic_response(resp.json())
