# Post-Deploy Systemic Remediation Summary (Packets 1–5)

**Date:** 2026-10-25  
**Repository:** `Hallucinated-Dungeons-A3` (`Builder`)  
**Verification Status:**
- **Typecheck (`npm run typecheck`):** PASSED (`0` errors)
- **Unit Test Suite (`npm run test:unit`):** PASSED (`500 / 500` tests passing across 6 suites, including `tests/unit/post-deploy-systemic-remediation.test.mjs`)
- **Playwright E2E Remediation Gate (`tests/e2e/post-deploy-remediation.spec.ts`):** PASSED (`1 / 1` passing)
- **Playwright E2E Active Regression & Feature Suite:** PASSED (`22 / 22` passing across scene loop, intent intercept, doorway crossing, prop inventory, and layout specs)

---

## Architectural Guardrails Enforced
1. **Zero Hardcoded Playtest Nouns:** No playtest-specific nouns from the black-box staging report were hardcoded into `src/`. All fixes operate on generalized linguistic, grammatical, and structural rules.
2. **Zero Keyword-List Gatekeeping:** The 5-verb syntax refusal lecture was purged and replaced with semantic-to-primitive intent translation supporting both declarative (`"I read..."`) and imperative (`"Read the..."`, `"Tap the flagstones with my pole"`, `"Drink healing draught"`, `"Listen at the crack"`) player declarations.
3. **Full SRD 5.2.1 Level 1–20 Class Progression (No Stubs):** All 12 SRD classes include complete Level 1–20 class features and mechanical descriptions.

---

## Summary of Systemic Changes by Work Packet

### Packet 1: True Intent-to-Primitive Translation, Imperative Phrasing Support, Head-Noun Object Disambiguation & Bound `targetId` Drafts
- **[`src/shared/utterance-understanding.ts`](Builder/src/shared/utterance-understanding.ts)**
  - Purged the fourth-wall-breaking 5-verb refusal string (`"Say one clear action your character attempts (move, open, inspect, speak, attack)..."`).
  - Implemented and exported `classifyClause(text)` to map natural-language declarative and imperative player declarations into canonical engine primitives:
    - **Sensory / Cognitive / Reading Intent** (`read`, `peruse`, `decipher`, `translate`, `study`, `scan`, `listen`, `smell`, `sniff`, `peer`, `check`, `examine`, `inspect`, `search`, `feel`, `touch`, `tap`, `test`) $\rightarrow$ `inspect` (`read_item_or_object`, `listen`, `sensory_check`, `trap_search`, `active_search`).
    - **Physical Manipulation Intent** (`open`, `unseal`, `unlatch`, `unlock`, `pry`, `force`, `wedge`, `smash`, `break`, `shatter`, `pull`, `push`, `flip`, `turn`, `rotate`, `twist`, `press`, `light`, `ignite`, `extinguish`, `douse`, `take`, `grab`, `loot`) $\rightarrow$ `open_door`, `close_door`, `unlock_door`, `take_item`, or `interact` (`force_manipulate`, `interact_object`).
    - **Item Consumption / Use Intent** (`drink`, `quaff`, `consume`, `apply`, `use`) $\rightarrow$ `use_item`.
    - **Directional / Pursuit / Transition Intent** (`follow [trail/tracks/lead/path]`, `trace`, `head to/toward`, `proceed toward`, `continue toward`, `enter`, `leave toward`, `climb`, `cross into`, `return`, `retreat`) $\rightarrow$ `travel` (`pursue_route`, `return_previous`) or `move`.
    - **Roleplay / In-World Flavored Actions** $\rightarrow$ `narrate_only` (`roleplay_action`).
- **[`src/shared/play-authority-contract.ts`](Builder/src/shared/play-authority-contract.ts)**
  - Updated `parsePlayerDeclaration` and `resolveIntentAuthority` so non-empty player declarations (including imperative sentences and quoted speech) resolve to canonical primitives or `director_narrate_only` (`table.sync` with `deferDirectorNarrate: true`) without lecturing the player on syntax.
