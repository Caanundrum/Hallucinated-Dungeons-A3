---
phase: phase-3
candidateId: cand-cc92bfc17c10
sourceTreeHash: cc92bfc17c101405125b046e9166362c2cf62c6d73972eaee6e4d857a0c023c5
commit: 029b147aad4b113805c88140c4dd0623280ccc6e
recordType: extended_playtest_findings
status: COMPLETED_WITH_OPEN_UX_FINDINGS
blockingForPhaseCertificate: false
executedAt: 2026-08-16T15:10:00Z
---

# Phase 3 — Extended playtest & usability findings

Requested by Product Owner after `PHASE_CERTIFIED`. These checks do **not** reopen the phase certificate unless Nick elevates a finding to a gate. They document novice playability debt.

Frozen origin: `http://127.0.0.1:5274` · candidate `cand-cc92bfc17c10`.

## What ran

| Requested check | Method | Outcome |
| --- | --- | --- |
| Open-ended confused novice (no testids) | Computer-use free exploration | **Completed** — High UX friction found |
| Comprehension interview | Live UI Q&A during novice session | **Completed** — Rules Desk / Active Turn = Slow |
| Long session / edge thrash | Playwright `PT-EDGE-01` × desktop/tablet/phone viewports | **PASS** (15/15 suite incl. thrash) |
| Screen-reader / full a11y | Keyboard nav + landmarks + presentation prefs; **not** VoiceOver/TalkBack | **Partial PASS** — see gaps |
| Tablet/phone | Chromium viewport 834×1194 and 412×915 | **PASS** on emulated viewports; **not** real iPad/Safari/Android |
| Manual death-save live | Computer-use careful walkthrough + `PT-DEATH-01` | **PASS** |

Automated suite log: `/opt/cursor/artifacts/phase3_playtest_final.log` (15 passed).  
Spec: `QA/scripts/phase3-playtest.qa.spec.ts`.

## Comprehension interview (novice)

| Question | Answer found | Ease |
| --- | --- | --- |
| Where do you ask a rules question? | Dock tab **Rules Desk** | **Slow** — had to try all three dock tabs |
| When can you take a mechanical action? | After **Claim Active Turn** / “You hold Active Turn” | **Slow** — copy mentions authority mid-page; button buried below fold |
| Party Chat vs Declare Action? | Chat = Table Talk only; Declare Action = mechanical | **Obvious** — explanatory copy is clear |

## Open findings (product)

### HIGH — Claim Active Turn discoverability
Instruction text sits in Declare Action; the actual **Claim Active Turn** control is far down the page. Novice spent minutes hunting. Blocks mechanical play until found.

### HIGH — Weak action feedback for confused players
When prerequisites are unmet, training controls look clickable but do nothing obvious (aria-disabled is easy to miss). Novice concluded buttons were broken before learning turn/authority rules. (Mechanics work when prerequisites are met — confirmed in careful death-save PASS.)

### MEDIUM — Scroll-heavy table
Rules panel, combat tracker, dock, and turn controls compete; core turn actions require long scroll (aligns with Phase 2 residual layout note).

### MEDIUM — Action-like Party Chat
Typing “I attack the goblin…” becomes Table Talk with no intercept warning. Correct per architecture; confusing for D&D-trained novices.

### LOW — Dock tab selected state subtle; “active · round · active Name” wording redundant.

## Manual death-save path (live)

**PASS.** Claim Active Turn → Begin encounter → Roll initiative → own turn → Training drop → HP 0 Unconscious → Death Save (failure observed) → Long Rest → HP restored / conditions cleared.

Evidence: `/opt/cursor/artifacts/phase3_playtest/death_*.webp`.

## A11y scope honesty

**Done:** keyboard Characters→Campaigns; dock `tablist` / regions; reduced motion + low effects toggles update `table-presentation-meta`.

**Not done (blocked here):** real screen-reader session (VoiceOver/NVDA/TalkBack), switch access, 200%/400% zoom audit, real Safari/iPadOS. Remains `BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION` through Phase 6/7.

## Tablet / phone honesty

Emulated Chromium viewports **passed** the playtest scripts. This is **not** real-device or Safari certification.

## Verdict for Nick

- **Rules mechanics / death path:** playable and verified live + automated.
- **Novice usability:** **not** ready to call “obvious without help.” Two High findings should be treated as follow-ups (layout/discoverability/feedback), not as Phase 3 scope re-open unless you decide they are.
- **Would a novice complete the rules loop alone?** **Partial / No** without discovering Claim Active Turn and understanding disabled-button prerequisites.

## Recommendation

Keep `PHASE_CERTIFIED`. Optionally open a Phase 3.1 / Phase 5 layout polish ticket for:
1. Move Claim Active Turn adjacent to Declare Action header.
2. Clearer disabled-reason / toast when training controls cannot fire.
3. Optional soft warning when Party Chat looks like an action declaration.
