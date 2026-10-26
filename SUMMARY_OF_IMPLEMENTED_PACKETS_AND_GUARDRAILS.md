# Summary of Implemented Packets & Guardrails (RS-01 to RS-07)

**Date:** 2026-10-26  
**Repository:** `Hallucinated-Dungeons-A3` (`Builder`)  
**Git Commit:** `be3fc25` (`main`)  
**Firebase Deployment:** `hd-a3-staging` (`hd-a3-player` App Hosting + Firestore Rules & Indexes)  
**Verification Status:**
- **Typecheck (`npm run typecheck`):** PASSED (`0` errors)
- **Unit Test Suite (`npm run test:unit`):** PASSED (`511 / 511` tests passing across 6 suites, including `tests/unit/rules-spatial-table-remediation.test.mjs`)
- **Playwright E2E Remediation Gate (`tests/e2e/rules-spatial-table-remediation.spec.ts`):** PASSED (`1 / 1` passing)
- **Playwright E2E Active Regression & Feature Suite:** PASSED (`20 / 20` passing across scene loop, intent intercept, doorway crossing, post-deploy remediation, residual regressions, prop inventory, and layout specs)

---

## Architectural Guardrails Enforced
1. **Zero Hardcoded Playtest Nouns:** Strictly zero playtest-specific nouns from the staging playtest report were hardcoded anywhere in `src/` or `tests/`. Every fix operates on generalized grammatical, syntactic, rules-math, and state-machine logic.
2. **Guardrail 1 — Role-Titled NPC Dialogue & Lookup Continuity:** When an NPC is introduced in the premise with a personal role title (e.g., `"Warden <First> <Last>"` or `"Archivist <First> <Last>"`), NPC lookup and dialogue targeting (`director-gateway.ts`, `deterministic-intent-fallback.ts`, `scene-commands.ts`, `play-authority-contract.ts`, `director-mechanics-dispatcher.ts`) match all natural forms (`"Warden <First> <Last>"`, `"Warden <First>"`, `"<First> <Last>"`, and `"<First>"`) while never false-matching locations.
3. **Guardrail 2 — Level 1 Creation & Reload Self-Healing for Derived Stats:**
   - Monk Martial Arts weapon derivation (`max(STR, DEX)` attack/damage bonus and `1d6` minimum Martial Arts die for Unarmed Strikes and all Simple Melee / Light Martial Melee Monk weapons, including Spears) applies starting at **Level 1** in `deriveSheet` / `deriveAttacks` as well as in `recomputeSheetForLevel`.
   - In `applyProgressionTrackers` (`encounter-runtime.ts`), `recomputeSheetForLevel` always runs for the character's current level even when `tracker.level === sheet.level`, ensuring `speed`, `armorClass`, `attacks`, and weapon `statsSummary` stay 100% synchronized across saved sheets and table projections.

---

## Summary of Implemented Packets & Guardrails

### Packet 1 & Guardrail 1 — Syntactic Place vs. Person Classification, Setting Fidelity, & Role-Titled NPC Continuity (`RS-01`)
- **[`src/shared/campaign-facts.ts`](Builder/src/shared/campaign-facts.ts)**
  - Implemented `extractSyntacticPlaceNames` and `isPlaceOrStructureName` to classify proper nouns preceded by spatial/locative prepositions (`At`, `In`, `Inside`, `Within`, `Near`, `Beneath`, `Under`, `Beyond`, `Across`, `Around`, `From`, `Toward`, `To`, `Through`, `Atop`, `Beside`), followed by appositive place/structure descriptions (`", a/an/the [adjectives] <place/structure noun>"`), or ending in compound place suffixes (`-house`, `-hall`, `-keep`, `-tower`, `-spire`, `-hold`, `-haven`, `-watch`, `-gate`, `-bridge`, `-mill`, `-forge`, `-vault`, `-crypt`, `-abbey`, `-manor`, `-wharf`, `-dock`, `-pier`, `-port`, `-falls`, `-reach`, `-brook`, `-ford`, `-crest`, `-peak`, `-vale`, `-glen`, `-marsh`, `-mire`, `-fen`, `-wood`, `-grove`, `-hollow`, `-stead`, `-ton`, `-burg`, `-borough`, `-ville`, `-shire`, `-yard`, `-works`, `-foundry`, `-bastion`, `-citadel`, `-sanctum`, `-lodge`) strictly as **Places** (`namedPlaces`) and exclude them from `namedNpcs`.
  - Implemented `stripPersonalRoleTitle` and `npcNamesMatch` so role-titled NPCs (e.g., `"Warden <First> <Last>"`, `"Archivist <First> <Last>"`) match all natural forms (`"Warden <First> <Last>"`, `"Warden <First>"`, `"<First> <Last>"`, and `"<First>"`) across dialogue targeting, memory seed filtering, and item handoffs.
