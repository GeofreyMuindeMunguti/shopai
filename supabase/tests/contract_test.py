"""End-to-end contract test for the wishlist schema, RLS and RPCs, via PostgREST.

Runs against a local Supabase stack (stdlib only):
    API_URL=http://127.0.0.1:54321 ANON_KEY=... SERVICE_ROLE_KEY=... python3 supabase/tests/contract_test.py
`supabase status -o env` prints the values. Expects a freshly reset DB (`supabase db reset`); creates throwaway users.
"""
from __future__ import annotations

import json
import os
import sys
import uuid
import urllib.error
import urllib.request

API = os.environ.get("API_URL", "http://127.0.0.1:54321").rstrip("/")
ANON = os.environ["ANON_KEY"]
SERVICE = os.environ["SERVICE_ROLE_KEY"]

passed = 0


def call(method, path, token, body=None, prefer=None):
    headers = {"apikey": ANON if token != SERVICE else SERVICE, "Authorization": f"Bearer {token}",
               "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(API + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        return exc.code, (json.loads(raw) if raw else None)


def rpc(fn, token, **args):
    return call("POST", f"/rest/v1/rpc/{fn}", token, args)


def check(name, cond, detail=None):
    global passed
    if not cond:
        print(f"FAIL {name} detail={json.dumps(detail, default=str)[:600]}")
        sys.exit(1)
    passed += 1
    print(f"ok   {name}")


def make_user(email, admin=False):
    status, body = call("POST", "/auth/v1/admin/users", SERVICE, {
        "email": email, "password": "Passw0rd!x", "email_confirm": True,
        "user_metadata": {"full_name": email.split("@")[0].title()},
        "app_metadata": {"role": "admin"} if admin else {},
    })
    assert status in (200, 201), body
    status, tok = call("POST", "/auth/v1/token?grant_type=password", ANON, {"email": email, "password": "Passw0rd!x"})
    assert status == 200, tok
    return body["id"], tok["access_token"]


def main():
    run = uuid.uuid4().hex[:8]
    a_id, a = make_user(f"alice-{run}@example.com")
    b_id, b = make_user(f"bob-{run}@example.com")
    _, admin = make_user(f"admin-{run}@example.com", admin=True)

    # --- Profiles & onboarding -------------------------------------------------
    s, prof = call("GET", "/rest/v1/user_profiles?select=*", a)
    check("profile auto-created from auth user", s == 200 and len(prof) == 1 and prof[0]["display_name"], prof)
    s, _ = rpc("ensure_my_profile", a)
    check("ensure_my_profile idempotent", s == 200)

    s, retailers = rpc("retailers_for_country", a, p_country="ZA")
    check("ZA retailers exclude temu/jumia", s == 200 and set(retailers) == {"amazon", "shopify", "takealot"}, retailers)

    s, body = call("PATCH", f"/rest/v1/user_profiles?user_id=eq.{a_id}", a,
                   {"country_code": "ZA", "currency": "ZAR", "retailer_codes": ["temu"]})
    check("temu rejected for ZA", s == 400 and body["code"] == "WL400", body)

    # No models yet: bootstrap one (worker does this from BEDROCK_BOOTSTRAP_MODEL_ID).
    s, model_id = rpc("bootstrap_platform_model", SERVICE, p_ref="us.anthropic.test-model-v1", p_display_name="Most thorough")
    check("bootstrap model created", s == 200 and model_id, model_id)
    s, again = rpc("bootstrap_platform_model", SERVICE, p_ref="other", p_display_name="x")
    check("bootstrap no-op once models exist", s == 200 and again is None, again)
    s, body = rpc("bootstrap_platform_model", a, p_ref="x")
    check("worker RPCs not callable by users", s in (401, 403, 404), body)

    s, models = call("GET", "/rest/v1/available_models?select=*", a)
    check("available_models lists default", s == 200 and models[0]["is_default"], models)
    s, body = call("GET", "/rest/v1/llm_models?select=*", a)
    check("select * on llm_models denied (secret_ref hidden)", s in (401, 403), body)

    s, _ = call("PATCH", f"/rest/v1/user_profiles?user_id=eq.{a_id}", a,
                {"country_code": "ZA", "currency": "ZAR", "retailer_codes": ["takealot", "amazon"],
                 "model_id": model_id})
    check("profile settings saved", s in (200, 204))

    # Item creation is gated on onboarding.
    s, wl = call("POST", "/rest/v1/wishlists", a, {"name": "Home office", "model_id": model_id, "default_currency": "ZAR"},
                 prefer="return=representation")
    check("wishlist created", s == 201, wl)
    wl_id = wl[0]["id"]
    s, body = call("POST", "/rest/v1/wishlist_items", a, {"wishlist_id": wl_id, "title": "Headphones"})
    check("item blocked before onboarding", body["code"] == "WL403", body)

    s, _ = call("PATCH", f"/rest/v1/user_profiles?user_id=eq.{a_id}", a, {"onboarding_completed_at": "now()"})
    check("onboarding completed", s in (200, 204))

    s, item = call("POST", "/rest/v1/wishlist_items", a, {
        "wishlist_id": wl_id, "title": "Noise-cancelling headphones", "max_price": 4500, "currency": "ZAR",
        "constraints": {"brands": ["Sony"], "condition": "new", "attributes": {"colour": "black"}},
    }, prefer="return=representation")
    check("item created as draft", s == 201 and item[0]["status"] == "draft", item)
    item_id = item[0]["id"]

    s, body = call("PATCH", f"/rest/v1/wishlist_items?id=eq.{item_id}", a, {"status": "approved"})
    check("client can't jump item status", s == 400 and body["code"] == "WL400", body)

    # --- Outbox -----------------------------------------------------------------
    s, body = call("POST", "/rest/v1/workflow_jobs", a, {"job_type": "scout_item"})
    check("clients can't insert workflow_jobs", s in (401, 403), body)

    s, req = rpc("request_scout", a, wishlist_item_id=item_id, reason="created")
    check("request_scout queues run + job", s == 200 and req["status"] == "queued", req)
    run_id, job_id = req["scout_run_id"], req["job_id"]
    s, body = rpc("request_scout", a, wishlist_item_id=item_id, reason="manual")
    check("second request -> WL409", s == 409 or (body or {}).get("code") == "WL409", body)
    s, body = rpc("request_scout", b, wishlist_item_id=item_id, reason="manual")
    check("other user -> WL403", (body or {}).get("code") == "WL403", body)
    s, items = call("GET", f"/rest/v1/wishlist_items?id=eq.{item_id}&select=status", a)
    check("item is scouting", items[0]["status"] == "scouting", items)

    s, jobs = rpc("claim_workflow_jobs", SERVICE, p_limit=50)
    mine = [j for j in jobs if j["id"] == job_id]
    check("dispatcher claims job", s == 200 and mine and mine[0]["status"] == "dispatching", jobs)
    s, again = rpc("claim_workflow_jobs", SERVICE, p_limit=50)
    check("claimed job not re-claimed", all(j["id"] != job_id for j in again), again)
    s, _ = rpc("mark_job_dispatched", SERVICE, p_job_id=job_id, p_workflow_id=f"job-{job_id}")
    check("job dispatched", s in (200, 204))

    s, ctx = rpc("begin_scout_run", SERVICE, p_scout_run_id=run_id, p_workflow_id=f"job-{job_id}")
    check("begin_scout_run context", s == 200 and not ctx["skip"] and ctx["model"]["ref"] == "us.anthropic.test-model-v1"
          and {r["code"] for r in ctx["retailers"]} == {"amazon", "takealot"} and ctx["country_code"] == "ZA", ctx)
    check("task models snapshotted", set(ctx["task_models"]) >= {"scout_agent", "category_inference", "cross_retailer_rerank"}, ctx["task_models"])
    amazon = next(r for r in ctx["retailers"] if r["code"] == "amazon")
    check("amazon ZA domain", amazon["domain"] == "amazon.co.za" and amazon["is_cross_border"] is False, amazon)
    s, ctx2 = rpc("begin_scout_run", SERVICE, p_scout_run_id=run_id, p_workflow_id=f"job-{job_id}")
    check("begin_scout_run idempotent", ctx2["scout_run_id"] == run_id and not ctx2["skip"], ctx2)

    s, _ = rpc("set_retailer_result", SERVICE, p_scout_run_id=run_id, p_retailer_code="takealot",
               p_result={"status": "running"})
    check("retailer progress", s in (200, 204))

    cand = {"scout_run_id": run_id, "retailer_code": "takealot", "store_domain": "takealot.com",
            "product_url": "https://www.takealot.com/sony-wh-1000xm5/PLID1?utm=x", "canonical_url": "https://www.takealot.com/x/PLID1",
            "title": "Sony WH-1000XM5", "price": 4199, "currency": "ZAR", "availability": "in_stock",
            "match_score": 0.92, "rationale": "Sony, black, ANC", "price_source": "json_ld", "verified": True}
    s, rec = rpc("record_candidate", SERVICE, p_candidate=cand)
    check("verified candidate proposed", s == 200 and rec["status"] == "proposed", rec)
    match_id = rec["match_id"]
    s, rec2 = rpc("record_candidate", SERVICE, p_candidate={**cand, "canonical_url": "https://www.takealot.com/x/PLID2",
                                                             "product_url": "https://www.takealot.com/x/PLID2", "verified": False})
    check("unverified candidate hidden", rec2["status"] == "unverified", rec2)

    s, body = call("GET", f"/rest/v1/product_matches?wishlist_item_id=eq.{item_id}&select=id,status", b)
    check("RLS: bob sees none of alice's matches", s == 200 and body == [], body)
    s, body = call("GET", "/rest/v1/wishlist_items?select=id", b)
    check("RLS: bob sees no items", body == [], body)
    s, body = call("PATCH", f"/rest/v1/product_matches?id=eq.{match_id}", a, {"price": 1})
    check("clients can't edit match price", s in (401, 403) or body == [], body)

    s, fin = rpc("finish_scout_run", SERVICE, p_scout_run_id=run_id, p_status="partial",
                 p_stats={"input_tokens": 1200, "output_tokens": 300, "tool_calls": 6, "pages_fetched": 4,
                          "task_models": {"scout_agent": {"input_tokens": 1200, "output_tokens": 300}},
                          "retailer_results": {"amazon": {"status": "failed", "error": "blocked"}}})
    check("finish -> candidates_ready", s == 200 and fin["item_status"] == "candidates_ready", fin)
    s, fin2 = rpc("finish_scout_run", SERVICE, p_scout_run_id=run_id, p_status="failed")
    check("finish idempotent", fin2.get("skip") is True, fin2)
    s, runs = call("GET", f"/rest/v1/scout_runs?id=eq.{run_id}&select=status,retailer_results,task_models,input_tokens", a)
    check("run snapshot merged", runs[0]["status"] == "partial" and runs[0]["retailer_results"]["takealot"]["status"] == "running"
          and runs[0]["task_models"]["scout_agent"]["input_tokens"] == 1200, runs)

    s, hist = rpc("match_price_history", a, p_match_id=match_id)
    check("price history recorded", s == 200 and len(hist) == 1 and float(hist[0]["price"]) == 4199, hist)
    s, hist_b = rpc("match_price_history", b, p_match_id=match_id)
    check("price history private", hist_b == [], hist_b)

    # --- Decisions --------------------------------------------------------------
    s, body = rpc("decide_match", b, match_id=match_id, decision="approve")
    check("bob can't decide alice's match", (body or {}).get("code") == "WL403", body)
    s, body = rpc("decide_match", a, match_id=rec2["match_id"], decision="approve")
    check("unverified can't be approved", (body or {}).get("code") == "WL400", body)
    s, dec = rpc("decide_match", a, match_id=match_id, decision="approve")
    check("approve -> item approved", s == 200 and dec["item_status"] == "approved", dec)
    s, dec = rpc("decide_match", a, match_id=match_id, decision="reject", reason="too expensive")
    check("reject -> back to no_matches/candidates", dec["item_status"] in ("no_matches", "candidates_ready"), dec)
    s, events = call("GET", "/rest/v1/audit_events?select=event_type&order=created_at", a)
    types = [e["event_type"] for e in events]
    check("audit trail", {"scout_run.requested", "scout_run.started", "match.approved", "match.rejected"} <= set(types), types)

    # Feedback loop: rejection shows up in the next run's preferences.
    s, req2 = rpc("request_scout", a, wishlist_item_id=item_id, reason="manual")
    s, jobs = rpc("claim_workflow_jobs", SERVICE, p_limit=50)
    s, ctx3 = rpc("begin_scout_run", SERVICE, p_scout_run_id=req2["scout_run_id"])
    check("rejections fed into next run", ctx3["preferences"]["rejected"][0]["reason"] == "too expensive", ctx3["preferences"])
    s, fin3 = rpc("finish_scout_run", SERVICE, p_scout_run_id=req2["scout_run_id"], p_status="failed",
                  p_stats={"retry_after_seconds": 60}, p_error="Bedrock throttled")
    check("transient failure auto-retries", fin3["retry"] and fin3["retry"]["status"] == "queued", fin3)
    s, notes = call("GET", "/rest/v1/notifications?select=kind,body", a)
    check("failure notification", any(n["kind"] == "run_failed" and "retry automatically" in n["body"] for n in notes), notes)

    # Job release/backoff -> failure marks the domain row failed.
    retry_job = fin3["retry"]["job_id"]
    for _ in range(5):
        call("PATCH", f"/rest/v1/workflow_jobs?id=eq.{retry_job}", SERVICE, {"available_at": "2000-01-01T00:00:00Z"})
        rpc("claim_workflow_jobs", SERVICE, p_limit=50)
        s, state = rpc("release_workflow_job", SERVICE, p_job_id=retry_job, p_error="temporal down")
    check("job fails after max attempts", state == "failed", state)
    s, runs = call("GET", f"/rest/v1/scout_runs?id=eq.{fin3['retry']['scout_run_id']}&select=status,error", a)
    check("domain row failed with job", runs[0]["status"] == "failed", runs)

    # --- Linked accounts ----------------------------------------------------------
    s, acct = call("POST", "/rest/v1/merchant_accounts", a, {"retailer_code": "takealot", "account_email": f"alice-{run}@example.com"},
                   prefer="return=representation")
    check("link account", s == 201, acct)
    s, _ = call("PATCH", f"/rest/v1/merchant_accounts?id=eq.{acct[0]['id']}", a, {"status": "unlinked"})
    s, events = call("GET", "/rest/v1/audit_events?entity_type=eq.merchant_account&select=event_type", a)
    check("account audit", [e["event_type"] for e in events] == ["merchant_account.added", "merchant_account.revoked"]
          or sorted(e["event_type"] for e in events) == ["merchant_account.added", "merchant_account.revoked"], events)

    # --- Admin ----------------------------------------------------------------------
    s, body = call("POST", "/rest/v1/llm_models", a, {"display_name": "x", "bedrock_model_id": "y"})
    check("non-admin can't add models", s in (401, 403), body)
    s, new_model = call("POST", "/rest/v1/llm_models?select=id,is_enabled", admin,
                        {"display_name": "Fast & economical", "bedrock_model_id": "us.amazon.nova-lite-v1:0",
                         "description": "Fast"}, prefer="return=representation")
    check("admin adds model", s == 201, new_model)
    fast_id = new_model[0]["id"]
    s, jobs = call("GET", f"/rest/v1/workflow_jobs?job_type=eq.model_test&select=payload,status", admin)
    check("saving a model enqueues a test", any(j["payload"]["model_id"] == fast_id for j in jobs), jobs)
    s, body = call("PATCH", f"/rest/v1/llm_models?id=eq.{fast_id}", admin, {"is_enabled": True})
    check("untested model can't be enabled", s == 400 and body["code"] == "WL400", body)
    s, _ = rpc("complete_model_test", SERVICE, p_model_id=fast_id, p_ok=True)
    s, _ = call("PATCH", f"/rest/v1/llm_models?id=eq.{fast_id}", admin, {"is_enabled": True})
    check("tested model enabled", s in (200, 204))
    s, body = call("PATCH", f"/rest/v1/llm_models?id=eq.{fast_id}", admin, {"is_default": True})
    check("is_default only via RPC", s in (401, 403), body)
    s, _ = rpc("set_default_model", admin, model_id=fast_id)
    s, models = call("GET", "/rest/v1/available_models?select=id,is_default", a)
    check("exactly one default", [m["id"] for m in models if m["is_default"]] == [fast_id], models)
    s, body = rpc("set_default_model", a, model_id=model_id)
    check("set_default_model admin-only", (body or {}).get("code") == "WL403", body)

    s, _ = call("PATCH", f"/rest/v1/llm_task_models?task_key=eq.category_inference", admin, {"model_id": fast_id})
    check("task model mapped", s in (200, 204))

    # Disable alice's wishlist model -> fallback + notification.
    s, _ = call("PATCH", f"/rest/v1/llm_models?id=eq.{model_id}", admin, {"is_enabled": False})
    check("admin disables non-default model", s in (200, 204))
    s, res = rpc("resolve_wishlist_model", a, p_wishlist_id=wl_id)
    check("wishlist falls back", res["llm_model_id"] == fast_id and "unavailable" in res["fallback_reason"], res)
    s, notes = call("GET", "/rest/v1/notifications?kind=eq.model_fallback&select=id", a)
    check("users notified of disabled model", len(notes) == 1, notes)

    s, audit = call("GET", "/rest/v1/audit_events?entity_type=eq.llm_models&select=event_type", admin)
    check("admin changes audited", {"llm_models.insert", "llm_models.update", "llm_models.set_default"} <= {e["event_type"] for e in audit}, audit)
    s, usage = call("GET", "/rest/v1/admin_usage_summary?select=*", admin)
    check("usage view (admin)", s == 200 and sum(u["runs"] for u in usage) >= 2, usage)
    s, usage = call("GET", "/rest/v1/admin_usage_summary?select=*", b)
    check("usage view scoped for users", s == 200 and usage == [], usage)

    s, store = rpc("upsert_shopify_store", SERVICE, p_store={"domain": f"Sonic-{run}.co.za", "ships_to": ["za"], "currency": "zar",
                                                              "categories": ["Electronics > Audio"], "quality_score": 0.8})
    check("store upserted", store["domain"] == f"sonic-{run}.co.za" and store["ships_to"] == ["ZA"], store)
    s, _ = call("PATCH", f"/rest/v1/shopify_stores?id=eq.{store['id']}", admin, {"status": "blocked"})
    s, found = rpc("find_shopify_stores", SERVICE, p_categories=["Electronics > Audio"], p_country="ZA", p_limit=8)
    check("blocked store excluded", all(f["id"] != store["id"] for f in found), found)
    s, body = call("GET", "/rest/v1/shopify_stores?select=id", a)
    check("shoppers can't read stores", body == [], body)

    s, n = rpc("upsert_fx_rates", SERVICE, p_as_of="2026-11-11", p_source="exchangerate_api_open",
               p_rates={"KES": 129.2, "ZAR": 18.1, "USD": 1, "BAD": "x"})
    check("fx upserted", n == 3, n)
    s, fx = call("GET", "/rest/v1/fx_latest?select=*", a)
    check("fx readable", {r["quote_currency"] for r in fx} >= {"KES", "ZAR"}, fx)

    s, data = rpc("export_my_data", a)
    check("export", data["profile"]["user_id"] == a_id and len(data["product_matches"]) == 2, list(data))

    # Scheduled re-scouts.
    call("PATCH", f"/rest/v1/wishlist_items?id=eq.{item_id}", a, {"rescout_frequency": "daily"})
    call("PATCH", f"/rest/v1/wishlist_items?id=eq.{item_id}", SERVICE, {"last_scouted_at": "2000-01-01T00:00:00Z"})
    s, n = rpc("enqueue_due_rescouts", SERVICE, p_limit=100)
    check("due rescout enqueued", n >= 1, n)

    s, _ = rpc("delete_my_account", b)
    check("delete account", s in (200, 204))
    s, body = call("GET", f"/rest/v1/user_profiles?user_id=eq.{b_id}&select=id", SERVICE)
    check("data removed", body == [], body)

    print(f"\nall {passed} checks passed")


if __name__ == "__main__":
    main()
