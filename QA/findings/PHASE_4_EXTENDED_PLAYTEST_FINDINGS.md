---
phase: phase-4
candidateId: cand-f79b57277ebf
sourceTreeHash: f79b57277ebfc5074dca3bdf270738a69b94fab939e2d4295211728daffa685f
commit: 10dc550ce6ca745c7e457d3f2445066a079ce17e
recordType: extended_playtest_findings
status: COMPLETED_WITH_OPEN_UX_FINDINGS
blockingForPhaseCertificate: false
executedAt: 2026-08-16T18:30:00Z
---

# Phase 4 — Extended playtest & usability findings

Requested by Product Owner after `PHASE_CERTIFIED`, at the same bar as Phase 3 extended playtest: confused novice, comprehension interview, edge thrash, a11y honesty, tablet/phone, live paths, multiplayer. These checks do **not** reopen the phase certificate unless Nick elevates a finding to a gate.

Frozen origin: `http://127.0.0.1:5274` · candidate `cand-f79b57277ebf`.

## What ran

| Requested check | Method | Outcome |
| --- | --- | --- |
| Open-ended confused novice (no testids) | Computer-use free exploration | **Completed** — High UX friction found (carry-forward + Phase 4) |
| Comprehension interview | Live UI Q&A during novice session | **Completed** — see interview table |
| Long session / edge thrash | Playwright `PT4-EDGE-01/02` × desktop/tablet/phone | **PASS** |
| Screen-reader / full a11y | Keyboard nav + landmarks + presentation + speech prefs; **not** VoiceOver/TalkBack | **Partial PASS** — see gaps |
| Tablet/phone | Chromium viewport 834×1194 and 412×915 | **PASS** on emulated viewports; **not** real iPad/Safari/Android |
| Manual death-save live | Playwright `PT4-DEATH-01` × 3 viewports | **PASS** |
| Live Admin / Director / NL Intent / speech | Computer-use + Playwright `PT4-COMP-02`, `PT4-AI-01`, Independent QA | **PASS** (automated); computer-use Admin + speech **PASS**; Director/NL **PARTIAL** in GUI agent due to scroll thrash (see note) |
| Two-client presence + chat | Playwright `PT4-MP-01` × 3 viewports | **PASS** |

Automated suite: **27/27 passed** (`/opt/cursor/artifacts/phase4_playtest_final.log`).  
Spec: `QA/scripts/phase4-playtest.qa.spec.ts` · config: `QA/playwright.phase4-playtest.config.ts`.

## Comprehension interview (novice)

| Question | Answer found | Ease |
| --- | --- | --- |
| Where do you ask the Director a private question? | Dock tab **Director Address** | **Easy** — labeled; copy says nonmutating |
| Where is Party Chat vs rules talk? | Dock **Party Chat** vs **Rules Desk** / Declare Action | **Easy** for Party Chat; Rules Desk **Easy** once dock noticed |
| When can you take a mechanical action? | After **Claim Active Turn** | **Slow** — button still below fold among utility controls (Phase 3 High carry-forward) |
| Who is at the table? | **Table Presence** panel | **Medium** — dual “online / absent” rows for same seat confuse novices |
| How do you stop AI? | **/admin** kill switch (bootstrap only) | **Easy** denial for ordinary accounts; admin path clear when authorized |
| Speech / dictate? | Account presentation toggles (TTS/STT) | **Easy** — defaults off; operable |

Novice session verdict: surfaces are **labeled**, but **discoverability of Claim Active Turn** and **weak disabled feedback** still block unaided mechanical play (~60% novice success estimate without coaching).

## Open findings (product)

### HIGH — Claim Active Turn discoverability (carry-forward from Phase 3)
Still buried below the Action Composer utility row. Novice and expert sessions both hunted. Blocks mechanical play, NL Intent Intercept, and table sync until found.

### HIGH — Weak disabled-control feedback (carry-forward from Phase 3)
Training / interpret controls look actionable while `aria-disabled=true`; no toast or inline reason. Novices conclude the UI is broken before learning Active Turn / own-turn prerequisites.

