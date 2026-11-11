"""ScoutRetailerWorkflow: one Bedrock tool-use loop scoped to a single retailer (ADR-0001)."""
from __future__ import annotations
import json
from typing import Any

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from ..activities import db as db_acts
    from ..activities.llm import llm_converse
    from ..activities.retail import discover_stores, fetch_product_page, retailer_search, verify_candidate
    from ..retail.canonical import canonicalize_url, host_matches
    from ..scout.prompts import (MAX_SEARCH_OUTPUT_CHARS, MAX_TOOL_OUTPUT_CHARS, kickoff_message, system_prompt,
                                  truncate, untrusted)
    from ..scout.tools import MAX_CANDIDATES_PER_RETAILER, MAX_SEARCH_RESULTS, tool_specs, validate_submit
    from ..scout.types import CandidateSummary, RetailerScoutInput, RetailerScoutResult
    from .common import LLM_RETRY, LLM_TIMEOUT, RETAIL_RETRY, RETAIL_TIMEOUT, classify, db_call

MAX_SUBMIT_ATTEMPTS = 6
TURN_MAX_TOKENS = 2048


def _product_view(product: dict[str, Any]) -> dict[str, Any]:
    keys = ("title", "price", "currency", "availability", "brand", "gtin", "mpn", "condition", "image_url",
            "description", "attributes", "final_url", "is_product_page")
    return {k: product.get(k) for k in keys if product.get(k) not in (None, "", {}, [])}


