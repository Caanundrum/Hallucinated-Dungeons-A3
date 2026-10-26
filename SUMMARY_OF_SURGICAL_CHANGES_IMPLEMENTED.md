# Summary of Surgical Changes Implemented (RV-01 to RV-03)

**Date:** 2026-10-26  
**Repository:** `Hallucinated-Dungeons-A3` (`Builder`)  
**Verification Status:**
- **Typecheck (`npm run typecheck`):** PASSED (`0` errors)
- **Unit Test Suite (`npm run test:unit`):** PASSED (`512 / 512` tests passing across 6 suites, including `RV-01`–`RV-03` in [`tests/unit/rules-spatial-table-remediation.test.mjs`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/tests/unit/rules-spatial-table-remediation.test.mjs))
- **Playwright E2E Remediation Gate ([`tests/e2e/rules-spatial-table-remediation.spec.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/tests/e2e/rules-spatial-table-remediation.spec.ts)):** PASSED (`1 / 1` passing, including expanded `RV-01`–`RV-03` assertions)
- **Playwright E2E Active Regression & Feature Suite:** PASSED (`20 / 20` passing across scene loop, intent intercept, doorway crossing, post-deploy remediation, residual regressions, prop inventory, and layout specs)

---

## Architectural Guardrails Enforced
1. **Zero Regressions Across Resolved Systems (`RS-01`, `RS-03`–`RS-07`):** All 512 unit tests and all 20 active Playwright E2E regression tests pass without regression.
2. **Zero Hardcoded Playtest Nouns:** Strictly zero playtest-specific nouns from any staging playtest report were hardcoded anywhere in `src/` or `tests/`. Every fix operates on generalized grammatical, syntactic, and state-machine rules.
3. **Packet 2 Narration Trigger (`director-gateway.ts` & `commands.ts`):** Whenever a player declares `"I open the <document>"` (with or without `"on the <surface>"`, e.g., `"I open the ledger"`), it routes to `table.sync` (`deferDirectorNarrate: true`) and is recognized by `isDocumentOpenOrReadDeclaration(declaration)` inside `resolveDirectorNarrateOutput`, `buildSceneSurveyNarration`, and `commands.ts`, returning the exact same rich document clue narration as `"I read the <document>"`.

---

## Summary of Surgical Changes by Work Packet

### Packet 1: Whole-Container `loot` / `empty` Routing on Open Containers (`RV-01`)
* **[`utterance-understanding.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/shared/utterance-understanding.ts) & [`play-authority-contract.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/shared/play-authority-contract.ts):**
  * Added [`isWholeContainerLootDeclaration`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/shared/utterance-understanding.ts#L801-L828) and wired it into [`classifyClause`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/shared/utterance-understanding.ts#L502-L511) and [`parsePlayerDeclaration`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/shared/play-authority-contract.ts#L1189-L1209) so container-level collection verbs (`loot`, `empty`, `clear out`, `plunder`, `ransack`, `take/grab/collect all/everything/items/contents from`, `take from`) classify as `take_item` / `take_from_container`.
* **[`deterministic-intent-fallback.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/ai/deterministic-intent-fallback.ts), [`director-mechanics-dispatcher.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/ai/director-mechanics-dispatcher.ts), [`scene-commands.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-commands.ts), & [`commands.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/commands.ts):**
  * Excluded whole-container looting verbs from the `interact_object` state-toggle branch (`nextState === feature.state`) and routed them directly to `table.take_scene_prop` (`itemId = 'all'`) when targeting an unlocked/open container with `contents.length > 0`.
  * Hardened [`lootContainerRuntime`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-commands.ts#L1167-L1294) so container-label tokens and generic looting words (`open`, `loot`, `empty`, `all`, `everything`, `contents`, `items`) do not false-match individual item tokens, transferring **all** items in `feature.contents` to `lootedItems` (`equipmentOverrides`), clearing `feature.contents = []`, and returning `"Took <item1, item2> from <container.label>."`

### Packet 2 & Guardrail: Support-Surface Preposition Splitting, Non-Openable Furniture, & Document Open-to-Read Routing (`RV-02`)
* **[`utterance-understanding.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/shared/utterance-understanding.ts) & [`scene-commands.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-commands.ts):**
  * Expanded [`splitPrimaryTargetFromLocative`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/shared/utterance-understanding.ts#L733-L757) to split support-surface prepositions (`on`, `upon`, `atop`, `in`, `inside`, `within`, `from`, `off`, `over`, `across`, `under`, `beneath`, `underneath`, `below`, `against`, `resting on`, `sitting on`, `lying on`, `laid on`) from the primary verb + direct-object clause, and updated [`scoreFeatureLabelMatch`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-commands.ts#L1985-L2035) so `locativeQualifier` never awards positive score when the primary clause names a different direct-object noun.
* **[`scene-composition.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-composition.ts) & [`scene-commands.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-commands.ts):**
  * Defined [`NON_OPENABLE_SURFACE_HEAD_NOUN`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/shared/utterance-understanding.ts#L769-L770) and blocked non-container surface/furniture props from transitioning to `state: 'open'` or `'closed'` in [`nextObjectState`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-composition.ts#L1930-L1988) and [`interactObjectRuntime`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-commands.ts#L960-L970).
* **[`director-gateway.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/ai/director-gateway.ts), [`commands.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/commands.ts), & [`deterministic-intent-fallback.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/ai/deterministic-intent-fallback.ts) (Packet 2 Narration Trigger Guardrail):**
  * Added [`isDocumentOpenOrReadDeclaration`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/shared/utterance-understanding.ts#L776-L799) and routed document open/unfold/read declarations (`"I open the <document> on the <surface>"` or `"I open the <document>"`) into `table.sync` (`deferDirectorNarrate: true`) and [`buildSceneSurveyNarration`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/ai/director-gateway.ts#L254-L386) / [`resolveDirectorNarrateOutput`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/ai/director-gateway.ts#L571-L585), stripping `open`/`unfold`/`flip` from `askNouns` so `"I open the <document>"` produces the exact same rich document clue narration as `"I read the <document>"`.

### Packet 3: Intra-Scene Object & NPC Approach Routing (`RV-03`)
* **[`scene-commands.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-commands.ts), [`scene-door-intent.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-door-intent.ts), [`deterministic-intent-fallback.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/ai/deterministic-intent-fallback.ts), & [`director-mechanics-dispatcher.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/ai/director-mechanics-dispatcher.ts):**
  * Added [`matchInRoomApproachTarget`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-commands.ts#L2353-L2410) and guarded `isRouteOrExitTravel` / `table.travel_scene` (`(?:down|up)(?!\s+to\b)`) so intra-room approaches (`"I walk up to the <lever>"`, `"I approach the <container>"`, `"I walk over to <NPC>"`) route to `table.move` via BFS shortest walkable pathfinding in [`pathBesideFeature`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/scene-door-intent.ts#L521-L598) instead of `table.travel_scene`.

---

## Raw Verification Gate Outputs

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

▶ Rules Audit, Spatial Topology, & Table UX Remediation (Packets 1–6)
  ✔ Packet 1: Monk Level 1 Unarmored Defense AC = 10 + DEX + WIS (not 10 + DEX) and Magic Initiate grants 2 cantrips + 1 spell with attribution
  ✔ Packet 1 & RS-05: Monk Martial Arts uses max(STR, DEX) and 1d6 die for Unarmed Strike and Monk weapons (Spear), and recomputeSheetForLevel updates Monk speed (40 ft at Lv2) and weapon statsSummary
  ✔ Packet 3: Unlocked containers use 2-step open-then-loot flow; locked containers enforce lockState and unlock with matching key
  ✔ Packet 4: Every room exit and door edge in a generated blueprint is placed on a perimeter boundary cell
  ✔ Packet 4: Mechanism-locked exit blocks travelSceneRuntime until its wall lever is pulled
  ✔ Packet 6: Disconnected presence status renders Neutral (" Away" / "Offline") without falsely claiming "Connected"
  ✔ Packet 1 (RS-01): Syntactic preposition, appositive, and compound-suffix place detection excludes places from namedNpcs and preserves primary place in Scene 1
  ✔ Packet 1 (RS-01): Disappearance/victim NPCs ("vanished apprentice", "missing scout") are separated from Room 1 present contacts
  ✔ Packet 1 Guardrail: Role-titled NPCs ("Warden Corin Vale") match all natural forms ("Warden Corin Vale", "Warden Corin", "Corin Vale", "Corin") across lookup and dialogue
  ✔ Packet 2 (RS-02): buildStoredSceneFromRoomBlueprint preserves immutable container identity, deduplicates per-room labels, and disambiguates by state
  ✔ Packet 3 (RS-03 & RS-04): splitPrimaryTargetFromLocative isolates primary target from locative prepositions, and doorway passage resolves destination room title
  ✔ Packet 4 (RS-06): Outdoor ruin scenes place gate lever on walkable floor cell within 2 squares of gate and use outdoor-appropriate labels
  ✔ Packet 1 (RV-01): Whole-container "loot" / "empty" / "take all" on an already-open container routes to table.take_scene_prop and transfers all remaining contents
  ✔ Packet 2 (RV-02): Support-surface prepositions ("on the <surface>") do not hijack target scoring, solid surfaces never mutate to state="open", and "I open the <document>" routes to rich document reading narration
  ✔ Packet 3 (RV-03): In-room approach declarations ("I walk up to the lever", "I approach the <container>", "I walk over to <NPC>") route to table.move beside the feature instead of table.travel_scene
✔ Rules Audit, Spatial Topology, & Table UX Remediation (Packets 1–6)

ℹ tests 512
ℹ suites 6
ℹ pass 512
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4127.7163
```

### 3. `npx playwright test` (Expanded `tests/e2e/rules-spatial-table-remediation.spec.ts` + Active E2E Regression Suite)
```text
Running 20 tests using 1 worker

  ok  1 [chromium] › tests\e2e\batch2-director-scene-loop.spec.ts:63:3 › Batch 2/3 Director scene loop › interior → object change → exterior → encounter (actor on map) → return (18.4s)
  ok  2 [chromium] › tests\e2e\batch2-director-scene-loop.spec.ts:143:3 › Batch 2/3 Director scene loop › open-ended landmark destination differs from prepared travel wording (12.8s)
  ok  3 [chromium] › tests\e2e\batch2-director-scene-loop.spec.ts:181:3 › Batch 2/3 Director scene loop › reusability: different premise yields different opening scene (5.3s)
  ok  4 [chromium] › tests\e2e\batch2-director-scene-loop.spec.ts:195:3 › Batch 2/3 Director scene loop › canal town + missing courier opening keeps location and quest hook (5.2s)
  ok  5 [chromium] › tests\e2e\declaration-first-intent.spec.ts:61:3 › Declaration-first Intent Intercept › NL attack draft confirms through the rules engine without Tools (7.5s)
  ok  6 [chromium] › tests\e2e\declaration-first-intent.spec.ts:89:3 › Declaration-first Intent Intercept › beginning encounter marks an open free-roam draft stale (6.9s)
  ok  7 [chromium] › tests\e2e\open-step-through-cross.spec.ts:86:3 › Open + step-through doorway cross › fresh closed door: single open+cross confirm moves token and narrates once (9.8s)
  ok  8 [chromium] › tests\e2e\open-step-through-cross.spec.ts:149:3 › Open + step-through doorway cross › far-side reverse through is a confirmable cross back (11.0s)
  ok  9 [chromium] › tests\e2e\open-step-through-cross.spec.ts:199:3 › Open + step-through doorway cross › enter room beyond while already past doorway clarifies once (10.5s)
  ok 10 [chromium] › tests\e2e\post-deploy-remediation.spec.ts:22:3 › Post-Deploy Systemic Remediation (Packets 1–5) › Premise live sync, PC exclusion from NPCs, intent translation, grounded improvisation, equipment mechanics, Chronicle auto-scroll, and single-scroll Rules Consult (14.4s)
  ok 11 [chromium] › tests\e2e\qa-residual-regressions.spec.ts:16:3 › PQA residual regressions › User UI Regressions: smooth identity typing across debounce, scroll-to-top on Continue, no duplicate headings, ordered campaign sections (4.3s)
  ok 12 [chromium] › tests\e2e\qa-residual-regressions.spec.ts:91:3 › PQA residual regressions › PQA-061: switching ability method uses an in-app confirm dialog (1.8s)
  ok 13 [chromium] › tests\e2e\qa-residual-regressions.spec.ts:120:3 › PQA residual regressions › PQA-012/013/014: chronicle, director, and rules copy stay player-facing (6.1s)
  ok 14 [chromium] › tests\e2e\qa-residual-regressions.spec.ts:178:3 › PQA residual regressions › Codex Retest [R26-01, F26-06, F26-01, R26-03, F26-02, R26-02]: 902x871 map/HUD layout, Rogue/Criminal overlap replacement, and table declarations (11.7s)
  ok 15 [chromium] › tests\e2e\recheck2-door-play-layout.spec.ts:46:3 › Recheck 2 door + play layout › 1081×898 keeps action composer in viewport (6.4s)
  ok 16 [chromium] › tests\e2e\recheck2-door-play-layout.spec.ts:221:3 › Recheck 2 door + play layout › close open doorway updates map; already-beside is explicit (11.9s)
  ok 17 [chromium] › tests\e2e\recheck2-door-play-layout.spec.ts:331:3 › Recheck 2 door + play layout › named premise entities and location art appear on opening scene (7.0s)
  ok 18 [chromium] › tests\e2e\rogue-expertise-kit-overlap.spec.ts:38:3 › Rogue Expertise and kit overlap › Features shows Expertise controls before mastery; tools do not stack to 2 (5.4s)
  ok 19 [chromium] › tests\e2e\rules-spatial-table-remediation.spec.ts:39:3 › Rules Audit, Spatial Topology, & Table UX Remediation (Packets 1–6) › Packet 1–5 end-to-end: Monk Unarmored Defense & Magic Initiate attribution, 2-step Portrait Lightbox, Campaign Create notice layout, banner-free map clicks, 2-step container looting, perimeter exit travel, and wall-lever mechanism lock (56.0s)
  ok 20 [chromium] › tests\e2e\take-scene-prop-inventory.spec.ts:59:3 › Take portable scene prop into inventory › Confirm take courier satchel stows gear and removes map prop (9.7s)

  20 passed (3.7m)
```
