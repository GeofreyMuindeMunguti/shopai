"""Process-wide singletons for activities (fetcher, search, renderer, adapters, rate limiter)."""
from __future__ import annotations
import logging
import threading
import time

from temporalio.exceptions import ApplicationError

from ..config import Settings, settings as default_settings
from ..retail.adapters import AdapterContext, AdapterError, RetailerAdapter, adapter_class
from ..retail.fetcher import RendererClient, SafeFetcher
from ..search import SearchConfigError, build_search_client
from ..supabase_client import SupabaseError

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_ctx: AdapterContext | None = None
_adapters: dict[str, RetailerAdapter] = {}


def build_context(s: Settings) -> AdapterContext:
    fetcher = SafeFetcher(user_agent=s.fetch_user_agent, timeout_seconds=s.fetch_timeout_seconds,
                          max_bytes=s.fetch_max_bytes, cache_ttl_seconds=s.fetch_cache_ttl_seconds,
                          respect_robots=s.fetch_respect_robots)
    try:
        search = build_search_client(s)
    except SearchConfigError as exc:
        logger.warning("search unavailable for adapters error=%s", exc)
        search = None
    renderer = RendererClient(s.headless_renderer_url) if s.headless_renderer_url else None
    creds = None
    if s.amazon_api_access_key and s.amazon_api_secret_key and s.amazon_partner_tag:
        creds = (s.amazon_api_access_key, s.amazon_api_secret_key, s.amazon_partner_tag)
    return AdapterContext(fetcher=fetcher, search=search, renderer=renderer, amazon_credentials=creds)


def get_context() -> AdapterContext:
    global _ctx
    with _lock:
        if _ctx is None:
            _ctx = build_context(default_settings)
        return _ctx


def set_context(ctx: AdapterContext | None) -> None:
    """Test hook."""
    global _ctx
    with _lock:
        _ctx = ctx
        _adapters.clear()


def get_adapter(adapter_key: str) -> RetailerAdapter:
    ctx = get_context()
    with _lock:
        if adapter_key not in _adapters:
            try:
                _adapters[adapter_key] = adapter_class(adapter_key)(ctx)
            except AdapterError as exc:
                raise ApplicationError(str(exc), type="AdapterError", non_retryable=True) from exc
        return _adapters[adapter_key]


class _RateLimiter:
    """Per-retailer minimum spacing between outbound calls (retailers.rate_limit_per_min)."""

    def __init__(self) -> None:
        self._next: dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, key: str, per_min: int) -> None:
        interval = 60.0 / max(per_min, 1)
        with self._lock:
            now = time.monotonic()
            slot = max(now, self._next.get(key, now))
            self._next[key] = slot + interval
        delay = slot - time.monotonic()
        if delay > 0:
            time.sleep(min(delay, 30))


rate_limiter = _RateLimiter()


def supabase_app_error(exc: SupabaseError) -> ApplicationError:
    return ApplicationError(str(exc), type=f"SupabaseError.{exc.code or exc.status}", non_retryable=not exc.retryable)
