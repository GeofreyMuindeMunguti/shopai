# ADR-0010: shadcn/ui is the UI component system, layered under the JSON UI engine

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Product owner; drafted by Claude Code
- **Supersedes / Superseded by:** —

## Context
The frontend is Vite + React 18 + TanStack Router/Query, with Tailwind CSS v4 and a JSON-driven UI engine. Screens are JSON definitions resolved through a component registry (`frontend/src/registry/`). The product needs consistent, accessible UI (WCAG 2.1 AA per spec) across:
- shopper screens: wishlist, candidate cards, retailer filters, model selector, onboarding wizard
- an admin portal: model, retailer, Shopify-store, and task-model management, plus usage

The repo already contains shadcn/ui scaffolding: `frontend/components.json`, 19 generated primitives in `frontend/src/components/ui/`, Radix packages, `class-variance-authority`, `tailwind-merge`, and the `cn()` helper.

## Decision
We use **shadcn/ui** (Radix primitives + Tailwind, code copied into the repo rather than installed as a dependency) as the only component system. There are three layers, and each layer may only depend on the layers below it:

1. **Primitives**: `src/components/ui/*`. These are generated with the shadcn CLI (`npx shadcn@latest add <name>`) and then owned by us. Local edits are allowed but kept minimal, and each one is noted in a header comment so later CLI updates can be merged deliberately.
2. **Domain components**: `src/components/app/*`. Product-specific pieces built from primitives:

   | Component | Built from |
   |---|---|
   | `CandidateCard` | `Card`, `Badge`, `Button`, `Collapsible` |
   | `RetailerFilterChips` | `ToggleGroup` |
   | `RetailerProgress` | Per-retailer status chips |
   | `ModelSelector` | `Select`/`Command`, grouped "Platform models" / "My models" |
   | `PriceWithConversion` | Price + "≈" conversion + `Tooltip` attribution |
   | `OnboardingStepper` | Wizard steps |
   | `AdminDataTable` | `Table` + TanStack Table |

3. **Engine components**: `src/components/engine/*`. Thin wrappers that adapt primitives or domain components to `EngineComponentProps` and actions, registered by type name in `src/registry/index.ts` so JSON screens can use them.

**Rules:**
- JSON screens never reference raw HTML or one-off styled markup. If a screen needs something new, add a primitive, a domain component, or an engine wrapper.
- Styling uses only the theme tokens in `src/styles/globals.css` (Tailwind v4 `@theme`) and `cn()`. No hard-coded colours.
- Icons come from `lucide-react` (`iconLibrary: lucide`).
- Toasts use shadcn's `sonner`. Forms keep using the UI engine's own form handling, so we don't add shadcn's `Form` / react-hook-form unless the engine adopts it.

**Primitives to add for this spec:**

| Area | Primitives |
|---|---|
| Choosing options | `radio-group`, `toggle-group`, `command`, `dropdown-menu` |
| Layout and navigation | `collapsible`, `scroll-area`, `sidebar` (admin portal), `breadcrumb` |
| Feedback and paging | `sonner`, `pagination` |
| Form controls | `switch` (enable/disable flags) |

## Consequences
- Radix gives accessible behaviour out of the box (focus management, keyboard support, ARIA), which supports the WCAG 2.1 AA requirement.
- The code is ours: there's no package version to upgrade, but the CLI doesn't update existing files automatically either. Re-running `shadcn add` over a changed file needs a manual diff.
- One theme lives in one place (`globals.css`). Dark mode can be added by defining a `.dark` token set, without touching components.
- The engine registry grows with each domain component. Keep wrappers thin and logic-free; domain logic goes into hooks in `src/hooks/` or `src/data/`.
- **Compatibility checks before adding primitives**:
  - The current shadcn CLI targets Tailwind v4 and React 19. We're on React 18, which works, but generated components may need small `forwardRef` adjustments.
  - The CLI may reject or deprecate the existing `components.json` `"style": "default"`. If it does, migrate to the CLI's recommended style in one PR that regenerates the primitives together.

## Alternatives considered
- **MUI / Chakra / Mantine**: full libraries with their own theming systems that would clash with Tailwind. The dependency weight is heavier, and styles are harder to keep consistent with the engine's token approach.
- **Headless only (Radix/Ark) with fully custom styling**: maximum control, but we'd rebuild what shadcn already provides.
- **Tailwind UI / ad-hoc components**: no consistent primitive layer for the engine to wrap.

## Evidence
- `frontend/components.json`, `frontend/src/components/ui/` (existing primitives)
- `frontend/src/components/engine/` (wrappers, e.g. `forms/EngineCheckbox.tsx` uses `@/components/ui/checkbox`)
- `frontend/src/registry/index.ts` (engine type registry)
- `frontend/src/styles/globals.css` (Tailwind v4 `@theme` tokens), `frontend/src/lib/utils.ts` (`cn`)
- Spec: `docs/specs/ai-shopping-wishlist.md` → User Experience, Implementation Plan