- **[`src/server/campaigns/campaign-blueprint.ts`](Builder/src/server/campaigns/campaign-blueprint.ts)**, **[`src/server/campaigns/campaign-memory.ts`](Builder/src/server/campaigns/campaign-memory.ts)**, & **[`src/client/pages/campaign-create.ts`](Builder/src/client/pages/campaign-create.ts)**
  - Preserved the primary proper place name from the premise as `setting` in regenerated outlines, `Location:` in committed facts, and Scene 1's title (`scene-m1-r1`) instead of falling back to generic biome labels.
  - Separated active starting contacts (`presentNpcs` — preceded by role titles or followed by interpersonal verbs) from disappeared/victim NPCs (`missingNpcs` — attached to disappearance predicates such as `vanished`, `disappeared`, `went missing`, `was taken`, `was abducted`) so missing persons are placed in the climax/later room rather than spawning in Room 1.

### Packet 2 — Immutable Container Identity, Unique Per-Room Prop Labels, & State-Aware Disambiguation (`RS-02`)
- **[`src/server/table/scene-composition.ts`](Builder/src/server/table/scene-composition.ts)** & **[`src/server/table/scene-commands.ts`](Builder/src/server/table/scene-commands.ts)**
  - Implemented `deduplicateSceneFeatureLabels` and matched `structuredProps` by `objectId === prop.propId` in `buildStoredSceneFromRoomBlueprint` so each scene feature has a single canonical `feature.label` across map projection, `open`, `inspect`, and `take`/`loot` receipts, and no two features in a scene share duplicate base labels.
  - Updated `scoreFeatureLabelMatch` and `rankInteractablesByDeclaration` to award `+50` for matching state qualifiers (`open`/`opened`/`unlocked`/`unsealed` vs. `closed`/`shut`/`locked`/`sealed`), penalize `-40` for opposite states, prefer already-open containers on `loot`/`take`, and preserve the player's actual verb + state/position qualifiers in tie-break clarification prompts.

### Packet 3 — Direct-Object vs. Locative-Preposition Clause Parsing & Accurate Travel Drafts (`RS-03` & `RS-04`)
- **[`src/shared/utterance-understanding.ts`](Builder/src/shared/utterance-understanding.ts)**, **[`src/shared/play-authority-contract.ts`](Builder/src/shared/play-authority-contract.ts)**, **[`src/shared/resolved-action-receipt.ts`](Builder/src/shared/resolved-action-receipt.ts)**, & **[`src/server/ai/deterministic-intent-fallback.ts`](Builder/src/server/ai/deterministic-intent-fallback.ts)**
  - Implemented `splitPrimaryTargetFromLocative` to separate a declaration's primary verb + direct-object target clause from secondary locative prepositional phrases (e.g., `"near the eastern doorway"`, `"beside the locked chest"`) while keeping trailing purpose phrases (`"for footprints"`, `"for traps"`) attached to `primaryClause`.
  - Implemented `isPassageOrTravelThroughDoorway` and updated `resolveTravelDestinationTitle` so forward passage declarations through a scene doorway/exit route to `table.travel_scene` and display the actual blueprint destination room title (`targetScene.title`) rather than echoing raw trailing words from the player's input.
  - Exempted mechanism/lever nouns (`lever`, `switch`, `mechanism`, `winch`, `crank`, `pulley`) from door-intent classification when modified by `gate` or `door` (e.g., `"Counterweight gate switch"`).

