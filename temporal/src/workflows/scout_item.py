"""ScoutItemWorkflow: resolve the run, fan out one child per retailer, merge, finish (ADR-0001)."""
from __future__ import annotations
import asyncio
from dataclasses import asdict
from datetime import timedelta
from typing import Any

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from ..activities import db as db_acts
    from ..activities.llm import llm_converse
    from ..activities.retail import verify_candidate
    from ..activities.scout import merge_and_rank
    from ..config import settings
    from ..retail.taxonomy import TAXONOMY
    from ..scout.prompts import CATEGORY_PROMPT, PREFERENCE_PROMPT, truncate
    from ..scout.types import Budget, RetailerScoutInput, RetailerScoutResult
    from ..scout.verification import stale_reason
    from ..retail.models import ProductData
    from .common import LLM_RETRY, LLM_TIMEOUT, RETAIL_RETRY, RETAIL_TIMEOUT, classify, db_call
    from .scout_retailer import ScoutRetailerWorkflow

MAX_RECHECKS = 10
RETRY_AFTER_SECONDS = 900


@workflow.defn
class ScoutItemWorkflow:
    def __init__(self) -> None:
        self._task_usage: dict[str, dict[str, int]] = {}
        self._pages = 0
        self._status = "starting"

    @workflow.query
    def status(self) -> str:
        return self._status

    @workflow.run
    async def run(self, scout_run_id: str) -> dict[str, Any]:
        ctx = await db_call(db_acts.begin_scout_run, scout_run_id, workflow.info().workflow_id)
        if ctx.get("skip"):
            self._status = "skipped"
            return {"scout_run_id": scout_run_id, "skipped": ctx.get("reason")}
        try:
            return await self._run(scout_run_id, ctx)
        except asyncio.CancelledError:
            await db_call(db_acts.finish_scout_run, scout_run_id, "cancelled", self._stats([]), "Cancelled")
            raise
        except Exception as exc:
            kind, message = classify(exc)
            stats = self._stats([])
            if kind == "llm_unavailable":
                stats["retry_after_seconds"] = RETRY_AFTER_SECONDS
            await db_call(db_acts.finish_scout_run, scout_run_id, "failed", stats, message)
            self._status = "failed"
            return {"scout_run_id": scout_run_id, "status": "failed", "error": message}

    async def _llm_task(self, ctx: dict[str, Any], task: str, prompt: str, max_tokens: int = 300) -> str | None:
        """Background-task LLM call on the model snapshotted for the task (FR-1d). Failures are non-fatal."""
        model = (ctx.get("task_models") or {}).get(task) or ctx["model"]
        try:
            resp = await workflow.execute_activity(
                llm_converse,
                {"model": model, "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
                 "max_tokens": max_tokens, "task": task, "scout_run_id": ctx["scout_run_id"]},
                start_to_close_timeout=LLM_TIMEOUT, retry_policy=LLM_RETRY,
            )
        except Exception as exc:
            workflow.logger.warning("background task failed task=%s error=%s", task, classify(exc)[1])
            return None
        usage = self._task_usage.setdefault(task, {"input_tokens": 0, "output_tokens": 0})
        usage["input_tokens"] += resp["input_tokens"]
        usage["output_tokens"] += resp["output_tokens"]
        return (resp.get("text") or "").strip() or None

    async def _recheck_existing(self, ctx: dict[str, Any], fx: dict[str, float]) -> None:
        """Scheduled runs re-verify known matches; dead links / stock-outs / price jumps become stale."""
        retailers = {r["code"]: r for r in ctx["retailers"]}
        existing = [m for m in ctx.get("existing_matches") or []
                    if m["status"] in ("proposed", "approved", "saved") and m["retailer_code"] in retailers]
        for m in existing[:MAX_RECHECKS]:
            retailer = retailers[m["retailer_code"]]
            try:
                v = await workflow.execute_activity(
                    verify_candidate,
                    {"retailer": retailer, "url": m["product_url"], "item": ctx["item"], "fx": fx,
                     "profile_currency": ctx.get("profile_currency")},
                    start_to_close_timeout=RETAIL_TIMEOUT, retry_policy=RETAIL_RETRY)
            except Exception as exc:
                workflow.logger.warning("recheck failed match_id=%s error=%s", m["id"], classify(exc)[1])
                continue
            self._pages += 1
            pd = ProductData.from_dict(v["product"]) if v.get("product") else ProductData(url=m["product_url"])
            reason = stale_reason(m, pd, bool(v["verified"]), v["reason"])
            if reason:
                await db_call(db_acts.mark_match_stale, m["id"], reason)
                continue
            await db_call(db_acts.record_candidate, {
                "scout_run_id": ctx["scout_run_id"], "retailer_code": m["retailer_code"], "store_domain": v["store_domain"],
                "product_url": pd.final_url or m["product_url"], "canonical_url": m["canonical_url"], "title": pd.title,
                "price": pd.price, "currency": pd.currency, "availability": pd.availability, "image_url": pd.image_url,
                "price_source": pd.price_source, "verified": True,
            })

    async def _run(self, scout_run_id: str, ctx: dict[str, Any]) -> dict[str, Any]:
        self._status = "running"
        fx = {ccy: float(v["rate"]) for ccy, v in (ctx.get("fx") or {}).items()}
        item = ctx["item"]
        retailers = ctx["retailers"]
        prefs = ctx.get("preferences") or {}

        if ctx.get("trigger") == "scheduled":
            await self._recheck_existing(ctx, fx)

        preference_summary = None
        if prefs.get("approved") or prefs.get("rejected"):
            preference_summary = await self._llm_task(ctx, "preference_summary", PREFERENCE_PROMPT.format(
                history=truncate(str(prefs), 3000)))
        category = None
        discovery_queries: list[str] = []
        if any(r["code"] == "shopify" for r in retailers):
            item_text = truncate(f"{item.get('title')} {item.get('description') or ''}", 500)
            category = await self._llm_task(ctx, "category_inference",
                                            CATEGORY_PROMPT.format(taxonomy="\n".join(TAXONOMY), item=item_text), 60)
            queries = await self._llm_task(
                ctx, "discovery_queries",
                f"Write 3 web search queries (one per line, no numbering) that would find independent online stores "
                f"selling '{item_text}' that ship to country {ctx['country_code']}. Prefer local stores.", 150)
            discovery_queries = [q.strip(" -•\"") for q in (queries or "").splitlines() if q.strip()][:4]

        n = max(len(retailers), 1)
        budget = Budget(iterations=settings.scout_max_iterations,
                        fetches=max(3, settings.scout_max_fetches // n),
                        tokens=max(8000, settings.scout_max_tokens // n))
        existing_urls = [m["canonical_url"] for m in ctx.get("existing_matches") or []]
        wf_id = workflow.info().workflow_id

        async def child(retailer: dict[str, Any]) -> RetailerScoutResult:
            inp = RetailerScoutInput(
                scout_run_id=scout_run_id, retailer=retailer, item=item, country_code=ctx["country_code"],
                profile_currency=ctx.get("profile_currency"), model=ctx["model"], task_models=ctx.get("task_models") or {},
                preferences=prefs, preference_summary=preference_summary, category=category,
                existing_canonical_urls=existing_urls, fx=fx, budget=budget, discovery_queries=discovery_queries)
            try:
                return await workflow.execute_child_workflow(
                    ScoutRetailerWorkflow.run, inp, id=f"{wf_id}-{retailer['code']}",
                    execution_timeout=timedelta(seconds=settings.scout_child_timeout_seconds))
            except Exception as exc:  # timeout / termination of the child
                kind, message = classify(exc)
                failed = RetailerScoutResult(retailer_code=retailer["code"], status="failed", error=message, error_kind=kind)
                try:
                    await db_call(db_acts.set_retailer_result, scout_run_id, retailer["code"],
                                  {"status": "failed", "error": message})
                except Exception:
                    pass
                return failed

        results: list[RetailerScoutResult] = list(await asyncio.gather(*(child(r) for r in retailers)))
        candidates = [asdict(c) for r in results for c in r.candidates]
        merged: dict[str, Any] = {}
        if candidates:
            merged = await workflow.execute_activity(merge_and_rank, args=[candidates, ctx.get("profile_currency"), fx],
                                                     start_to_close_timeout=timedelta(seconds=30))

        status, error = self._final_status(results)
        stats = self._stats(results)
        if merged:
            stats["ranking"] = [{"match_id": c["match_id"], "rank": c["rank"], "best_for_retailer": c["best_for_retailer"]}
                                for c in merged["ranked"]]
            stats["duplicates"] = merged["duplicates"]
        if status == "failed" and all(r.error_kind == "llm_unavailable" for r in results if r.status == "failed"):
            stats["retry_after_seconds"] = RETRY_AFTER_SECONDS
        await db_call(db_acts.finish_scout_run, scout_run_id, status, stats, error)
        self._status = status
        return {"scout_run_id": scout_run_id, "status": status, "matches": sum(r.matches for r in results)}

    @staticmethod
    def _final_status(results: list[RetailerScoutResult]) -> tuple[str, str | None]:
        failed = [r for r in results if r.status == "failed"]
        matches = sum(r.matches for r in results)
        if results and len(failed) == len(results):
            return "failed", "; ".join(f"{r.retailer_code}: {r.error}" for r in failed)[:1000]
        if failed or any(r.budget_exhausted for r in results):
            return "partial", ("; ".join(f"{r.retailer_code}: {r.error}" for r in failed)[:1000] or None)
        return ("completed" if matches else "no_matches"), None

    def _stats(self, results: list[RetailerScoutResult]) -> dict[str, Any]:
        agent_in = sum(r.input_tokens for r in results)
        agent_out = sum(r.output_tokens for r in results)
        task_models = {"scout_agent": {"input_tokens": agent_in, "output_tokens": agent_out}, **self._task_usage}
        return {
            "input_tokens": agent_in + sum(u["input_tokens"] for u in self._task_usage.values()),
            "output_tokens": agent_out + sum(u["output_tokens"] for u in self._task_usage.values()),
            "tool_calls": sum(r.tool_calls for r in results),
            "pages_fetched": self._pages + sum(r.pages_fetched for r in results),
            "task_models": task_models,
            "retailer_results": {r.retailer_code: {
                "status": r.status, "matches": r.matches, "input_tokens": r.input_tokens, "output_tokens": r.output_tokens,
                "pages_fetched": r.pages_fetched, "budget_exhausted": r.budget_exhausted, "error": r.error,
            } for r in results},
        }
