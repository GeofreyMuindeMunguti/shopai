# QA checklist: Mobile responsiveness (Issue #2)

Manual viewport checks for `docs/specs/issue-2-mobile-responsiveness.md`. The frontend has no unit or e2e runner, and the spec says not to add one, so each acceptance criterion (AC) is checked by hand using the steps below. Every row maps to exactly one AC.

## Setup
1. Start the stack with `make up` (or `npm run dev` in `frontend/`). Create the users and data in **Fixtures** below before you start.
2. Open Chrome DevTools, then Device Toolbar (Cmd/Ctrl+Shift+M), set it to "Responsive", and type in the width and height. Set the device type dropdown to **"Mobile"** (touch and mobile viewport) for V1, V2 and V6. Use "Desktop" for V3 to V5.
3. Viewports: **V1 360×740**, **V2 414×896**, **V3 768×1024**, **V4 1024×768**, **V5 1440×900** (desktop parity), **V6 740×360** (landscape phone, for AC1, AC2 and AC9 spot checks).
4. Paste this helper into the Console once per tab. It reports page overflow and the elements that cause it. Elements inside a scroll container are skipped, but the scroll container itself is still checked, so a container that overflows the page is reported:

```js
window.qa = () => {
  const vw = window.innerWidth, cw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth;
  const offenders = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width && (r.right > cw + 0.5 || r.left < -0.5) && !el.parentElement?.closest('[class*="overflow-auto"],[class*="overflow-x-auto"]');
  }).slice(0, 10);
  const ok = sw <= cw;
  console.log(ok ? 'PASS' : 'FAIL', { scrollWidth: sw, clientWidth: cw, innerWidth: vw, offenders });
  return ok;
};
qa();
```

After each navigation or state change, run `qa()` again. Expected result: `PASS`. Reload before each fresh viewport, except in the rows that test a live resize (1.16, 1.17 and 2.13).

## Fixtures
`supabase/seed.sql` seeds only retailers, task models, fact types and app settings. It creates no users, wishlists, items or candidates, so set them up by hand. Run the SQL below as `postgres` in the local DB container. There is no JWT in that session, so the guard triggers treat it as a service context:

```sh
docker exec -i supabase_db_project-template psql -U postgres -d postgres
```

| Fixture | How |
|---------|-----|
| F1 Admin user | Sign in once with Google as user A. This creates the `auth.users` and `user_profiles` rows. Finish onboarding, then run `make make-admin EMAIL=a@example.com` (it wraps `scripts/make-admin.sh`, which calls `promote_admin()`). Sign out and back in to refresh the JWT. |
| F2 Non-admin user | Sign in with Google as a second account, user B, in a separate Chrome profile or an incognito window. Finish onboarding. Do not run `make-admin`. |
| F3 Fresh user (for 1.2, 1.3 and 7.2) | Reset onboarding for B with `update user_profiles set onboarding_completed_at = null where email = 'b@example.com';` and reload `/`. You are sent to `/onboarding`. |
| F4 Wishlist with items | As A, create a wishlist on `/` and add an item. |
| F5 Candidates (for 1.6 and the PriceHistory and RejectReason dialogs) | Either let a scout run (adding or saving an item starts one if the Temporal worker and a model are configured), or insert candidates with the SQL below. |
| F6 Long content (for 1.18 to 1.20 and 7.1) | Use the SQL below. |

Candidates by SQL. Replace `<ITEM_ID>` with an id from `select id, title from wishlist_items;`:

```sql
with i as (select id, user_id from wishlist_items where id = '<ITEM_ID>')
insert into product_matches (wishlist_item_id, user_id, retailer_code, store_domain, product_url, canonical_url, title, price, currency, availability, match_score, rationale, status)
select i.id, i.user_id, r.code, r.dom, 'https://' || r.dom || '/p/' || g, 'https://' || r.dom || '/p/' || g,
       'QA candidate ' || g || ' from ' || r.code, 49.99 + g, 'USD', 'in_stock', 0.9 - g * 0.1, 'QA fixture', 'proposed'
from i, (values ('amazon', 'amazon.com'), ('temu', 'temu.com')) r(code, dom), generate_series(1, 2) g
on conflict (wishlist_item_id, canonical_url) do nothing;
update wishlist_items set status = 'candidates_ready' where id = '<ITEM_ID>';
```

