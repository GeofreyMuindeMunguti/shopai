from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

# Error kinds shared by every provider. Retry decisions and fallback behaviour
# key off these, so new providers must map their failures onto this set.
AUTH = "auth"                  # missing/invalid credentials
BAD_REQUEST = "bad_request"    # query rejected; another provider would reject it too
QUOTA = "quota"                # plan/credit limit reached
RATE_LIMITED = "rate_limited"  # temporary throttling
UNAVAILABLE = "unavailable"    # timeouts, network errors, 5xx

RETRYABLE_KINDS = {RATE_LIMITED, UNAVAILABLE}


@dataclass
class SearchQuery:
    query: str
    country_code: str | None = None          # ISO 3166-1 alpha-2, e.g. "KE"
    include_domains: list[str] = field(default_factory=list)
    exclude_domains: list[str] = field(default_factory=list)
    max_results: int | None = None           # None -> provider default

    def validate(self) -> None:
        if not self.query or not self.query.strip():
            raise SearchProviderError("query must not be empty", provider="-", kind=BAD_REQUEST)
        if len(self.query) > 400:
            raise SearchProviderError("query exceeds 400 characters", provider="-", kind=BAD_REQUEST)
        if self.max_results is not None and not 1 <= self.max_results <= 20:
            raise SearchProviderError("max_results must be between 1 and 20", provider="-", kind=BAD_REQUEST)


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str = ""
    score: float | None = None


@dataclass
class SearchResponse:
    provider: str
    query: str
    results: list[SearchResult]
    credits_used: float | None = None


class SearchConfigError(Exception):
    """Provider is unknown or missing required configuration (e.g. API key)."""


class SearchProviderError(Exception):
    def __init__(self, message: str, *, provider: str, kind: str):
        super().__init__(message)
        self.provider = provider
        self.kind = kind

    @property
    def retryable(self) -> bool:
        return self.kind in RETRYABLE_KINDS


class SearchProvider(ABC):
    name: str

    @abstractmethod
    def search(self, query: SearchQuery) -> SearchResponse:
        """Run a web search. Raise SearchProviderError on failure."""
