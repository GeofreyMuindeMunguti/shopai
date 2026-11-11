"""Provider-agnostic LLM types (ADR-0003).

Normalised message format shared by every provider:
  {"role": "user" | "assistant", "content": [block, ...]}
  block = {"type": "text", "text": str}
        | {"type": "tool_use", "id": str, "name": str, "input": dict}
        | {"type": "tool_result", "tool_use_id": str, "content": str, "is_error": bool}
Tools: {"name": str, "description": str, "input_schema": <JSON schema>}
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

# Error kinds; retry decisions key off these.
THROTTLED = "throttled"        # rate limit / quota throttling
UNAVAILABLE = "unavailable"    # timeouts, 5xx, model not ready
INVALID = "invalid"            # bad request / validation (incl. unsupported tool use)
ACCESS = "access"              # access denied / model not enabled / not found
RETRYABLE_KINDS = {THROTTLED, UNAVAILABLE}


@dataclass
class ModelRef:
    provider: str
    ref: str                       # Bedrock model ID / inference-profile ID
    max_output_tokens: int = 4096
    llm_model_id: str | None = None
    connection: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "ModelRef":
        return cls(
            provider=data.get("provider") or "bedrock",
            ref=data["ref"],
            max_output_tokens=int(data.get("max_output_tokens") or 4096),
            llm_model_id=data.get("llm_model_id"),
            connection=data.get("connection") or {},
        )


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class ConverseResult:
    text: str
    tool_calls: list[ToolCall]
    stop_reason: str
    input_tokens: int
    output_tokens: int
    message: dict[str, Any]        # assistant message in normalised format, ready to append


class LLMError(Exception):
    def __init__(self, message: str, *, kind: str, provider: str):
        super().__init__(message)
        self.kind = kind
        self.provider = provider

    @property
    def retryable(self) -> bool:
        return self.kind in RETRYABLE_KINDS


class LLMConfigError(Exception):
    """Provider unknown or not configured."""


class ModelProvider(ABC):
    name: str

    @abstractmethod
    def converse(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        model_ref: ModelRef,
        system: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> ConverseResult:
        """Run one model turn. Raise LLMError on failure."""