Long content for user A. The values fit the `wishlists.name` (up to 120 characters) and `wishlist_items.title` (up to 200 characters) checks:

```sql
with u as (select id from auth.users where email = 'a@example.com'),
     w as (insert into wishlists (user_id, name, description) select id, repeat('W', 80), 'QA long-content fixture' from u returning id, user_id)
insert into wishlist_items (wishlist_id, user_id, title) select id, user_id, repeat('Longtitle ', 20) from w returning wishlist_id, id;
update retailers set display_name = 'Independent stores on Shopify across every launch market (QA long name)' where code = 'shopify';
```

Add candidates to the long item with the candidate SQL above, using `('shopify', 'example-store.myshopify.com')` as the retailer row. Restore the name afterwards with `update retailers set display_name = 'Independent stores (Shopify)' where code = 'shopify';`

## Desktop parity baseline (for 3.3, 4.8, 8.2 and 9.5)
Run `main` side by side with the branch. Run `git worktree add ../greenfield-main main`, then in `../greenfield-main/frontend` run `npm ci && npm run dev -- --port 5174` against the same Supabase stack. Compare the branch and `main` at the **same width** (V3, V4 and V5), in two windows of the same size.

---

## AC1: No page-level horizontal scroll (V1 to V4)
Run `qa()` on each route at V1, V2, V3 and V4. Expect `PASS` in every column that is not marked n/a.

| # | Route / state | V1 | V2 | V3 | V4 |
|---|---------------|----|----|----|----|
| 1.1 | `/login` (signed out) | | | | |
| 1.2 | `/onboarding` step 1 (F3 fresh user) | | | | |
| 1.3 | `/onboarding` each following step, including an optional step that shows Skip | | | | |
| 1.4 | `/` with no wishlists (empty state) | | | | |
| 1.5 | `/` with wishlists | | | | |
| 1.6 | `/wishlists/$wishlistId` with one item expanded that shows candidate cards (F5) | | | | |
| 1.7 | `/settings` (each tab, including the notification list) | | | | |
| 1.8 | `/admin/models` | | | | |
| 1.9 | `/admin/tasks` | | | | |
| 1.10 | `/admin/retailers` (Domain and Rate limit rows) | | | | |
| 1.11 | `/admin/stores` (with filters visible) | | | | |
| 1.12 | `/admin/settings` | | | | |
| 1.13 | `/admin/usage` | | | | |
| 1.14 | `/admin/jobs` | | | | |
| 1.15 | `/admin/audit` | | | | |
| 1.16 | Live resize: open `/admin/stores` at V5, change the width to 360 **without reloading**, then run `qa()` | | n/a | n/a | n/a |
| 1.17 | Live resize: on `/wishlists/$id` at V5, change the width to 360 without reloading, then run `qa()` | | n/a | n/a | n/a |
| 1.18 | F6: `/` showing the 80-character wishlist name with no spaces | | | | |
| 1.19 | F6: `/wishlists/$id` for the long wishlist, showing the 200-character item title | | | | |
| 1.20 | F6: the long item expanded, with the long Shopify retailer name in the candidate badge and the retailer filter chips | | | | |
| 1.21 | V6 (740×360) spot check, recorded in the V1 column: `/`, `/wishlists/$id`, `/admin/stores`, `/settings` | V6: | n/a | n/a | n/a |

