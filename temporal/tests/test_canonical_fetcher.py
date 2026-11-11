from __future__ import annotations

import httpx
import pytest

from src.retail.canonical import canonicalize_url, host_matches
from src.retail.fetcher import FetchError, SafeFetcher, check_url, is_public_ip


@pytest.mark.parametrize("url,expected", [
    ("https://www.amazon.com/Sony-WH-1000XM5/dp/b09xs7jwhh/ref=sr_1_1?keywords=sony&th=1", "https://www.amazon.com/dp/B09XS7JWHH"),
    ("http://WWW.Takealot.com/sony-wh-1000xm5/PLID90000001?utm_source=x#reviews", "https://www.takealot.com/x/PLID90000001"),
    ("https://www.jumia.co.ke/sony-headphones-12345.html?shop=1", "https://www.jumia.co.ke/sony-headphones-12345.html"),
    ("https://www.temu.com/us/foo-bar-g-601099512345678.html?_x_sessn_id=1", "https://www.temu.com/g-601099512345678.html"),
    ("https://shop.example.com/collections/boots/products/trail-boot?variant=42&utm_medium=x&_pos=1",
     "https://shop.example.com/products/trail-boot?variant=42"),
    ("https://example.com/p/?b=2&a=1&gclid=zzz", "https://example.com/p?a=1&b=2"),
])
def test_canonicalize(url, expected):
    assert canonicalize_url(url) == expected


def test_dedupe_key_is_stable_across_tracking_variants():
    a = canonicalize_url("https://www.amazon.co.za/dp/B000000001?tag=aff-21")
    b = canonicalize_url("https://www.amazon.co.za/Some-Title/dp/B000000001/ref=x")
    assert a == b


def test_host_matches():
    assert host_matches("https://www.amazon.co.za/dp/X", "amazon.co.za")
    assert host_matches("https://m.jumia.co.ke/x", "jumia.co.ke")
    assert not host_matches("https://amazon.co.za.evil.com/x", "amazon.co.za")


@pytest.mark.parametrize("ip,public", [
    ("8.8.8.8", True), ("10.0.0.1", False), ("127.0.0.1", False), ("169.254.169.254", False),
    ("192.168.1.1", False), ("100.64.0.1", False), ("::1", False), ("::ffff:127.0.0.1", False),
    ("fe80::1", False), ("2606:4700::1111", True), ("0.0.0.0", False),
])
def test_is_public_ip(ip, public):
    assert is_public_ip(ip) is public


@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "ftp://example.com/x", "http://localhost/x", "http://127.0.0.1:8080/",
    "http://user:pw@example.com/", "http://example.com:22/", "http://metadata.internal/",
])
def test_check_url_blocks(url):
    with pytest.raises(FetchError) as info:
        check_url(url, resolver=lambda h: ["93.184.216.34"])
    assert info.value.kind == "blocked"


def test_check_url_blocks_dns_to_private():
    with pytest.raises(FetchError):
        check_url("https://rebind.example.com/", resolver=lambda h: ["93.184.216.34", "10.1.2.3"])


def _fetcher(handler, **kw) -> SafeFetcher:
    return SafeFetcher(user_agent="ScoutTest", transport=httpx.MockTransport(handler),
                       resolver=lambda h: ["127.0.0.1"] if h == "internal.example" else ["93.184.216.34"], **kw)


def test_redirect_to_private_address_is_blocked():
    def handler(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(302, headers={"location": "http://internal.example/admin"})

    with pytest.raises(FetchError) as info:
        _fetcher(handler).get("https://shop.example.com/p")
    assert info.value.kind == "blocked"


def test_robots_disallow_and_size_cap_and_cache():
    calls = {"page": 0}

    def handler(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private\n")
        if request.url.path == "/big":
            return httpx.Response(200, content=b"x" * 5000, headers={"content-type": "text/html"})
        calls["page"] += 1
        return httpx.Response(200, text="<html>ok</html>", headers={"content-type": "text/html"})

    f = _fetcher(handler, max_bytes=1000)
    with pytest.raises(FetchError) as info:
        f.get("https://shop.example.com/private/x")
    assert info.value.kind == "robots"
    with pytest.raises(FetchError) as info:
        f.get("https://shop.example.com/big")
    assert info.value.kind == "too_large"
    assert f.get("https://shop.example.com/p").ok
    f.get("https://shop.example.com/p")
    assert calls["page"] == 1  # second call served from the TTL cache
    f.get("https://shop.example.com/p", use_cache=False)
    assert calls["page"] == 2


def test_too_many_redirects():
    def handler(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(301, headers={"location": "/loop"})

    with pytest.raises(FetchError) as info:
        _fetcher(handler).get("https://shop.example.com/loop")
    assert info.value.kind == "too_many_redirects"
