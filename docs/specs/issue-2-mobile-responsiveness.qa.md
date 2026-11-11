# QA checklist: Mobile responsiveness (Issue #2)

Manual viewport checks for `docs/specs/issue-2-mobile-responsiveness.md`. The frontend has no unit or e2e runner, and the spec says not to add one, so each acceptance criterion (AC) is checked by hand using the steps below. Every row maps to exactly one AC.

## Setup
1. Start the stack with `make up` (or `npm run dev` in `frontend/`). Sign in as an **admin** user who has finished onboarding and owns at least one wishlist with an item that has candidates. For AC2 and AC4, also sign in as a **non-admin** user.
2. Open Chrome DevTools, then Device Toolbar (Cmd/Ctrl+Shift+M), set it to "Responsive", and type in the width and height.
3. Viewports: **V1 360×740**, **V2 414×896**, **V3 768×1024**, **V4 1024×768**, **V5 1440×900** (V5 is only for the desktop parity checks).
4. Paste this helper into the Console once per tab. It reports page overflow and the elements that cause it:

```js
window.qa = () => {
  const vw = window.innerWidth, sw = document.documentElement.scrollWidth;
  const offenders = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width && (r.right > vw + 0.5 || r.left < -0.5) && !el.closest('[class*="overflow-auto"],[class*="overflow-x-auto"]');
  }).slice(0, 10);
  console.log(sw <= vw ? 'PASS' : 'FAIL', { scrollWidth: sw, innerWidth: vw, offenders });
  return sw <= vw;
};
qa();
```

After each navigation or state change, run `qa()` again. Expected result: `PASS`. If you resize the viewport, reload the page first.

---

## AC1: No page-level horizontal scroll (V1 to V4)
Run `qa()` on each route at V1, V2, V3 and V4. Expect `PASS` in all 4 columns.

| # | Route / state | V1 | V2 | V3 | V4 |
|---|---------------|----|----|----|----|
| 1.1 | `/login` (signed out) | | | | |
| 1.2 | `/onboarding` step 1 (use a fresh user) | | | | |
| 1.3 | `/onboarding` each following step, including an optional step that shows Skip | | | | |
| 1.4 | `/` with no wishlists (empty state) | | | | |
| 1.5 | `/` with wishlists | | | | |
| 1.6 | `/wishlists/$wishlistId` with one item expanded that shows candidate cards | | | | |
| 1.7 | `/settings` (each tab, including the notification list) | | | | |
| 1.8 | `/admin/models` | | | | |
| 1.9 | `/admin/tasks` | | | | |
| 1.10 | `/admin/retailers` (Domain and Rate limit rows) | | | | |
| 1.11 | `/admin/stores` (with filters visible) | | | | |
| 1.12 | `/admin/settings` | | | | |
| 1.13 | `/admin/usage` | | | | |
| 1.14 | `/admin/jobs` | | | | |
| 1.15 | `/admin/audit` | | | | |

## AC2: Mobile header below `md` (V1, V2, and 767×900)
| # | Step | Expected |
|---|------|----------|
| 2.1 | Look at the header | You see a menu (hamburger) button, the "Scout" logo, the bell and the avatar. No inline "My Wishlists / Settings / Admin" links are visible. |
| 2.2 | Console: `[...document.querySelectorAll('nav[aria-label="Main"]')].filter(n => n.offsetParent).length` | `0` while the sheet is closed. |
| 2.3 | Console: `document.querySelector('[aria-label="Open menu"]').getAttribute('aria-expanded')` | `"false"` |
| 2.4 | Tap the menu button | A sheet slides in from the **left**. Running 2.3 again returns `"true"`. |
| 2.5 | Look at the items in the sheet as an admin user | My Wishlists, Settings and Admin appear in the same order as the desktop nav. |
| 2.6 | Repeat as a non-admin user | Admin is **not** listed. |
| 2.7 | On `/settings`, open the sheet, then run `document.querySelector('[role=dialog] [aria-current=page]').textContent` | `"Settings"`. On `/` or `/wishlists/...` it is "My Wishlists". On `/admin/*` it is "Admin". |
| 2.8 | Inspect the items in the sheet (Computed, height) | Each item is ≥ 40px tall. |
| 2.9 | Tap "Settings" in the sheet | The URL becomes `/settings` and the sheet closes. |
| 2.10 | Open the sheet, then press browser Back | The sheet closes when the route changes. |