@workflow.defn
class ScoutRetailerWorkflow:
    def __init__(self) -> None:
        self._known_urls: set[str] = set()
        self._stores: set[str] = set()
        self._submitted = 0
        self._submit_attempts = 0

    @workflow.run
    async def run(self, inp: RetailerScoutInput) -> RetailerScoutResult:
        code = inp.retailer["code"]
        result = RetailerScoutResult(retailer_code=code, status="running")
        self._known_urls = set(inp.existing_canonical_urls)
        try:
            await self._report(inp, result)
            await self._loop(inp, result)
            result.status = "completed" if result.matches > 0 else "no_matches"
        except Exception as exc:  # child failures must never fail the parent run
            result.error_kind, result.error = classify(exc)
            result.status = "failed"
            workflow.logger.warning("retailer scout failed retailer=%s kind=%s error=%s", code, result.error_kind, result.error)
        try:
            await self._report(inp, result)
        except Exception:
            pass
        return result

    async def _report(self, inp: RetailerScoutInput, r: RetailerScoutResult) -> None:
        await db_call(db_acts.set_retailer_result, inp.scout_run_id, r.retailer_code, {
            "status": r.status, "matches": r.matches, "input_tokens": r.input_tokens, "output_tokens": r.output_tokens,
            "pages_fetched": r.pages_fetched, "tool_calls": r.tool_calls, "budget_exhausted": r.budget_exhausted,
            "error": r.error,
        })

    async def _loop(self, inp: RetailerScoutInput, r: RetailerScoutResult) -> None:
        is_shopify = inp.retailer["code"] == "shopify"
        tools = tool_specs(is_shopify)
        system = system_prompt(retailer=inp.retailer, item=inp.item, country=inp.country_code,
                               currency=inp.profile_currency, preferences=inp.preferences,
                               preference_summary=inp.preference_summary, category=inp.category,
                               max_candidates=MAX_CANDIDATES_PER_RETAILER)
        messages: list[dict[str, Any]] = [kickoff_message(inp.retailer, len(inp.existing_canonical_urls))]
        max_out = int(inp.model.get("max_output_tokens") or 4096)

        for turn in range(inp.budget.iterations):
            remaining = inp.budget.tokens - (r.input_tokens + r.output_tokens)
            if remaining <= 0:
                r.budget_exhausted = True
                return
            resp = await workflow.execute_activity(
                llm_converse,
                {"model": inp.model, "messages": messages, "tools": tools, "system": system,
                 "max_tokens": max(256, min(TURN_MAX_TOKENS, max_out, remaining)),
                 "task": "scout_agent", "scout_run_id": inp.scout_run_id},
                start_to_close_timeout=LLM_TIMEOUT, retry_policy=LLM_RETRY,
            )
            r.iterations += 1
            r.input_tokens += resp["input_tokens"]
            r.output_tokens += resp["output_tokens"]
            calls = resp["tool_calls"]
            if not resp["message"]["content"]:
                return
            messages.append(resp["message"])
            if not calls:
                return  # model answered in text: treat as finished

            results, done = [], False
            for call in calls:
                r.tool_calls += 1
                content, is_error, finished = await self._tool(inp, r, call["name"], call.get("input") or {})
                done = done or finished
                limit = MAX_SEARCH_OUTPUT_CHARS if call["name"] == "retailer_search" else MAX_TOOL_OUTPUT_CHARS
                results.append({"type": "tool_result", "tool_use_id": call["id"], "content": truncate(content, limit),
                                "is_error": is_error})
            messages.append({"role": "user", "content": results})
            if done:
                return
            if r.matches and turn % 2 == 1:
                await self._report(inp, r)
        r.budget_exhausted = True  # ran out of turns without finish

    async def _tool(self, inp: RetailerScoutInput, r: RetailerScoutResult, name: str, args: dict[str, Any]) -> tuple[str, bool, bool]:
        """Returns (content, is_error, finished). Tool errors go back to the model, not up the stack."""
        retailer = inp.retailer
        try:
            if name == "finish":
                return "Finished.", False, True
            if name == "retailer_search":
                return await self._search(inp, args)
            if name == "fetch_product_page":
                return await self._fetch(inp, r, args)
            if name == "discover_stores" and retailer["code"] == "shopify":
                return await self._discover(inp, r, args)
            if name == "submit_candidate":
                return await self._submit(inp, r, args)
            return f"Unknown tool {name}.", True, False
        except Exception as exc:
            kind, message = classify(exc)
            if kind in ("llm_unavailable", "llm_invalid"):
                raise
            return f"Tool {name} failed: {message[:300]}", True, False

    async def _search(self, inp: RetailerScoutInput, args: dict[str, Any]) -> tuple[str, bool, bool]:
        query = str(args.get("query") or "").strip()[:300]
        if not query:
            return "query is required.", True, False
        store = None
        if inp.retailer["code"] == "shopify":
            store = str(args.get("store_domain") or "").lower().removeprefix("https://").removeprefix("www.").strip("/")
            if store not in self._stores:
                return "store_domain must be one of the stores returned by discover_stores.", True, False
        res = await workflow.execute_activity(
            retailer_search,
            {"retailer": inp.retailer, "query": query, "country": inp.country_code,
             "max_results": min(int(args.get("max_results") or 6), MAX_SEARCH_RESULTS), "store_domain": store},
            start_to_close_timeout=RETAIL_TIMEOUT, retry_policy=RETAIL_RETRY,
        )
        if not res["ok"]:
            return f"Search failed: {res.get('error')}", True, False
        for hit in res["results"]:
            self._known_urls.add(canonicalize_url(hit["url"]))
        if not res["results"]:
            return "No results. Try different search terms.", False, False
        rows = [{"url": h["url"], "title": h.get("title"), "snippet": (h.get("snippet") or "")[:150]}
                for h in res["results"]]
        return untrusted(rows, MAX_SEARCH_OUTPUT_CHARS), False, False

    async def _fetch(self, inp: RetailerScoutInput, r: RetailerScoutResult, args: dict[str, Any]) -> tuple[str, bool, bool]:
        url = str(args.get("url") or "").strip()
        if r.pages_fetched >= inp.budget.fetches:
            return "Fetch budget exhausted. Submit the best candidates you have, then finish.", True, False
        if not self._url_in_scope(inp, url):
            return "That URL is not on this retailer.", True, False
        r.pages_fetched += 1
        res = await workflow.execute_activity(fetch_product_page, {"retailer": inp.retailer, "url": url},
                                              start_to_close_timeout=RETAIL_TIMEOUT, retry_policy=RETAIL_RETRY)
        if not res.get("product"):
            return f"Fetch failed: {res.get('error')}", True, False
        self._known_urls.add(canonicalize_url(url))
        if res.get("canonical_url"):
            self._known_urls.add(res["canonical_url"])
        product = res["product"]
        if not res["ok"]:
            return f"Page returned HTTP {product.get('status_code')}.", True, False
        return untrusted(_product_view(product)), False, False

    async def _discover(self, inp: RetailerScoutInput, r: RetailerScoutResult, args: dict[str, Any]) -> tuple[str, bool, bool]:
        queries = [str(q)[:200] for q in (args.get("queries") or []) if q][:4] or inp.discovery_queries
        remaining = max(0, inp.budget.fetches - r.pages_fetched)
        res = await workflow.execute_activity(
            discover_stores,
            {"category": args.get("category") or inp.category or inp.item.get("title"), "queries": queries,
             "country": inp.country_code, "currency": inp.profile_currency, "max_price": inp.item.get("max_price"),
             "scout_run_id": inp.scout_run_id, "fetch_budget": max(2, remaining // 2)},
            start_to_close_timeout=RETAIL_TIMEOUT * 3, retry_policy=RETAIL_RETRY,
        )
        r.pages_fetched += int(res.get("fetches") or 0)
        for s in res["stores"]:
            self._stores.add(s["domain"])
        if not res["stores"]:
            return "No suitable stores found that ship to the user's country. Call finish.", False, False
        return json.dumps({"stores": res["stores"], "category": res.get("category")}), False, False

    def _url_in_scope(self, inp: RetailerScoutInput, url: str) -> bool:
        if not url.lower().startswith(("http://", "https://")):
            return False
        if inp.retailer["code"] == "shopify":
            return any(host_matches(url, d) for d in self._stores)
        domain = inp.retailer.get("domain")
        return not domain or domain == "*" or host_matches(url, domain)

    async def _submit(self, inp: RetailerScoutInput, r: RetailerScoutResult, args: dict[str, Any]) -> tuple[str, bool, bool]:
        cand, err = validate_submit(args)
        if cand is None:
            return err or "invalid arguments", True, False
        if self._submitted >= MAX_CANDIDATES_PER_RETAILER:
            return f"You already submitted {MAX_CANDIDATES_PER_RETAILER} candidates. Call finish.", True, False
        if self._submit_attempts >= MAX_SUBMIT_ATTEMPTS:
            return "Too many submissions. Call finish.", True, False
        if not self._url_in_scope(inp, cand.url):
            return "That URL is not on this retailer.", True, False
        if canonicalize_url(cand.url) not in self._known_urls:
            return "Only submit URLs returned by retailer_search or fetch_product_page.", True, False
        self._submit_attempts += 1

        r.pages_fetched += 1
        v = await workflow.execute_activity(
            verify_candidate,
            {"retailer": inp.retailer, "url": cand.url, "item": inp.item, "fx": inp.fx,
             "profile_currency": inp.profile_currency},
            start_to_close_timeout=RETAIL_TIMEOUT, retry_policy=RETAIL_RETRY,
        )
        p = v.get("product") or {}
        verified = bool(v["verified"])
        attrs = p.get("attributes") or {}
        record = await db_call(db_acts.record_candidate, {
            "scout_run_id": inp.scout_run_id,
            "retailer_code": inp.retailer["code"],
            "store_domain": v["store_domain"],
            "product_url": p.get("final_url") or cand.url,
            "canonical_url": v["canonical_url"],
            "title": p.get("title") or "Untitled product",
            "image_url": p.get("image_url"),
            "price": p.get("price") if verified else None,
            "currency": p.get("currency") if verified else None,
            "availability": p.get("availability") or "unknown",
            "condition": p.get("condition"),
            "gtin": p.get("gtin"), "mpn": p.get("mpn"), "brand": p.get("brand"),
            "match_score": cand.match_score,
            "rationale": cand.rationale,
            "price_source": p.get("price_source") if verified else None,
            "is_cross_border": bool(inp.retailer.get("is_cross_border")),
            "price_may_vary": bool(attrs.get("price_may_vary")),
            "extracted": {"agent_attributes": cand.attributes, "product_attributes": attrs,
                          "over_budget": v.get("over_budget"), "converted_price": v.get("converted_price"),
                          "converted_currency": inp.profile_currency, "verification": v["reason"],
                          "rendered": p.get("rendered")},
            "verified": verified,
        })
        if not verified:
            return f"Not verified ({v['reason']}). It will not be shown. Try another product.", False, False
        self._submitted += 1
        r.matches += 1
        r.candidates.append(CandidateSummary(
            match_id=record["match_id"], retailer_code=inp.retailer["code"], store_domain=v["store_domain"],
            canonical_url=v["canonical_url"], title=p.get("title") or "", match_score=cand.match_score,
            price=p.get("price"), currency=p.get("currency"), gtin=p.get("gtin"), mpn=p.get("mpn"),
            brand=p.get("brand"), over_budget=bool(v.get("over_budget")),
        ))
        await self._report(inp, r)
        note = " It is over the shopper's budget." if v.get("over_budget") else ""
        return f"Verified and saved.{note} {MAX_CANDIDATES_PER_RETAILER - self._submitted} submissions left.", False, False