## AC2: Mobile header below `md` (V1, V2, V6 740×360, and 767×900)
| # | Step | Expected |
|---|------|----------|
| 2.1 | Look at the header | You see a menu (hamburger) button, the "Scout" logo, the bell and the avatar. No inline "My Wishlists / Settings / Admin" links are visible. |
| 2.2 | Console: `[...document.querySelectorAll('nav[aria-label="Main"]')].filter(n => n.offsetParent).length` | `0` while the sheet is closed. |
| 2.3 | Console: `document.querySelector('[aria-label="Open menu"]').getAttribute('aria-expanded')` | `"false"` |
| 2.4 | Tap the menu button | A sheet slides in from the **left**. Running 2.3 again returns `"true"`. |
| 2.5 | Look at the items in the sheet as an admin user (F1) | My Wishlists, Settings and Admin appear in the same order as the desktop nav. |
| 2.6 | Repeat as a non-admin user (F2) | Admin is **not** listed. |
| 2.7 | On `/settings`, open the sheet, then run `document.querySelector('[role=dialog] [aria-current=page]').textContent` | `"Settings"`. On `/` or `/wishlists/...` it is "My Wishlists". On `/admin/*` it is "Admin". |
| 2.8 | Inspect the items in the sheet (Computed, height) | Each item is ≥ 40px tall. |
| 2.8a | Console: `document.querySelector('[aria-label="Open menu"]').getBoundingClientRect().height >= 40` | `true` |
| 2.9 | Tap "Settings" in the sheet | The URL becomes `/settings` and the sheet closes. |
| 2.10 | Open the sheet, then press browser Back | The sheet closes when the route changes. |
| 2.11 | After 2.9, and again after 2.10, run 2.3 | `"false"` both times. |
| 2.12 | At V6 (740×360), open the sheet | Close and every nav item can be reached (scroll inside the sheet if needed). `qa()` returns PASS. |
| 2.13 | Live resize: at 360, open the sheet, then change the width to 1024 **without reloading** | Record what happens. The sheet may stay open and usable, or it may close. If it is still open, Esc closes it. After it closes, the inline nav is visible, 3.2 returns `"none"`, and `qa()` returns PASS. |

## AC3: Desktop header unchanged (V3 768, V4 1024, V5 1440)
| # | Step | Expected |
|---|------|----------|
| 3.1 | Look at the header | The inline nav is visible and there is no menu button. |
| 3.2 | Console: `getComputedStyle(document.querySelector('[aria-label="Open menu"]')).display` | `"none"` |
| 3.3 | Using the parity baseline, compare the header on the branch and on `main` at V3, V4 and V5 (the same width each time) | At each width the spacing, active pill, bell and avatar are the same as on `main`. |

## AC4: Admin layout below `md` (V1, V2)
| # | Step | Expected |
|---|------|----------|
| 4.1 | Go to `/admin/models` | The left sidebar (`aside[aria-label="Admin"]`) is not visible, and you see a scrollable pill row above the breadcrumb. |
| 4.2 | Console: `getComputedStyle(document.querySelector('aside[aria-label="Admin"]')).display` | `"none"` |
| 4.3 | Swipe or scroll the pill row horizontally | All 8 admin links can be reached: models, tasks, retailers, stores, settings, usage, jobs, audit. |
| 4.4 | Console: `document.querySelector('nav[aria-label="Admin"] [aria-current=page]').textContent.trim()` | The label of the current page, and it is styled as active (filled). |
| 4.5 | Tap another pill | The page navigates and the new pill becomes active. |
| 4.6 | Inspect the pills (height) | Each is ≥ 40px tall. |
| 4.7 | Console: `document.querySelector('main [class*="flex-1"][class*="min-w-0"]').getBoundingClientRect().width === window.innerWidth` | `true`: the content pane spans the full width, with 16px padding inside it. |
| 4.8 | Using the parity baseline, compare `/admin/models` on the branch and on `main` at V3, V4 and V5 | The sidebar is visible and there is no pill row. At each width the layout matches `main` at the same width. |
| 4.9 | As the non-admin user (F2), go to `/admin/models` at V1 | You see the access-denied alert ("Your account doesn't have access to the admin portal.") or are redirected. No admin pill row (`nav[aria-label="Admin"]`) is visible. `qa()` returns PASS. |

