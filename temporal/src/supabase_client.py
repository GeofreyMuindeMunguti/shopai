"""Service-role PostgREST client. The worker reaches Supabase only through this (ADR-0002)."""
from __future__ import annotations
import logging
import threading
from typing import Any

import httpx

from .config import Settings, settings as default_settings

logger = logging.getLogger(__name__)


class SupabaseError(Exception):
    def __init__(self, message: str, *, status: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code

    @property
    def retryable(self) -> bool:
        # Network errors and 5xx may heal; 4xx / WL* validation errors won't.
        return self.status is None or self.status >= 500 or self.status == 429


class SupabaseService:
    def __init__(self, url: str, service_key: str, *, timeout: float = 15.0, transport: httpx.BaseTransport | None = None):
        self._client = httpx.Client(
            base_url=url.rstrip("/") + "/rest/v1",
            timeout=timeout,
            headers={"apikey": service_key, "Authorization": f"Bearer {service_key}", "Content-Type": "application/json"},
            transport=transport,
        )

    def _send(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            resp = self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise SupabaseError(f"supabase request failed: {type(exc).__name__}") from exc
        if resp.status_code >= 400:
            code = message = None
            try:
                body = resp.json()
                code, message = body.get("code"), body.get("message")
            except ValueError:
                message = resp.text[:300]
            raise SupabaseError(f"supabase {method} {path} -> HTTP {resp.status_code} code={code} {message}",
                                status=resp.status_code, code=code)
        if not resp.content:
            return None
        return resp.json()

    def rpc(self, fn: str, params: dict[str, Any] | None = None) -> Any:
        return self._send("POST", f"/rpc/{fn}", json=params or {})

    def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        return self._send("GET", f"/{table}", params=params) or []

    def insert(self, table: str, rows: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._send("POST", f"/{table}", json=rows, headers={"Prefer": "return=representation"}) or []

    def update(self, table: str, match: dict[str, str], values: dict[str, Any]) -> list[dict[str, Any]]:
        return self._send("PATCH", f"/{table}", params=match, json=values, headers={"Prefer": "return=representation"}) or []


_service: SupabaseService | None = None
_lock = threading.Lock()


def get_supabase(s: Settings = default_settings) -> SupabaseService:
    global _service
    with _lock:
        if _service is None:
            _service = SupabaseService(s.supabase_url, s.supabase_service_role_key, timeout=s.supabase_timeout_seconds)
        return _service


def set_supabase(service: SupabaseService | None) -> None:
    """Test hook."""
    global _service
    with _lock:
        _service = service
