"""URL normalisation for dedupe (spec: Input validation, FR-4)."""
from __future__ import annotations
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_TRACKING_PREFIXES = ("utm_", "mc_", "pk_", "_ga", "_gl", "trk", "spm")
_TRACKING_KEYS = {
    "gclid", "fbclid", "msclkid", "dclid", "yclid", "ref", "ref_", "tag", "psc", "th", "smid", "sr", "qid",
    "keywords", "crid", "sprefix", "linkcode", "creative", "creativeasin", "ascsubtag", "srsltid", "_pos", "_sid",
    "_ss", "_psq", "_fid", "_v", "pr_prod_strat", "pr_rec_id", "pr_rec_pid", "pr_ref_pid", "pr_seq", "irclickid",
}
_AMAZON_ASIN = re.compile(r"/(?:dp|gp/product|gp/aw/d|product)/([A-Z0-9]{10})(?:[/?]|$)", re.IGNORECASE)
_TAKEALOT_PLID = re.compile(r"/(PLID\d+)", re.IGNORECASE)
_TEMU_GOODS = re.compile(r"-g-(\d{6,})\.html", re.IGNORECASE)
_SHOPIFY_PRODUCT = re.compile(r"(?:/collections/[^/]+)?(/products/[^/?#]+)")


def _host(netloc: str) -> str:
    host = netloc.lower().rsplit("@", 1)[-1]
    if host.endswith(":80") or host.endswith(":443"):
        host = host.rsplit(":", 1)[0]
    return host


def registrable_host(url: str) -> str:
    """Host without a leading www., for domain checks."""
    host = _host(urlsplit(url).netloc)
    return host[4:] if host.startswith("www.") else host


def host_matches(url: str, domain: str) -> bool:
    host = registrable_host(url)
    domain = domain.lower().removeprefix("www.")
    return host == domain or host.endswith("." + domain)


def canonicalize_url(url: str) -> str:
    """Generic canonical form plus retailer-specific rules. The result is a dedupe key, not always navigable."""
    parts = urlsplit(url.strip())
    scheme = "https" if parts.scheme.lower() in ("http", "https") else parts.scheme.lower()
    host = _host(parts.netloc)
    bare = host.removeprefix("www.")
    path = re.sub(r"/{2,}", "/", parts.path or "/")

    if "amazon." in bare:
        m = _AMAZON_ASIN.search(path)
        if m:
            return f"https://{host}/dp/{m.group(1).upper()}"
    if bare == "takealot.com":
        m = _TAKEALOT_PLID.search(path)
        if m:
            return f"https://www.takealot.com/x/{m.group(1).upper()}"
    if bare == "temu.com":
        m = _TEMU_GOODS.search(path)
        if m:
            return f"https://www.temu.com/g-{m.group(1)}.html"
    if bare.startswith("jumia."):
        return urlunsplit(("https", host, path.rstrip("/") or "/", "", ""))

    m = _SHOPIFY_PRODUCT.search(path)
    keep_variant = False
    if m and "/products/" in path:
        path = m.group(1)
        keep_variant = True

    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=False):
        k = key.lower()
        if k in _TRACKING_KEYS or k.startswith(_TRACKING_PREFIXES):
            continue
        if keep_variant and k != "variant":
            continue
        query.append((key, value))
    query.sort()
    if len(path) > 1:
        path = path.rstrip("/")
    return urlunsplit((scheme, host, path, urlencode(query), ""))
