# Mobile Responsiveness (Issue #2)

## Overview
The Scout frontend (`frontend/`, Vite + React + TanStack Router + Tailwind v4 + shadcn/ui) is usable on desktop but breaks on phone-sized viewports: the top header and the admin sidebar do not collapse, which forces horizontal page scrolling and squeezes content. This spec makes every route usable from 360px wide upward by fixing the shared shells first (app header, admin layout) and then a short list of per-component fixed widths and non-responsive grids, using Tailwind's existing responsive utilities.

## Metadata
- **Feature Name**: Mobile responsiveness
- **Status**: Approved
- **Priority**: P1 - High
- **Owner**: TBD
- **Epic/Initiative**: GitHub issue #2 (GeofreyMuindeMunguti/shopai)
- **Created**: 2026-11-11
- **Last Updated**: 2026-11-11

## Problem Statement

### User Problem
On a phone the site is not mobile responsive (issue #2). Users get horizontal scrolling, clipped navigation and cramped forms.

### Current State (findings from the codebase)
- `frontend/index.html` **already has** `<meta name="viewport" content="width=device-width, initial-scale=1.0">` — not a cause.
- Much of the page content already uses breakpoints (`sm:grid-cols-2 lg:grid-cols-3` on the wishlist grid and candidate grid, `flex-wrap` on most toolbars, `Table` wraps in `overflow-auto`, `login` uses `w-full max-w-sm`). The breakage is concentrated in a few places:
  1. **App header** — `frontend/src/routes/_app.tsx` `Header`: one non-wrapping flex row with logo + three labelled `NavItem`s ("My Wishlists", "Settings", "Admin") + `NotificationsBell` + avatar menu. The total width is about 480px or more, so it overflows at 360–414px. There is no mobile menu.
  2. **Admin sidebar** — `frontend/src/components/app/AdminLayout.tsx` puts `Sidebar` (fixed `w-60 shrink-0`, from `frontend/src/components/ui/sidebar.tsx`, which the source comments describe as having "no mobile sheet variant") side by side with the content at every width. At 360px only about 120px is left for admin pages and tables.
  3. **Fixed 2-column form grids**: `ItemFormDialog.tsx` (three `grid grid-cols-2` blocks plus a `col-span-2` hint, and the retailer `grid-cols-2 pl-6`), and `routes/_app/admin/models.tsx:274` `grid grid-cols-2`.
  4. **Fixed-width controls**: `routes/_app/admin/stores.tsx` filter controls `w-40`, `w-44`, `w-72`. `AdminDataTable.tsx` search `max-w-xs` is fine, but it should be full width on mobile. `NotificationsBell.tsx` popover `w-80` (320px) leaves almost no margin at 360px.
  5. **Non-wrapping action rows**: `routes/_app/wishlists/$wishlistId.tsx:134` (`flex gap-2` holding "Edit wishlist" and "Add item") and `OnboardingStepper.tsx` footer button group (`flex gap-2`).
  6. **Desktop-sized page padding**: `p-6` on `routes/_app/index.tsx`, `routes/_app/wishlists/$wishlistId.tsx`, `routes/_app/settings.tsx` and the `AdminLayout` content pane wastes space on small screens.
  7. `Dialog`/`AlertDialog` content (`components/ui/dialog.tsx`, `alert-dialog.tsx`) is `w-full max-w-lg` with no side gutter, so on phones it sits flush against the screen edges.

### Desired State
Every route renders without horizontal page scroll from 360px wide, and the primary nav and admin nav stay reachable through a collapsed menu on small screens. Desktop (≥1024px) looks the same as it does today.

## Goals and Non-Goals

### Target breakpoints (Tailwind defaults, no custom breakpoints)
| Name | Width checked | Tailwind |
|------|---------------|----------|
| Small phone | 360px | base (< `sm`) |
| Large phone | 414px | base |
| Tablet | 768px | `md` |
| Desktop | 1024px, 1440px | `lg`+ |

### Goals
- No horizontal page-level scroll at any target width on any route.
- Primary nav collapses to a menu button below `md`. Admin nav collapses below `md`.
- Forms and dialogs stack to a single column below `sm`.
- Touch targets in the collapsed navs are at least 40px tall.
- Desktop layout (≥ `lg`) is visually unchanged.

### Non-Goals
- Native/PWA app, offline support, gestures.
- Visual redesign, new design tokens or a theme change.
- Card/stacked rendering of admin data tables on mobile. Tables keep horizontal scrolling *inside* their bordered container (already provided by `components/ui/table.tsx`).
- Responsive props in the JSON UI engine (`components/engine/layout/Grid.tsx` builds `grid-cols-${n}` dynamically, and the shipped JSON pages don't use it). Tracked as a follow-up only.
- Automated visual regression tooling.

## Acceptance Criteria
- [ ] At 360px, 414px, 768px and 1024px, `document.documentElement.scrollWidth <= window.innerWidth` on: `/login`, `/onboarding` (each step), `/` (with and without wishlists), `/wishlists/$wishlistId` (with an expanded item that has candidates), `/settings`, and every `/admin/*` route (`models`, `tasks`, `retailers`, `stores`, `settings`, `usage`, `jobs`, `audit`).
- [ ] Below `md` (< 768px) the header shows logo, a menu button (`aria-label="Open menu"`, `aria-expanded` reflects state), the notifications bell and the avatar menu. The inline `nav` is hidden. The menu button opens a left `Sheet` holding the same nav items (the Admin item only when `isAdmin`), the active item is marked with `aria-current="page"`, and picking an item navigates and closes the sheet.
- [ ] At `md` and above the header looks the same as today and the menu button is not rendered/visible.
- [ ] Below `md` the admin `Sidebar` is not shown side by side with the content. Admin navigation is still available on the page (see Technical Design §2), the current page is indicated, and admin content uses the full viewport width minus page padding.
- [ ] Admin data tables at 360px scroll horizontally inside their bordered container. The page itself does not scroll horizontally.
- [ ] `ItemFormDialog` and the admin model form show one column below `sm` and two columns at `sm`+.
- [ ] Wishlist detail header actions and onboarding footer actions wrap rather than overflow at 360px.
- [ ] Notifications popover fits inside the viewport with at least 16px total side margin at 360px.
- [ ] Dialogs and alert dialogs keep a visible gutter (≥ 16px total) at 360px, and long content scrolls inside the dialog.
- [ ] Main page containers use `p-4` below `sm` and `p-6` at `sm`+.
- [ ] Keyboard and screen reader: mobile nav sheet traps focus, closes on Esc, and returns focus to the menu button (Radix Dialog default behavior). The skip link still works.
- [ ] `npm run typecheck`, `npm run lint`, `npm run build` pass in `frontend/`.

## Technical Design

Approach: use Tailwind responsive prefixes (`sm:`/`md:`/`lg:`) and existing shadcn primitives (`Sheet` in `components/ui/sheet.tsx`, `Button`). Fix the shared shells first, then the listed components. Do not add new dependencies or custom breakpoints, and do not add JS media-query hooks unless they are required.

### 1. App header — `frontend/src/routes/_app.tsx`
- Wrap the existing inline `<nav aria-label="Main">` in `hidden md:flex`.
- Add a `md:hidden` icon `Button` (lucide `Menu`) before the logo that controls a `Sheet` (`side="left"`). Inside it, render a vertical `<nav aria-label="Main">` that reuses the existing nav item list. Extract the item list (`/`, `/settings`, `/admin` if `isAdmin`) into a single array so the two navs cannot drift apart. Close the sheet on navigation (controlled `open` state, reset on `pathname` change or in the item `onClick`).
- Tighten the header gap below `sm` (`gap-2 sm:gap-4`). Keep `h-16` (the admin layout's `min-h-[calc(100vh-4rem)]` depends on it).

### 2. Admin layout — `frontend/src/components/app/AdminLayout.tsx` (+ `components/ui/sidebar.tsx` only if needed)
- Change the outer wrapper to `flex flex-col md:flex-row`. Give `Sidebar` `hidden md:flex`.
- Below `md`, render a compact admin nav above the breadcrumb that reuses `ADMIN_NAV`. **Proposed default:** a horizontally scrollable row of pill links (`flex gap-1 overflow-x-auto` with `aria-label="Admin"`, active item styled with `sidebarMenuButtonClass(true)`, `whitespace-nowrap`). Alternative: an "Admin menu" button that opens a `Sheet`. See Open Questions.
- Content pane: `p-4 sm:p-6`, keep `min-w-0`.

### 3. Component-level fixes
| File | Change |
|------|--------|
| `frontend/src/components/app/ItemFormDialog.tsx` | `grid grid-cols-2` becomes `grid grid-cols-1 sm:grid-cols-2` (3 blocks), `col-span-2` becomes `sm:col-span-2`, retailer list `grid-cols-2` becomes `grid-cols-1 sm:grid-cols-2`. |
| `frontend/src/routes/_app/admin/models.tsx` (~L274) | `grid-cols-2` becomes `grid-cols-1 sm:grid-cols-2`. |
| `frontend/src/routes/_app/admin/stores.tsx` | Filter controls `w-40`/`w-44`/`w-72` become `w-full sm:w-40` and so on. Filter wrappers stay `flex-wrap`, and each field wrapper becomes full width on mobile. |
| `frontend/src/components/app/AdminDataTable.tsx` | Search `max-w-xs` becomes `w-full sm:max-w-xs`. |
| `frontend/src/components/app/NotificationsBell.tsx` | Popover `w-80` becomes `w-[calc(100vw-2rem)] max-w-80` (or `w-[min(20rem,calc(100vw-2rem))]`). |
| `frontend/src/routes/_app/wishlists/$wishlistId.tsx` | Action group `flex gap-2` becomes `flex flex-wrap gap-2`. Container `p-6` becomes `p-4 sm:p-6`. |
| `frontend/src/components/app/OnboardingStepper.tsx` | Footer button group gets `flex-wrap`, and `CardFooter` gets `flex-wrap`. |
| `frontend/src/routes/_app/index.tsx`, `frontend/src/routes/_app/settings.tsx` | Container `p-6` becomes `p-4 sm:p-6`. Check the settings notification list rows (`flex justify-between gap-4`) at 360px and add `min-w-0`/wrap if they overflow. |
| `frontend/src/components/ui/dialog.tsx`, `frontend/src/components/ui/alert-dialog.tsx` | Add `max-w-[calc(100%-2rem)] sm:max-w-lg` and `max-h-[calc(100dvh-2rem)] overflow-y-auto` to the content classes. Callers that pass `max-w-lg` (e.g. `PriceHistoryDialog`) should still work, and `cn`/tailwind-merge resolves the conflict, so check that the caller's override keeps the mobile gutter (use `sm:max-w-lg` at call sites if needed). |
| `frontend/src/routes/_app/admin/retailers.tsx` | Check the `grid-cols-[6rem_1fr_auto]` and `grid-cols-[6rem_8rem]` rows at 360px after the sidebar change. Adjust only if they overflow. |

Files expected **not** to need changes (already responsive): `routes/login.tsx`, `components/app/CandidateCard.tsx`, `components/app/ItemPanel.tsx` (uses `flex-wrap` and `grid-cols-1 sm:… lg:…`), `components/ui/table.tsx`, `components/ui/sheet.tsx` (`w-3/4 sm:max-w-sm`), `frontend/index.html`.

### Constraints
- Shadcn primitives in `components/ui/` are local copies, so editing them is allowed. Keep edits minimal and mark them with a short comment, following the existing "Local edit" convention in `sidebar.tsx`.
- Do not change routing, data fetching or the JSON engine.

## Testing Strategy
- The frontend has no unit or e2e runner. Verify in `frontend/` with `npm run typecheck`, `npm run lint` and `npm run build`.
- Manual or scripted viewport checks: run the stack (`make up` or `npm run dev`) and use browser devtools device mode or a headless browser at **360×740, 414×896, 768×1024, 1024×768, 1440×900**. On every route listed in the Acceptance Criteria:
  - assert `document.documentElement.scrollWidth <= window.innerWidth`,
  - open/close the mobile nav sheet (header) and use the admin nav below `md`,
  - open `ItemFormDialog`, `WishlistFormDialog`, `PriceHistoryDialog`, `RejectReasonDialog` and the notifications popover, and confirm they fit,
  - check desktop (1440) against current `main` for visual parity of the header and admin layout.
- Accessibility spot check: keyboard-only through the mobile menu (open, Tab cycles inside, Esc closes and focus returns).
- Screenshots of 360px and 1440px for the header, wishlist detail and one admin table page go in the PR (UI change).

## Open Questions
All resolved at approval (2026-11-11) — see Decision Log.

## Decision Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-11 | Admin nav below `md` is a horizontally scrollable pill row (no Sheet) | Chosen by approver |
| 2026-11-11 | Header and admin sidebar both collapse below `md` (768px) | Spec default accepted |
| 2026-11-11 | Admin on phones: no page-level overflow, nav reachable, tables scroll inside their container | Spec default accepted |
| 2026-11-11 | 360px is the minimum supported width | Spec default accepted |
| 2026-11-11 | Settings / Sign out stay in the avatar dropdown only | Spec default accepted |
| 2026-11-11 | All routes in scope; no specific pages prioritised | Spec default accepted |

## References
- GitHub issue #2: https://github.com/GeofreyMuindeMunguti/shopai/issues/2
- Related spec: `docs/specs/ai-shopping-wishlist.md`