### HIGH — Composer textarea scroll thrash (Phase 4)
Typing in **Director Address** or **Natural-language intent** can auto-scroll the page away from the focused field in GUI sessions, making manual entry feel broken. Playwright `fill()` paths succeed; real pointer/keyboard entry is painful. Treat as Phase 4 UX debt before claiming “player-obvious” AI surfaces.

### MEDIUM — Presence dual-row confusion
Presence can show the same seat as both online and absent-looking rows / device lines. Correct enough for engineers; confusing for novices asking “is my friend here?”

### MEDIUM — Scroll-heavy table (carry-forward)
Map, dock, presence, encounter controls, and AI gateway compete; core turn actions need long scroll on phone/tablet emulations.

### LOW — Dock / authority wording redundancy
“active · round · active Name” and similar strings still read dense.

## Live paths (evidence)

| Path | Automated | Computer-use | Notes |
| --- | --- | --- | --- |
| Director Address nonmutation | **PASS** (`PT4-COMP-02`, Independent QA) | PARTIAL — UI reached; scroll thrash hindered send | Simulator reply verified in suite screenshots |
| NL Intent Intercept confirm/cancel | **PASS** (`PT4-COMP-02`) | PARTIAL — authority claimed; intercept via GUI agent incomplete | Cancel path certified in Independent QA |
| Director narration + personality | **PASS** (`PT4-AI-01`) | — | Humor/aside length check only (not quota) |
| AI kill switch blocks Address | **PASS** (`PT4-EDGE-02`) | — | Restored after test |
| Admin denial (non-bootstrap) | **PASS** | **PASS** | “Admin authorized: No” |
| Speech prefs default off | **PASS** | **PASS** | TTS/STT toggles on Account |
| Presence + Party Chat 2-client | **PASS** (`PT4-MP-01`) | — | Out-of-turn commit blocked |
| Death → save → long rest | **PASS** (`PT4-DEATH-01` ×3) | — | Regression under Phase 4 table |

Evidence folder: `/opt/cursor/artifacts/phase4_playtest/` (suite PNGs + selected live webps).

## A11y scope honesty

**Done:** keyboard Characters → Campaigns → Admin; dock `tablist` / regions; reduced motion + low effects; TTS/STT prefs operable; Admin denial reachable.

**Not done (blocked here):** real screen-reader session (VoiceOver/NVDA/TalkBack), switch access, 200%/400% zoom audit, real Safari/iPadOS. Remains `BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION` through Phase 6/7.

## Tablet / phone honesty

Emulated Chromium viewports **passed** all 27 playtest scripts (9 × 3 projects). This is **not** real-device or Safari certification.

## Honest product bounds (unchanged)

- AI Director = deterministic Local Arena simulator, not a live LLM provider.
- Google identity = emulator / QA fixtures locally; real Google on hosted Milestone.
- Invite-Only Alpha / Public Milestone **publication not authorized** by this playtest.

## Verdict for Nick

- **Phase 4 local certificate:** remains valid — playtest does not reopen `PHASE_CERTIFIED` unless you elevate a finding.
- **Rules / death / presence / Admin / AI simulator contracts:** playable and verified across desktop/tablet/phone emulations (27/27).
- **Novice / player-obvious UI:** **not** ready to call complete. Same Phase 3 High discoverability/feedback debt remains; Phase 4 adds presence confusion and Director/NL textarea scroll thrash.
- **Would a confused novice complete Phase 4 AI + table loop alone?** **Partial / No** without finding Claim Active Turn and overcoming disabled-control opacity / scroll thrash.

## Recommendation

Keep `PHASE_CERTIFIED`. Open follow-ups (Phase 4.1 / Phase 5 polish), not a phase reopen, unless you gate publication on UX:

1. Move **Claim Active Turn** adjacent to Declare Action / Intent controls.
2. Disabled-reason toast or visible prerequisite chips on training + Interpret controls.
3. Stop scroll-on-type thrash in Director Address and NL intent composers.
4. Clarify Presence online vs device/tab rows for multi-seat tables.
