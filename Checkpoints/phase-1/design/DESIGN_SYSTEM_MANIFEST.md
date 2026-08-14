---
recordType: design_system_manifest
manifestVersion: 1
identity: Obsidian Chronicle
blueprintSection: 8.17
status: LIVING
authoredAt: 2026-08-12T19:00:00Z
---

# Design System Manifest v1 — Obsidian Chronicle

Blueprint ownership: Section 8.17 requires one version-controlled Design System Manifest as an
early Phase 1 dependency, evolving under version control as surfaces are implemented and
QA-tested. This is the smallest coherent manifest the hosted shell needs, not a finished system.
**Every interface component, asset request, and screenshot baseline must identify `manifestVersion: 1`.**

This is a living document. When a later slice needs a token or pattern this version does not
define, it amends this file with the new entry and a reason, rather than inventing an
undocumented value inline.

## 1. Color

Section 8.17.1's initial suggested Obsidian Chronicle palette, adopted as-is for v1. No hue is
banned by the blueprint; the Product Owner may request a change through an ordinary design defect
at any time.

| Token | Hex | Use |
| --- | --- | --- |
| `--abyss-bg` | `#07080D` | Page and stage perimeter |
| `--obsidian-surface` | `#0D111B` | Primary panels and drawers |
| `--raised-surface` | `#182131` | Selected panels, cards, elevated controls |
| `--structural-border` | `#2C3A4F` | Panel and control boundaries |
| `--text-primary` | `#F4EEDF` | Headings and essential readable content |
| `--text-secondary` | `#BBC5D2` | Supporting labels and explanations |
| `--amber-action` | `#D89A3D` | Primary action and active-turn emphasis |
| `--amber-highlight` | `#F0B65F` | Hover, selected, focus-adjacent emphasis |
| `--moonlit-blue` | `#69A7D6` | Information, allied magic, spatial guidance |
| `--verdant-success` | `#4FB286` | Confirmed success and recovery |
| `--warning-gold` | `#E2A23A` | Caution, pending cost, attention |
| `--wound-red` | `#D65C5C` | Damage, destructive action, critical failure |
| `--arcane-violet` | `#A783D8` | Magical state that is not ally/enemy classification |
| `--focus-cyan` | `#8FD3FF` | Keyboard and assistive focus indication |

Color is never the only signal. Every state below pairs color with a label, icon, shape, or
placement change. Body text and essential labels target WCAG 2.2 AA at minimum; the product
target is 7:1 wherever the palette permits.

## 2. Typography

**Baseline contract (Section 8.17.1):** an inscription-influenced serif such as Cinzel for
campaign titles and restrained headings only; a highly legible sans-serif such as Atkinson
Hyperlegible for body copy, controls, sheets, logs, and help; a readable monospace family for
coordinates, roll formulae, event identifiers, and diagnostic information. No body text smaller
than 16px in core play at 100% zoom; dense secondary metadata may reach 14px only when nonessential.

**v1 interim substitution.** The licensed Cinzel and Atkinson Hyperlegible font files are not yet
bundled with a provenance record. Until they are, v1 uses accessible system font stacks that
already meet the size and contrast requirements above, per the Section 25.980 allowance for
original or properly licensed *interim* assets that meet current readability requirements without
being represented as final. This is tracked as `P1-TYPOGRAPHY-ASSETS` follow-up work, not silently
accepted as permanent.

| Role | v1 stack | Target family (pending bundling) |
| --- | --- | --- |
| `--font-heading` | `"Segoe UI", system-ui, sans-serif` | Cinzel (headings and titles only) |
| `--font-body` | `"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif` | Atkinson Hyperlegible |
| `--font-mono` | `ui-monospace, "Cascadia Code", "Consolas", monospace` | A readable monospace family |

Semantic heading structure (`h1`–`h3`) must always match visual hierarchy; heading style is never
the only indicator of level.

## 3. Spacing

Four-pixel base, approved increments only: 4, 8, 12, 16, 24, 32, 48, 64px. A component introducing
an arbitrary one-off gap is a manifest violation, not a screenshot fix.

| Token | Value |
| --- | --- |
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 48px |
| `--space-8` | 64px |

## 4. Elevation, borders, radius

| Token | Value | Use |
| --- | --- | --- |
| `--radius-control` | 8px | Buttons, inputs, small controls |
| `--radius-panel` | 10px | Panels, cards |
| `--border-weight` | 1px | Standard panel/control border, using `--structural-border` |
| `--elevation-raised` | `0 1px 0 rgba(0,0,0,0.4)` | Minimal separation for `--raised-surface` |

No glass or heavy translucency in v1. If a later slice wants one, it is added here with a stated
purpose and a fallback for reduced-effects mode.

## 5. Motion

Four categories per Section 8.17.1, distinguishing purpose rather than just duration:

| Category | Token | Duration | Purpose |
| --- | --- | --- | --- |
| Immediate acknowledgment | `--motion-immediate` | 100ms | Button press, focus ring |
| Ordinary transition | `--motion-ordinary` | 180ms | Panel reveal, route change |
| Emphasized resolution | `--motion-emphasized` | 280ms | A result the player should notice |
| Cinematic transition | `--motion-cinematic` | 480ms | The opening identity sequence only |

`prefers-reduced-motion: reduce` replaces every category above with an immediate state change —
no travel, shake, zoom, or parallax — while preserving event order and meaning. This is enforced
globally, not per component.

## 6. Component anatomy and states

State coverage as of v1. A dash means the state does not yet apply to any Phase 1 component;
it is not implemented as a no-op, it is simply absent until a component needs it.

| Component | default | hover | focus | active | selected | pending | disabled | invalid | loading | success | warning | destructive | disconnected | stale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Button (primary/secondary) | yes | yes | yes (`--focus-cyan` ring) | yes | — | yes (`aria-disabled`, never the `disabled` attribute, so focus survives) | — | — | — | — | — | — | — | — |
| Text input | yes | — | yes | — | — | — | — | yes (via message + `data-error-code`) | — | — | — | — | — | — |
| Panel/card | yes | — | — | — | — | — | — | — | — | — | — | — | — | — |
| Nav link | yes | yes | yes | — | yes (`aria-current="page"`) | — | — | — | — | — | — | — | — | — |
| Message banner | — | — | yes (`tabindex="-1"` target for focus fallback) | — | — | — | — | — | — | yes | — | yes (error) | — | — |
| Dock tab | yes | yes | yes | — | yes (`aria-selected`) | — | — | — | — | — | — | — | — | — |
| Dock composer (Party Chat) | yes | — | yes | — | yes (mode radio) | yes | — | — | — | — | — | — | — | — |
| Action Composer (structural) | yes | — | yes | — | — | — | yes (`aria-disabled`, Phase 1 unavailable) | — | — | — | — | — | — | — |

`disconnected` and `stale` are realtime-table concepts owned by Phases 2 and 4 and are recorded
here as not-yet-applicable, not as a missing requirement.

## 7. Adaptations

| Adaptation | v1 status |
| --- | --- |
| Desktop | Supported — primary target |
| Keyboard | Supported — full journey operable without a mouse, focus management on route change |
| Screen reader | Supported — landmarks, `aria-current`, single persistent live region, `role="alert"` on errors |
| Reduced motion | Supported — global `prefers-reduced-motion` handling plus account `hd-reduced-motion` preference |
| Tablet | Foundations only — fluid layout, no dedicated tablet interaction pass yet |
| High zoom | Foundations only — relative units, no dedicated 200%+ zoom test pass yet |
| Companion-mobile | Not yet implemented — Phase 1 does not require phone tactical control, but a companion text layout is not yet built |
| Low graphics | Not yet implemented — no decorative effects exist yet for it to reduce |
| High contrast | Not yet implemented |

## 8. Render Layer Registry (DOM)

Phase 1 has no WebGL surface; Phase 2 introduces the PixiJS tactical layer and extends this
registry rather than replacing it. The current DOM stacking order, low to high:

| Layer | Purpose | Approximate z-index |
| --- | --- | --- |
| `shell` | Header, nav, footer | 0 (normal flow) |
| `page-content` | The routed page inside `<main>` | 0 (normal flow) |
| `intro-overlay` | The opening identity sequence, shown only on `/` before dismissal | 10 |
| `live-region` | The single persistent status announcer | not visually stacked (visually hidden) |

Components reference these names; no component may invent an arbitrary z-index.

## 9. Patterns

| Pattern | v1 status |
| --- | --- |
| Form | Implemented — the diagnostics foundation-check form |
| Empty state | Implemented — `.empty-state` |
| Communication Dock | Implemented — peer tabs Chronicle / Party Chat / Rules Desk (`.communication-dock`) |
| Action Composer shell | Implemented — visually separate `.action-composer`; Phase 1 submit stays unavailable |
| Chart, dice, map-overlay, targeting-template | Not yet applicable — Phases 2/3 |
| Tooltip, modal, drawer, toast | Not yet implemented |
| Chronicle-card | Foundations only — server-authored Chronicle list entries in Phase 1; rich cards arrive with later narration |

## 10. Asset provenance

| Asset | Role | Dimensions | Provenance | Fallback |
| --- | --- | --- | --- | --- |
| Doorway motif (inline SVG, `src/client/pages/home.ts`) | Opening identity sequence visual motif | 96×96 viewBox | Original creation for this project, no external source | If SVG fails to render, the semantic title text is present independently and the sequence is skippable |

No other cinematic or decorative asset is added in v1. The Section 1.8.6 initial approved asset
package permits up to five items; v1 uses one, deliberately, and records this table rather than
accumulating unused variants.

## 11. Manifest consumption

Every client component under `src/client/` reads these tokens from
`src/client/styles.css`, which implements this manifest as CSS custom properties. A component must
not introduce a color, spacing, or motion value outside this table; if one is genuinely needed,
this file is amended first.
