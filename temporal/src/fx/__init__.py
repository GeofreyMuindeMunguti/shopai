"""Daily FX rates from free providers, USD-based (ADR-0009). Display-only conversion."""
from __future__ import annotations
import datetime as dt
import logging
from dataclasses import dataclass
from typing import Callable

import httpx

from ..config import Settings

logger = logging.getLogger(__name__)

MAX_PRICE_TOLERANCE = 0.03


@dataclass
class FxSnapshot:
    as_of: str               # ISO date
    source: str
    base: str
    rates: dict[str, float]  # quote currency -> units per 1 base


class FxProviderError(Exception):
    pass


class ExchangeRateApiOpen:
    """https://open.er-api.com/v6/latest/USD - no key, daily, attribution "Rates by ExchangeRate-API"."""

    name = "exchangerate_api_open"

    def __init__(self, client: httpx.Client):
        self._client = client

    def fetch(self) -> FxSnapshot:
        try:
            resp = self._client.get("https://open.er-api.com/v6/latest/USD")
        except httpx.HTTPError as exc:
            raise FxProviderError(f"{self.name} request failed: {type(exc).__name__}") from exc
        data = resp.json() if resp.status_code == 200 else {}
        if data.get("result") != "success" or not isinstance(data.get("rates"), dict):
            raise FxProviderError(f"{self.name} returned HTTP {resp.status_code} result={data.get('result')}")
        ts = data.get("time_last_update_unix")
        as_of = dt.datetime.fromtimestamp(ts, dt.timezone.utc).date() if ts else dt.datetime.now(dt.timezone.utc).date()
        return FxSnapshot(as_of=as_of.isoformat(), source=self.name, base="USD",
                          rates={k.upper(): float(v) for k, v in data["rates"].items() if isinstance(v, (int, float))})


class Fawazahmed0:
    """fawazahmed0 currency-api via jsDelivr, with the Cloudflare Pages mirror as a second URL."""

    name = "fawazahmed0"
    urls = (
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
        "https://latest.currency-api.pages.dev/v1/currencies/usd.json",
    )

    def __init__(self, client: httpx.Client):
        self._client = client

    def fetch(self) -> FxSnapshot:
        last = "no response"
        for url in self.urls:
            try:
                resp = self._client.get(url)
            except httpx.HTTPError as exc:
                last = type(exc).__name__
                continue
            if resp.status_code != 200:
                last = f"HTTP {resp.status_code}"
                continue
            data = resp.json()
            rates = data.get("usd")
            if isinstance(rates, dict) and data.get("date"):
                return FxSnapshot(as_of=data["date"], source=self.name, base="USD",
                                  rates={k.upper(): float(v) for k, v in rates.items() if isinstance(v, (int, float)) and v > 0})
            last = "unexpected payload"
        raise FxProviderError(f"{self.name} failed: {last}")


_BUILDERS: dict[str, Callable[[httpx.Client], object]] = {
    ExchangeRateApiOpen.name: ExchangeRateApiOpen,
    Fawazahmed0.name: Fawazahmed0,
}


def fetch_rates(settings: Settings, transport: httpx.BaseTransport | None = None) -> FxSnapshot:
    """Primary, then fallback. Raises FxProviderError if both fail (last known rates are kept in the DB)."""
    names = [settings.fx_rates_provider]
    if settings.fx_rates_fallback_provider and settings.fx_rates_fallback_provider not in names:
        names.append(settings.fx_rates_fallback_provider)
    errors = []
    with httpx.Client(timeout=settings.fx_timeout_seconds, transport=transport,
                      headers={"User-Agent": settings.fetch_user_agent}) as client:
        for name in names:
            builder = _BUILDERS.get(name)
            if builder is None:
                errors.append(f"unknown provider {name}")
                continue
            try:
                snap = builder(client).fetch()  # type: ignore[attr-defined]
            except (FxProviderError, ValueError) as exc:
                logger.warning("fx provider failed provider=%s error=%s", name, exc)
                errors.append(str(exc))
                continue
            logger.info("fx rates fetched provider=%s as_of=%s currencies=%d", name, snap.as_of, len(snap.rates))
            return snap
    raise FxProviderError("; ".join(errors) or "no fx providers configured")


def convert(amount: float, from_ccy: str, to_ccy: str, usd_rates: dict[str, float]) -> float | None:
    """Cross rate through USD. usd_rates[X] = units of X per 1 USD. None if a rate is missing."""
    f, t = from_ccy.upper(), to_ccy.upper()
    if f == t:
        return amount
    rf = 1.0 if f == "USD" else usd_rates.get(f)
    rt = 1.0 if t == "USD" else usd_rates.get(t)
    if not rf or not rt:
        return None
    return amount / rf * rt


def within_budget(price: float | None, currency: str | None, max_price: float | None, max_currency: str | None,
                  usd_rates: dict[str, float]) -> bool | None:
    """max_price across currencies with a 3% tolerance. None when it can't be decided (no rate)."""
    if max_price is None or price is None:
        return True
    if not currency or not max_currency:
        return None
    converted = convert(price, currency, max_currency, usd_rates)
    if converted is None:
        return None
    tolerance = 0.0 if currency.upper() == max_currency.upper() else MAX_PRICE_TOLERANCE
    return converted <= max_price * (1 + tolerance)