## AC5: Admin tables scroll inside their container (V1)
| # | Step | Expected |
|---|------|----------|
| 5.1 | On `/admin/models`, `/admin/stores`, `/admin/usage`, `/admin/jobs` and `/admin/audit`, run `(w => [w.scrollWidth > w.clientWidth, w.getBoundingClientRect().right <= innerWidth])(document.querySelector('main .relative.w-full.overflow-auto'))`, then scroll horizontally inside the table | `[true, true]`: the table scrolls inside its wrapper and the wrapper stays inside the viewport. If the first value is `false`, record "table fits; not exercised" for that page. The second value must still be `true`. |
| 5.2 | Run `qa()` | `PASS`: the page itself does not scroll sideways. |
| 5.3 | Look at the search input above a table | It is full width at V1 and capped at `max-w-xs` at ≥ 640px. |
| 5.4 | Look at the `/admin/stores` filters at V1, V2 and 640×900 | Below 640px, Status, Ships to and Category each take a full-width row. At ≥ 640px they use their fixed widths (`sm:w-40` 160px, `sm:w-44` 176px, `sm:w-72` 288px) and may wrap onto a second line. Nothing is clipped and `qa()` returns PASS. |

## AC6: Form grids stack below `sm`
| # | Step | Expected |
|---|------|----------|
| 6.1 | At V1, open "Add item" (ItemFormDialog) | Max price / currency, Brands / Exclude brands, and Condition rows each show 1 column. The brands hint sits under both inputs. |
| 6.2 | At V1, tick "override retailers" | The retailer checkboxes show in 1 column. |
| 6.3 | At V1, on `/admin/models`, open "Add model" | The Max output tokens row shows 1 column. |
| 6.4 | Repeat 6.1 to 6.3 at 640×900 and V3 | 2 columns. The hint spans both columns. |

## AC7: Action rows wrap (V1)
| # | Step | Expected |
|---|------|----------|
| 7.1 | On `/wishlists/$wishlistId` for the F6 long wishlist at V1, run `(h => { const a = [...document.querySelectorAll('main button')].filter(b => ['Edit wishlist', 'Add item'].some(t => b.textContent.includes(t))); return [a.length === 2, a[0].parentElement.offsetTop > h.offsetTop, h.getBoundingClientRect().right <= innerWidth, a.every(b => b.getBoundingClientRect().right <= innerWidth)]; })(document.querySelector('main h1'))` | `[true, true, true, true]`: both buttons are found, the action group wrapped below the title, the long name breaks inside the viewport, and neither button is clipped. `qa()` returns PASS. |
| 7.2 | On `/onboarding` (F3), look at a step with Back, Skip and Next/Finish | The footer buttons wrap and none are cut off. `qa()` returns PASS. |

## AC8: Notifications popover (V1)
Radix `PopoverContent` renders `role="dialog"`, and `NotificationsBell.tsx` renders an `h2` with the text "Notifications" inside it.

| # | Step | Expected |
|---|------|----------|
| 8.1 | Open the bell popover, then run `(r => [r.left, window.innerWidth - r.right, r.width])([...document.querySelectorAll('[data-radix-popper-content-wrapper] [role=dialog]')].find(d => d.querySelector('h2')?.textContent === 'Notifications').getBoundingClientRect())` | The first two values are ≥ 0 and add up to ≥ 16. The width is about 328px (`w-[calc(100vw-2rem)]`). |
| 8.2 | At V5, using the parity baseline | The popover is 320px wide (`max-w-80`), the same as `main`. |

## AC9: Dialog gutters and scroll (V1, 360×600 and V6)
Run 9.1 on the centred dialogs: WishlistFormDialog, PriceHistoryDialog, RejectReasonDialog, the admin model form (`/admin/models`, "Add model"), and any AlertDialog (for example, delete confirmation). ItemFormDialog is **not** a centred dialog. It is a right-side Sheet (`SheetContent className="w-full overflow-y-auto sm:max-w-lg"`), so 9.4 checks it separately.

