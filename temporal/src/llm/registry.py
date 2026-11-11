"""Provider registry keyed by llm_models.provider. BYOM adds builders here (ADR-0003)."""
from __future__ import annotations
import threading
from typing import Callable

from ..config import Settings
from .base import LLMConfigError, ModelProvider
from .bedrock import BedrockProvider

_BUILDERS: dict[str, Callable[[Settings], ModelProvider]] = {
    "bedrock": lambda s: BedrockProvider(
        endpoint_url=_require(s.bedrock_endpoint_url, "BEDROCK_ENDPOINT_URL"),
        region=_require(s.aws_region, "AWS_REGION"),
        timeout_seconds=s.bedrock_timeout_seconds,
        access_key_id=s.aws_access_key_id,
        secret_access_key=s.aws_secret_access_key,
        session_token=s.aws_session_token,
    ),
}

_cache: dict[str, ModelProvider] = {}
_lock = threading.Lock()


def _require(value: str | None, name: str) -> str:
    if not value:
        raise LLMConfigError(f"{name} is required for the bedrock provider")
    return value


def get_provider(name: str, settings: Settings) -> ModelProvider:
    key = (name or "bedrock").strip().lower()
    with _lock:
        if key not in _cache:
            builder = _BUILDERS.get(key)
            if builder is None:
                raise LLMConfigError(f"unknown model provider '{name}' (available: {', '.join(sorted(_BUILDERS))})")
            _cache[key] = builder(settings)
        return _cache[key]


def register_provider(name: str, provider: ModelProvider) -> None:
    """Test hook / BYOM: install a ready-made provider instance."""
    with _lock:
        _cache[name] = provider