### Packet 4 & Guardrail 2 — Derived Monk Martial Arts Math, Level-Up Sheet Re-Computation, & Outdoor Ruin Topology (`RS-05` & `RS-06`)
- **[`src/server/rules/character-rules.ts`](Builder/src/server/rules/character-rules.ts)**, **[`src/server/rules/engine/xp-progression.ts`](Builder/src/server/rules/engine/xp-progression.ts)**, **[`src/server/rules/engine/encounter-runtime.ts`](Builder/src/server/rules/engine/encounter-runtime.ts)**, & **[`src/client/character-sheet-view.ts`](Builder/src/client/character-sheet-view.ts)**
  - Implemented `isMonkMartialArtsWeapon` and `monkMartialArtsDieSides` (`1d6` at Lv 1–4, `1d8` at Lv 5–10, `1d10` at Lv 11–16, `1d12` at Lv 17–20) starting at **Level 1** in `deriveSheet` / `deriveAttacks` and `recomputeSheetForLevel`, applying `max(STR, DEX)` attack/damage modifiers, minimum `1d6` Martial Arts die, and synchronized weapon `statsSummary` strings across the Attack Matrix and Equipment inventory.
  - Updated `applyProgressionTrackers` to always run `recomputeSheetForLevel` for the character's current level even when `tracker.level === sheet.level`, ensuring Unarmored Movement (`+10 ft` at Monk Lv 2–5 -> `40 ft`, `+15 ft` at Lv 6–9 -> `45 ft`, `+20 ft` at Lv 10–13 -> `50 ft`, `+25 ft` at Lv 14–17 -> `55 ft`, `+30 ft` at Lv 18–20 -> `60 ft`), `armorClass`, `attacks`, and `equipment` stay 100% synchronized.
  - Enforced gate-adjacent walkable (`terrain: 'floor'`, Manhattan distance `<= 2`) mechanism placement and outdoor-appropriate mechanism/room naming (`Overgrown Ruin Approach`, `Sunken Causeway`, `Counterweight gate switch`, `Weathered gate lever`) in `campaign-blueprint.ts`, `scene-commands.ts`, and `map-projection.ts`.

### Packet 5 — Non-Destructive "Ask the Director" Info Toggle (`RS-07`)
- **[`src/client/pages/campaign-table.ts`](Builder/src/client/pages/campaign-table.ts)** & **[`src/client/styles.css`](Builder/src/client/styles.css)**
  - Replaced the destructive close behavior on `[data-testid="ask-dm-info-btn"]` with an independent `askDmInfoVisible` toggle (`Show info` / `Hide info`, `aria-expanded`) that toggles `#ask-dm-info-copy` (`[data-testid="ask-dm-info-copy"]`) without switching tabs or closing the conversation dock.

---

## Verification Gate Outputs

### 1. `npm run typecheck`
```text
> hallucinated-dungeons-alpha3@0.0.0 typecheck
> tsc --project tsconfig.server.json --noEmit && tsc --project tsconfig.client.json --noEmit
```
*(Exited with code `0`, `0` errors)*

### 2. `npm run test:unit`
```text
> hallucinated-dungeons-alpha3@0.0.0 test:unit
> npm run build:server && node --test tests/unit/*.test.mjs

> hallucinated-dungeons-alpha3@0.0.0 build:server
> tsc --project tsconfig.server.json

✔ Packet 1 (RS-01): syntactic prepositions, appositives, and compound suffixes classify places and never leak into namedNpcs (1.9288ms)
✔ Packet 1 (RS-01): role-titled contacts stay in Room 1 while vanished/missing NPCs route to climax room (4.0609ms)
✔ Packet 1 (RS-01): outline generation and Scene 1 title preserve the named premise place over generic biome fallbacks (1.7611ms)
✔ Guardrail 1: npcNamesMatch resolves full role-titled, untitled, and first-name NPC references without false-matching places (0.6122ms)
✔ Packet 2 (RS-02): deduplicateSceneFeatureLabels enforces unique per-room labels and interact/loot preserve canonical container label (1.6088ms)
✔ Packet 2 (RS-02): scoreFeatureLabelMatch and rankInteractablesByDeclaration apply +50/-40 state bonuses for open vs closed containers (0.8351ms)
✔ Packet 3 (RS-03): splitPrimaryTargetFromLocative strips locative doorway phrases so primary clue target wins (0.9852ms)
✔ Packet 3 (RS-04): isPassageOrTravelThroughDoorway detects doorway exit travel and resolveTravelDestinationTitle returns the actual Room 2 title (1.1194ms)
✔ Packet 4 & Guardrail 2 (RS-05): Level 1 Monk Martial Arts upgrades Spear and Unarmed Strike to DEX and 1d6, and Level 2 recompute grants 40 ft speed (2.4119ms)
✔ Packet 4 (RS-06): outdoor investigation rooms use ruin/causeway titles and place gate-adjacent mechanism on a walkable cell within 2 squares of exit (4.6309ms)
...
ℹ tests 511
ℹ suites 6
ℹ pass 511
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3663.2583
```