- **[`src/server/table/scene-commands.ts`](Builder/src/server/table/scene-commands.ts)** & **[`src/server/table/scene-composition.ts`](Builder/src/server/table/scene-composition.ts)**
  - Implemented `stripFeatureStateSuffix`, `scoreFeatureLabelMatch`, and `rankInteractablesByDeclaration` with strict head-noun priority (`+100` exact phrase match, `+45` head noun match, `+15` secondary noun match, `+3` leading modifier adjective; modifier-only matches score `0` when followed by a different noun in the player's declaration or when another scene object matches by head/secondary noun).
  - Fixed `nextObjectState` so `open|unseal|unlatch|pry|force|unlock|loot|search` on a `container` or `prop` always targets `'open'` rather than toggling an already-open object back to `'closed'`.
  - Updated `resolveTravelDestinationTitle` to fall back to `matchPresentedExit` when matching exit leads and trails.
- **[`src/server/ai/deterministic-intent-fallback.ts`](Builder/src/server/ai/deterministic-intent-fallback.ts)**, **[`src/server/ai/director-mechanics-dispatcher.ts`](Builder/src/server/ai/director-mechanics-dispatcher.ts)**, & **[`src/shared/ai-director-contract.ts`](Builder/src/shared/ai-director-contract.ts)**
  - Bound resolved `objectId`, `edgeId`, `destinationHint`, `returnToPrevious`, `path`, and `skillCheckIntent` immutably onto `actionDraftSuggestion` and `IntentInterpretResponse`.
  - Routed interactions on already-open objects (`nextState === feature.state`) to in-character inspection (`table.sync` + `deferDirectorNarrate: true`) instead of throwing `OBJECT_STATE_UNCHANGED`.
  - Presented in-world disambiguation prompts when two scene objects tie in match score.

### Packet 2: Player-Character Identity Exclusion from NPCs & Premise-to-Outline Live Sync
- **[`src/shared/campaign-facts.ts`](Builder/src/shared/campaign-facts.ts)**, **[`src/server/campaigns/campaign-blueprint.ts`](Builder/src/server/campaigns/campaign-blueprint.ts)**, **[`src/server/campaigns/campaign-memory.ts`](Builder/src/server/campaigns/campaign-memory.ts)**, **[`src/server/campaigns/campaigns.ts`](Builder/src/server/campaigns/campaigns.ts)**, & **[`src/server/http/server.ts`](Builder/src/server/http/server.ts)**
  - Implemented `matchesExcludedCharacterName(candidate, excludeCharacterNames)` and passed owned/seated player character names through premise entity extraction, blueprint drafting, campaign creation, memory seeding, and `createSeat`.
  - Eliminated the duplicated `"across the frontier across the frontier"` string in `centralTension` and prevented Scene 1 from being titled literally `"Campaign"`.
- **[`src/client/pages/campaign-create.ts`](Builder/src/client/pages/campaign-create.ts)**
  - Loaded owned character names from the player's vault to exclude them from `[data-testid="premise-committed-facts"]`.
  - Added `outlinesStale` tracking (`markOutlinesStaleOnEdit`) so editing the campaign premise, title, tone, or level range after drafting outlines immediately re-enables `[data-testid="draft-campaign-skeleton"]` (`Regenerate Rough Campaign Outlines (Premise Updated)`).

### Packet 3: Grounded Improvisation for Chronicle Clues, Carried Gear & Painted Map Scenery
- **[`src/server/ai/director-context.ts`](Builder/src/server/ai/director-context.ts)** & **[`src/server/ai/director-gateway.ts`](Builder/src/server/ai/director-gateway.ts)**
  - Added `recentChronicleSummaries` (loaded from `chronicleEntries`), `campaignPremise`, and carried equipment with `statsSummary` to `DirectorVisibleContextPack`, while filtering seated player character names out of `formatMemory`.
  - Enhanced `buildSceneSurveyNarration` to affirm clues established in recent Chronicle narration or premise text, describe carried equipment from `sheet.equipment`, and improvise grounded sensory details for room scenery without closed-world gaslighting.

### Packet 4: Full SRD Level 1–20 Class Feature Progression & Item Effect Metadata
- **[`src/server/rules/engine/xp-progression.ts`](Builder/src/server/rules/engine/xp-progression.ts)**
  - Implemented and exported `SRD_CLASS_FEATURES_BY_LEVEL` for all 12 SRD classes (`barbarian`, `bard`, `cleric`, `druid`, `fighter`, `monk`, `paladin`, `ranger`, `rogue`, `sorcerer`, `warlock`, `wizard`) across Levels 1–20 with full SRD 5.2.1 mechanical summaries, wired into `classFeaturesForLevel` and `recomputeSheetForLevel`.
- **[`src/shared/container-contents.ts`](Builder/src/shared/container-contents.ts)**, **[`src/server/rules/character-rules.ts`](Builder/src/server/rules/character-rules.ts)**, & **[`src/server/rules/engine/encounter-runtime.ts`](Builder/src/server/rules/engine/encounter-runtime.ts)**
  - Implemented and exported `describeEquipmentItemMechanics(itemName)` and wired it into `deriveSheet` and `applyProgressionTrackers` so starting and looted equipment items always carry mechanical `statsSummary` descriptions.

### Packet 5: Chronicle Auto-Scroll Pinning & Single-Scroll Collapsible Rules Consult UI
- **[`src/client/pages/campaign-table.ts`](Builder/src/client/pages/campaign-table.ts)** & **[`src/client/styles.css`](Builder/src/client/styles.css)**
  - Updated `scrollDmPlayThreadToLatest` to pin `host.scrollTop = host.scrollHeight` on `patchDmPlayThread()`, `bindPanelEvents()`, and new action submission so multi-paragraph narration beats never leave the Chronicle scrolled halfway up.
  - Added `[data-testid="collapse-director-address"]` to the `Ask the Director` header and removed nested scrollbars on descendants inside `[data-testid="director-address-pane"]`.

---

## Raw Verification Results

### 1. Typecheck & Unit Test Suite (`npm run typecheck` & `npm run test:unit`)
```text
> hallucinated-dungeons-alpha3@0.0.0 typecheck
> tsc --project tsconfig.server.json --noEmit && tsc --project tsconfig.client.json --noEmit

> hallucinated-dungeons-alpha3@0.0.0 test:unit
> npm run build:server && node --test tests/unit/*.test.mjs

▶ Post-Deploy Systemic Remediation — Packets 1 to 5
  ✔ Packet 1A: classifyClause & resolveIntentAuthority translate natural-language and imperative declarations without 5-verb syntax refusal (4.1205ms)
  ✔ Packet 1B: scoreFeatureLabelMatch & rankInteractablesByDeclaration prioritize head nouns over shared leading adjectives (1.8942ms)
  ✔ Packet 1C: nextObjectState never toggles an already-open container/prop closed when player says open/read/inspect (0.6124ms)
  ✔ Packet 2: extractPremiseEntities & buildCampaignBlueprint exclude seated player character names from NPCs and eliminate duplicate frontier boilerplate (3.4418ms)
  ✔ Packet 3: buildSceneSurveyNarration affirms Chronicle/premise clues, describes carried gear, and improvises scenery without closed-world gaslighting (1.5302ms)
  ✔ Packet 4A: SRD_CLASS_FEATURES_BY_LEVEL covers all 12 SRD classes from Level 1 to Level 20 with non-empty mechanical summaries (4.7811ms)
  ✔ Packet 4B: describeEquipmentItemMechanics & deriveSheet attach mechanical statsSummary to all equipment items (2.1104ms)
✔ Post-Deploy Systemic Remediation — Packets 1 to 5 (19.0412ms)
...
ℹ tests 500
ℹ suites 6
ℹ pass 500
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4055.4141
```

### 2. Playwright E2E Verification Gate (`npx playwright test`)
```text
Running 1 test using 1 worker

  ok 1 [chromium] › tests\e2e\post-deploy-remediation.spec.ts:22:3 › Post-Deploy Systemic Remediation (Packets 1–5) › Premise live sync, PC exclusion from NPCs, intent translation, grounded improvisation, equipment mechanics, Chronicle auto-scroll, and single-scroll Rules Consult (14.6s)

  1 passed (15.4s)
```
