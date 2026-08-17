---
recordType: asset_provenance
phase: phase-5
manifestVersion: 1
extendsManifest: Checkpoints/phase-1/design/DESIGN_SYSTEM_MANIFEST.md#10
status: LIVING
authoredAt: 2026-08-16T20:20:00Z
---

# Phase 5 asset provenance

Blueprint ownership: Section 25 Phase 5 build scope item 4 ("Asset provenance, performance
budgets, reduced-effects / static fallbacks, cross-screen coherence") and the invariant kernel
("Asset provenance is recorded; gray boxes and unfinished placeholders cannot pass as production
art."). This file extends `Checkpoints/phase-1/design/DESIGN_SYSTEM_MANIFEST.md` §10 with the
assets introduced in Phase 5, rather than duplicating or replacing that table.

## 1. Director avatars (12)

All 12 files are original inline-SVG illustrations authored for this project (no stock art, no
external icon set, no AI image generation) via a small deterministic build script
(`/tmp/gen-avatars.mjs`, not checked in — the emitted SVGs under
`Builder/src/client/assets/directors/` are the actual product asset). Each file is named
`{identity}__{personality}.svg`, matching `directorAvatarKey()` in
`Builder/src/shared/campaign-contract.ts` exactly, so the client asset lookup in
`Builder/src/client/director-avatars.ts` never has to guess a filename.

| Asset | Role | Dimensions | Provenance | Fallback |
| --- | --- | --- | --- | --- |
| `veyra__seasoned_host.svg` | Director avatar (Veyra × Seasoned Host) | 128×128 viewBox | Original creation for this project | Accessible text label `"Veyra — Seasoned Host"` |
| `veyra__friendly_adventurer.svg` | Director avatar (Veyra × Friendly Adventurer) | 128×128 viewBox | Original creation for this project | Accessible text label `"Veyra — Friendly Adventurer"` |
| `veyra__encouraging_guide.svg` | Director avatar (Veyra × Encouraging Guide) | 128×128 viewBox | Original creation for this project | Accessible text label `"Veyra — Encouraging Guide"` |
| `veyra__sassy_companion.svg` | Director avatar (Veyra × Sassy Companion) | 128×128 viewBox | Original creation for this project | Accessible text label `"Veyra — Sassy Companion"` |
| `veyra__dry_storyteller.svg` | Director avatar (Veyra × Dry Storyteller) | 128×128 viewBox | Original creation for this project | Accessible text label `"Veyra — Dry Storyteller"` |
| `veyra__dramatic_chronicler.svg` | Director avatar (Veyra × Dramatic Chronicler) | 128×128 viewBox | Original creation for this project | Accessible text label `"Veyra — Dramatic Chronicler"` |
| `garrick__seasoned_host.svg` | Director avatar (Garrick × Seasoned Host) | 128×128 viewBox | Original creation for this project | Accessible text label `"Garrick — Seasoned Host"` |
| `garrick__friendly_adventurer.svg` | Director avatar (Garrick × Friendly Adventurer) | 128×128 viewBox | Original creation for this project | Accessible text label `"Garrick — Friendly Adventurer"` |
| `garrick__encouraging_guide.svg` | Director avatar (Garrick × Encouraging Guide) | 128×128 viewBox | Original creation for this project | Accessible text label `"Garrick — Encouraging Guide"` |
| `garrick__sassy_companion.svg` | Director avatar (Garrick × Sassy Companion) | 128×128 viewBox | Original creation for this project | Accessible text label `"Garrick — Sassy Companion"` |
| `garrick__dry_storyteller.svg` | Director avatar (Garrick × Dry Storyteller) | 128×128 viewBox | Original creation for this project | Accessible text label `"Garrick — Dry Storyteller"` |
| `garrick__dramatic_chronicler.svg` | Director avatar (Garrick × Dramatic Chronicler) | 128×128 viewBox | Original creation for this project | Accessible text label `"Garrick — Dramatic Chronicler"` |

### Identity vs. personality differentiation

- **Identity (silhouette/color, stays fixed across all six personalities of that identity):**
  Veyra has dark hair swept into a low bun, a warm bronze skin tone, amber-gold irises, and a
  deep forest-green coat. Garrick has close-cropped grey hair, a full jaw beard rendered as a
  stroke along the jawline, a lighter warm skin tone, slate-blue irises, and a maroon coat. The
  two silhouettes are distinguishable at a glance even with the SVG desaturated.
- **Personality (expression/background, varies per identity):** each personality sets its own
  background tone, eyebrow angle/lift, and mouth path — e.g. Seasoned Host is a level, neutral
  mouth on a muted slate background; Friendly Adventurer is a wide open smile on a warm amber
  background; Dry Storyteller is a flat closed-line mouth on a desaturated grey background;
  Dramatic Chronicler is a raised-brow, open-mouth expression on a deep violet background. No two
  of the twelve files share the same background color or mouth path.

### Fallback behavior

`Builder/src/client/director-avatars.ts#directorAvatarMarkup` renders an `<img>` referencing the
Vite-bundled asset URL when a mapping exists for the campaign's `directorAvatarKey()`, and a plain
accessible `<span>` with the identity/personality text label when it does not (this build defines
all 12 combinations, so the missing-mapping branch only fires for a future identity/personality
that has not shipped art yet). `bindDirectorAvatarFallback` additionally wires a runtime `error`
listener on the rendered `<img>`, so if the bundled asset itself fails to load in the browser (for
example a build that did not copy static assets), the same text fallback replaces it in place —
the UI never substitutes a different image or invents a placeholder graphic.

Shown on: campaign creation preview (`campaign-create.ts`, `data-testid="preview-director-avatar"`)
and campaign detail (`campaign-detail.ts`, `data-testid="director-avatar"`).

## 2. Starter map presentation — "Emberferry Crossing"

| Asset | Role | Provenance | Fallback |
| --- | --- | --- | --- |
| Starter map scenes (Mist Dock / Mist-Cut Caves / Drowned Bell Tower) authored in `Builder/src/shared/content/emberferry-maps.ts` | Chapter-linked tactical geometry + presentation text for Emberferry Crossing | Original creation for this project — authored procedural terrain (floor / difficult / blocked), edges, spawn anchors, and notable-feature labels. Not painted tile art or town illustrations | Blank campaigns keep the Phase 2 `procedural_local_placeholder` chamber; Emberferry scenes never claim hand-painted production tiles |

The Mist Dock / Caves / Bell Tower layouts are distinct authored grids so the table visibly changes when a chapter is closed and travel advances. Token moves animate on the stage. Provenance remains `original_phase5_starter_v1` for that authored procedural presentation layer — it does not claim illustrated tile art.

## 3. Presentation Cue Plan audio

No audio *files* are introduced. `Builder/src/client/pages/campaign-table.ts` synthesizes short
sine-tone bursts at runtime via the Web Audio API (`OscillatorNode` + `GainNode` envelope,
capped at `MAX_CUE_SOUND_DURATION_MS` from `Builder/src/shared/presentation-cue-contract.ts`) —
there is no licensed or found sound asset to attribute, and no non-musical "sound design" beyond
these procedural tones ships in this phase. Playback is skipped entirely when `reducedMotion` or
`lowEffects` is on, or while text-to-speech is actively speaking, per the same contract's
accessibility gate.