## AC3: Desktop header unchanged (V3 768, V4 1024, V5 1440)
| # | Step | Expected |
|---|------|----------|
| 3.1 | Look at the header | The inline nav is visible and there is no menu button. |
| 3.2 | Console: `getComputedStyle(document.querySelector('[aria-label="Open menu"]')).display` | `"none"` |
| 3.3 | At V5, compare a screenshot side by side with `main` | The spacing, active pill, bell and avatar are the same. |

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
| 4.8 | At V3 (768) | The sidebar is visible, there is no pill row, and the layout matches `main` at V5. |

## AC5: Admin tables scroll inside their container (V1)
| # | Step | Expected |
|---|------|----------|
| 5.1 | On `/admin/models`, `/admin/stores`, `/admin/usage`, `/admin/jobs` and `/admin/audit`, scroll horizontally inside the table | The table scrolls inside its bordered wrapper (`overflow-auto`). |
| 5.2 | Run `qa()` | `PASS`: the page itself does not scroll sideways. |
| 5.3 | Look at the search input above a table | It is full width at V1 and capped at `max-w-xs` at ≥ 640px. |
| 5.4 | Look at the `/admin/stores` filters at V1 | Status, Ships to and Category each take a full row. At ≥ 640px they sit inline at their fixed widths. |

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
| 7.1 | On `/wishlists/$wishlistId`, look at "Edit wishlist" and "Add item" | They wrap onto a new line if needed and are not clipped. `qa()` returns PASS. |
| 7.2 | On `/onboarding`, look at a step with Back, Skip and Next/Finish | The footer buttons wrap and none are cut off. `qa()` returns PASS. |

## AC8: Notifications popover (V1)
| # | Step | Expected |
|---|------|----------|
| 8.1 | Open the bell popover, then run `(r => [r.left, window.innerWidth - r.right])(document.querySelector('[data-radix-popper-content-wrapper] > *').getBoundingClientRect())` | Both values are ≥ 0, and they add up to ≥ 16. The width is about 328px. |
| 8.2 | At V5 | The popover is 320px wide (`max-w-80`), the same as `main`. |

## AC9: Dialog gutters and scroll (V1)
Run these checks on ItemFormDialog, WishlistFormDialog, PriceHistoryDialog, RejectReasonDialog, the admin model form, and any AlertDialog (for example, delete confirmation).

| # | Step | Expected |
|---|------|----------|
| 9.1 | With the dialog open: `(r => [r.left, window.innerWidth - r.right])(document.querySelector('[role=dialog],[role=alertdialog]').getBoundingClientRect())` | Each side is ≥ 8px, so the total is ≥ 16px. |
| 9.2 | Open ItemFormDialog with override retailers ticked, at 360×600 | The dialog fits within the viewport height and the content scrolls **inside** the dialog. |
| 9.3 | At V5, PriceHistoryDialog | It is 512px wide (`sm:max-w-lg`), the same as `main`. |

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
| 11.3 | Press Esc | The sheet closes and focus returns to the "Open menu" button. |
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
| 12.2 | `npm run lint` | Exit code 0. **Known pre-existing failure:** `.eslintrc.cjs` uses `plugin:react` but `eslint-plugin-react` is not in devDependencies, and there is no TS parser, so `eslint .` matches no `.ts/.tsx` files. This also fails on `main`. |
| 12.3 | `npm run build` | Exit code 0. The chunk-size warning was already there. |

## PR screenshots (from the spec's Testing Strategy)
Capture 360px and 1440px screenshots of: the header (with the sheet closed and with it open), `/wishlists/$id`, and one admin table page (for example `/admin/stores`).
