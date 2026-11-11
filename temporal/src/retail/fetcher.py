"""SSRF-safe HTTP fetcher with robots.txt checks and a TTL cache (spec: Security Considerations - SSRF)."""
from __future__ import annotations
import ipaddress
import logging
import socket
import threading
import time
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

logger = logging.getLogger(__name__)

MAX_REDIRECTS = 5
_EXTRA_BLOCKED = [ipaddress.ip_network(n) for n in (
    "100.64.0.0/10",    # carrier-grade NAT
    "192.0.0.0/24",     # IETF protocol assignments
    "198.18.0.0/15",    # benchmarking
    "169.254.0.0/16",   # link-local incl. cloud metadata
    "fd00::/8", "fe80::/10",
)]


class FetchError(Exception):
    def __init__(self, message: str, *, kind: str):
        super().__init__(message)
        self.kind = kind  # blocked | robots | network | too_large | too_many_redirects | http

    @property
    def retryable(self) -> bool:
        return self.kind == "network"


@dataclass
class FetchResult:
    url: str
    final_url: str
    status_code: int
    content_type: str
    text: str
    headers: dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status_code == 200


Resolver = Callable[[str], list[str]]


def system_resolver(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    return sorted({info[4][0] for info in infos})


def is_public_ip(ip: str) -> bool:
    addr = ipaddress.ip_address(ip.split("%", 1)[0])
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    if (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast
            or addr.is_reserved or addr.is_unspecified):
        return False
    return not any(addr in net for net in _EXTRA_BLOCKED if net.version == addr.version)


def check_url(url: str, resolver: Resolver = system_resolver) -> None:
    """Raise FetchError(kind='blocked') unless url is http(s) on a public address and default-ish port."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise FetchError(f"scheme not allowed: {parts.scheme or '-'}", kind="blocked")
    host = parts.hostname
    if not host:
        raise FetchError("missing host", kind="blocked")
    if parts.username or parts.password:
        raise FetchError("credentials in URL are not allowed", kind="blocked")
    if parts.port not in (None, 80, 443, 8080, 8443):
        raise FetchError(f"port not allowed: {parts.port}", kind="blocked")
    if host.lower() in ("localhost",) or host.lower().endswith((".local", ".internal", ".localhost")):
        raise FetchError(f"host not allowed: {host}", kind="blocked")
    try:
        ips = [host] if _is_ip_literal(host) else resolver(host)
    except (socket.gaierror, UnicodeError) as exc:
        raise FetchError(f"dns lookup failed for {host}", kind="network") from exc
    if not ips:
        raise FetchError(f"dns lookup returned nothing for {host}", kind="network")
    for ip in ips:
        if not is_public_ip(ip):
            raise FetchError(f"address not allowed for {host}: {ip}", kind="blocked")


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip("[]"))
        return True
    except ValueError:
        return False


class _TTLCache:
    def __init__(self, ttl_seconds: int, max_entries: int = 2000):
        self.ttl, self.max = ttl_seconds, max_entries
        self._data: dict[str, tuple[float, object]] = {}
        self._lock = threading.Lock()

    def get(self, key: str):
        with self._lock:
            hit = self._data.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1]
            self._data.pop(key, None)
            return None

    def put(self, key: str, value: object) -> None:
        with self._lock:
            if len(self._data) >= self.max:
                for k in sorted(self._data, key=lambda k: self._data[k][0])[: self.max // 10 or 1]:
                    self._data.pop(k, None)
            self._data[key] = (time.monotonic() + self.ttl, value)


class SafeFetcher:
    def __init__(
        self,
        *,
        user_agent: str,
        timeout_seconds: float = 15.0,
        max_bytes: int = 2_000_000,
        cache_ttl_seconds: int = 3 * 3600,
        respect_robots: bool = True,
        resolver: Resolver = system_resolver,
        transport: httpx.BaseTransport | None = None,
    ):
        self.user_agent = user_agent
        self.max_bytes = max_bytes
        self.respect_robots = respect_robots
        self.resolver = resolver
        self._client = httpx.Client(
            timeout=timeout_seconds,
            follow_redirects=False,
            headers={"User-Agent": user_agent, "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
                     "Accept-Language": "en"},
            transport=transport,
        )
        self._cache = _TTLCache(cache_ttl_seconds)
        self._robots = _TTLCache(24 * 3600, max_entries=500)

    def _robots_allows(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        parser = self._robots.get(origin)
        if parser is None:
            parser = RobotFileParser()
            try:
                res = self._get(origin + "/robots.txt", check_robots=False, max_bytes=200_000)
                if res.status_code == 200:
                    parser.parse(res.text.splitlines())
                else:
                    parser.parse([])  # missing robots.txt -> allow
            except FetchError:
                parser.parse([])
            self._robots.put(origin, parser)
        return parser.can_fetch(self.user_agent, url)  # type: ignore[union-attr]

    def _get(self, url: str, *, check_robots: bool, max_bytes: int | None = None,
             headers: dict[str, str] | None = None) -> FetchResult:
        limit = max_bytes or self.max_bytes
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            check_url(current, self.resolver)
            if check_robots and not self._robots_allows(current):
                raise FetchError(f"disallowed by robots.txt: {current}", kind="robots")
            try:
                with self._client.stream("GET", current, headers=headers) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                        current = urljoin(current, resp.headers["location"])
                        continue
                    chunks, size = [], 0
                    for chunk in resp.iter_bytes():
                        size += len(chunk)
                        if size > limit:
                            raise FetchError(f"response larger than {limit} bytes", kind="too_large")
                        chunks.append(chunk)
                    body = b"".join(chunks)
                    encoding = resp.charset_encoding or "utf-8"
                    return FetchResult(
                        url=url,
                        final_url=str(resp.url),
                        status_code=resp.status_code,
                        content_type=resp.headers.get("content-type", ""),
                        text=body.decode(encoding, errors="replace"),
                        headers={k.lower(): v for k, v in resp.headers.items()
                                 if k.lower() in ("content-type", "server", "x-shopid", "x-shopify-stage", "powered-by",
                                                  "x-shardid", "x-sorting-hat-shopid", "x-storefront-renderer-rendered")},
                    )
            except httpx.HTTPError as exc:
                raise FetchError(f"fetch failed: {type(exc).__name__}", kind="network") from exc
        raise FetchError("too many redirects", kind="too_many_redirects")

    def get(self, url: str, *, cache_key: str | None = None, use_cache: bool = True,
            headers: dict[str, str] | None = None) -> FetchResult:
        key = cache_key or url
        if use_cache:
            hit = self._cache.get(key)
            if hit is not None:
                return hit  # type: ignore[return-value]
        result = self._get(url, check_robots=True, headers=headers)
        if use_cache and result.status_code == 200:
            self._cache.put(key, result)
        return result


class RendererClient:
    """Playwright sidecar (renderer/). Used only when a plain fetch yields no structured data."""

    def __init__(self, base_url: str, *, timeout_seconds: float = 45.0, transport: httpx.BaseTransport | None = None):
        self._client = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout_seconds, transport=transport)

    def render(self, url: str, resolver: Resolver = system_resolver) -> FetchResult:
        check_url(url, resolver)
        try:
            resp = self._client.post("/render", json={"url": url})
        except httpx.HTTPError as exc:
            raise FetchError(f"renderer unavailable: {type(exc).__name__}", kind="network") from exc
        if resp.status_code != 200:
            kind = "blocked" if resp.status_code == 403 else "network" if resp.status_code >= 500 else "http"
            raise FetchError(f"renderer returned HTTP {resp.status_code}", kind=kind)
        data = resp.json()
        return FetchResult(url=url, final_url=data.get("final_url") or url, status_code=int(data.get("status") or 0),
                           content_type="text/html", text=data.get("html") or "")
