from __future__ import annotations
import logging
import threading
from temporalio import activity
from temporalio.exceptions import ApplicationError

from ..config import settings
from ..search import SearchClient, SearchConfigError, SearchProviderError, SearchQuery, SearchResponse, build_search_client

logger = logging.getLogger(__name__)

_client: SearchClient | None = None
_client_lock = threading.Lock()


def _get_client() -> SearchClient:
    global _client
    with _client_lock:
        if _client is None:
            _client = build_search_client(settings)
        return _client


@activity.defn
def web_search(query: SearchQuery) -> SearchResponse:
    try:
        return _get_client().search(query)
    except SearchConfigError as exc:
        raise ApplicationError(str(exc), type="SearchConfigError", non_retryable=True) from exc
    except SearchProviderError as exc:
        # Temporal's retry policy handles rate limits/outages; auth/quota/bad requests won't fix themselves.
        raise ApplicationError(str(exc), type=f"SearchError.{exc.kind}", non_retryable=not exc.retryable) from exc