| # | Step | Expected |
|---|------|----------|
| 9.1 | With the dialog open: `(r => [r.left, window.innerWidth - r.right])(document.querySelector('[role=dialog],[role=alertdialog]').getBoundingClientRect())` | Each side is ≥ 8px. The dialog uses `max-w-[calc(100%-2rem)]`, so expect about 16px on each side. |
| 9.2 | At 360×600, open the admin model form ("Add model"), then run `(d => [d.getBoundingClientRect().top >= 0, d.getBoundingClientRect().bottom <= innerHeight, d.scrollHeight > d.clientHeight])(document.querySelector('[role=dialog]'))`. Then scroll inside the dialog to the last footer button. | `[true, true, true]`: the dialog fits in the viewport and its content scrolls **inside** it. The last button can be reached and is fully visible. |
| 9.3 | Repeat 9.2 at V6 (740×360) for the admin model form and for WishlistFormDialog (`/`, "New wishlist") | `[true, true, true]` for the model form. For WishlistFormDialog the first two values must be `true`. If the third is `false`, the content fits, so record "fits; scroll not exercised". The last button can be reached in both. |
| 9.4 | ItemFormDialog (Sheet) at V1, and at 360×600 with override retailers ticked | The sheet is full width at 360 by design (`w-full`). Its content scrolls inside the sheet and the footer Save button can be reached. `qa()` returns PASS. |
| 9.5 | At V5, PriceHistoryDialog, using the parity baseline | It is 512px wide (`sm:max-w-lg`), the same as `main`. |

## AC10: Page padding
| # | Step | Expected |
|---|------|----------|
| 10.1 | At V1, inspect the outer container on `/`, `/wishlists/$id`, `/settings` and the admin content pane | `padding: 16px`. |
| 10.2 | Same pages at 640px and wider | `padding: 24px`. |

## AC11: Keyboard and screen reader (V1)
| # | Step | Expected |
|---|------|----------|
| 11.1 | Tab to the menu button and press Enter | The sheet opens and focus moves inside it. |
| 11.2 | Press Tab and Shift+Tab repeatedly | Focus cycles only through Close and the nav links in the sheet (focus is trapped). |
| 11.3 | Press Esc, then run `document.activeElement.getAttribute('aria-label') === 'Open menu'` | The sheet closes and the console returns `true`. |
| 11.4 | Reload the page and press Tab once | "Skip to content" appears. Press Enter and focus moves to `main#main`. |
| 11.5 | Screen reader (VoiceOver rotor / NVDA landmarks) | When the sheet is open it is announced as a dialog titled "Scout" that contains a "Main" navigation. |

## AC12: Tooling
Node is not needed on the host. From `frontend/`:

```sh
docker run --rm -v "$PWD":/src:ro node:20-alpine sh -c 'cp -r /src /app && cd /app && npm ci && npm run typecheck && npm run lint && npm run build'
```

| # | Command | Expected |
|---|---------|----------|
| 12.1 | `npm run typecheck` | Exit code 0. |
| 12.2 | `npm run lint` | Exit code 0. Current status: **BLOCKED — pre-existing lint config breakage on main** (`.eslintrc.cjs` extends `plugin:react` but `eslint-plugin-react` is not in devDependencies, and there is no TS parser). This row does **not** count as a pass. To record it as blocked, attach evidence: the `npm run lint` output from the command above, run on `main` and on this branch. The two outputs must be identical. |
| 12.3 | `npm run build` | Exit code 0. The chunk-size warning was already there. |

## PR screenshots (from the spec's Testing Strategy)
Capture 360px and 1440px screenshots of: the header (with the sheet closed and with it open), `/wishlists/$id`, and one admin table page (for example `/admin/stores`).