### 3. `npx playwright test`
```text
Running 20 tests using 1 worker

  ok  1 [chromium] › tests\e2e\batch2-director-scene-loop.spec.ts:63:3 › Batch 2/3 Director scene loop › interior → object change → exterior → encounter (actor on map) → return (19.4s)
  ok  2 [chromium] › tests\e2e\batch2-director-scene-loop.spec.ts:143:3 › Batch 2/3 Director scene loop › open-ended landmark destination differs from prepared travel wording (12.5s)
  ok  3 [chromium] › tests\e2e\batch2-director-scene-loop.spec.ts:181:3 › Batch 2/3 Director scene loop › reusability: different premise yields different opening scene (5.1s)
  ok  4 [chromium] › tests\e2e\batch2-director-scene-loop.spec.ts:195:3 › Batch 2/3 Director scene loop › canal town + missing courier opening keeps location and quest hook (5.1s)
  ok  5 [chromium] › tests\e2e\declaration-first-intent.spec.ts:61:3 › Declaration-first Intent Intercept › NL attack draft confirms through the rules engine without Tools (6.6s)
  ok  6 [chromium] › tests\e2e\declaration-first-intent.spec.ts:89:3 › Declaration-first Intent Intercept › beginning encounter marks an open free-roam draft stale (7.0s)
  ok  7 [chromium] › tests\e2e\open-step-through-cross.spec.ts:86:3 › Open + step-through doorway cross › fresh closed door: single open+cross confirm moves token and narrates once (10.5s)
  ok  8 [chromium] › tests\e2e\open-step-through-cross.spec.ts:149:3 › Open + step-through doorway cross › far-side reverse through is a confirmable cross back (12.1s)
  ok  9 [chromium] › tests\e2e\open-step-through-cross.spec.ts:199:3 › Open + step-through doorway cross › enter room beyond while already past doorway clarifies once (10.5s)
  ok 10 [chromium] › tests\e2e\post-deploy-remediation.spec.ts:22:3 › Post-Deploy Systemic Remediation (Packets 1–5) › Premise live sync, PC exclusion from NPCs, intent translation, grounded improvisation, equipment mechanics, Chronicle auto-scroll, and single-scroll Rules Consult (14.5s)
  ok 11 [chromium] › tests\e2e\qa-residual-regressions.spec.ts:16:3 › PQA residual regressions › User UI Regressions: smooth identity typing across debounce, scroll-to-top on Continue, no duplicate headings, ordered campaign sections (4.3s)
  ok 12 [chromium] › tests\e2e\qa-residual-regressions.spec.ts:91:3 › PQA residual regressions › PQA-061: switching ability method uses an in-app confirm dialog (1.8s)
  ok 13 [chromium] › tests\e2e\qa-residual-regressions.spec.ts:120:3 › PQA residual regressions › PQA-012/013/014: chronicle, director, and rules copy stay player-facing (9.0s)
  ok 14 [chromium] › tests\e2e\qa-residual-regressions.spec.ts:178:3 › PQA residual regressions › Codex Retest [R26-01, F26-06, F26-01, R26-03, F26-02, R26-02]: 902x871 map/HUD layout, Rogue/Criminal overlap replacement, and table declarations (12.5s)
  ok 15 [chromium] › tests\e2e\recheck2-door-play-layout.spec.ts:46:3 › Recheck 2 door + play layout › 1081×898 keeps action composer in viewport (6.6s)
  ok 16 [chromium] › tests\e2e\recheck2-door-play-layout.spec.ts:221:3 › Recheck 2 door + play layout › close open doorway updates map; already-beside is explicit (12.2s)
  ok 17 [chromium] › tests\e2e\recheck2-door-play-layout.spec.ts:331:3 › Recheck 2 door + play layout › named premise entities and location art appear on opening scene (7.2s)
  ok 18 [chromium] › tests\e2e\rogue-expertise-kit-overlap.spec.ts:38:3 › Rogue Expertise and kit overlap › Features shows Expertise controls before mastery; tools do not stack to 2 (5.5s)
  ok 19 [chromium] › tests\e2e\rules-spatial-table-remediation.spec.ts:39:3 › Rules Audit, Spatial Topology, & Table UX Remediation (Packets 1–6) › Packet 1–5 end-to-end: Monk Unarmored Defense & Magic Initiate attribution, 2-step Portrait Lightbox, Campaign Create notice layout, banner-free map clicks, 2-step container looting, perimeter exit travel, and wall-lever mechanism lock (44.3s)
  ok 20 [chromium] › tests\e2e\take-scene-prop-inventory.spec.ts:59:3 › Take portable scene prop into inventory › Confirm take courier satchel stows gear and removes map prop (9.4s)

  20 passed (3.6m)
```
