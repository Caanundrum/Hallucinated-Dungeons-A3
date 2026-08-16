---
recordType: phase_execution_pack
phase: phase-5
packVersion: 1
blueprintVersion: ALPHA_3_V1
blueprintFile: HALLUCINATED_DUNGEONS_ALPHA_3_MASTER_BLUEPRINT_V1.md
blueprintSourceHash: 144f178d3cbf
priorPhase: phase-4
priorPhaseState: PHASE_CERTIFIED
priorCertifiedCandidate: cand-1de6ebed38c8
lifecycleState: IMPLEMENTING
humanGate: product_owner_complete_experience
humanGateNote: "Section 25.4 / Phase 5 — Product Owner reviews complete game feel (art, motion, sound, Director persona/voice, humor, starter-campaign presentation) after Builder Verification and Independent QA. Approval binds only to the exact candidate hash."
authoredAt: 2026-08-16T20:20:00Z
---

# Phase 5 execution pack

Compiled from Section 25 Phase 5. This pack cannot narrow scope; the blueprint wins.

## Mission

Make Hallucinated Dungeons feel like a game people want to return to — campaign depth,
starter adventure, production presentation, and multi-session continuity — not a rules
laboratory wearing a torch texture.

## Invariant kernel (carry forward)

- Command gateway remains the only mechanical mutator.
- Campaign memory and recaps are audience-classified; secrets never collapse into public summaries.
- Presentation Cue Plans are server-derived from committed events — AI prose cannot trigger FX/audio/state.
- Director identity/personality stays locked for ordinary users; avatar is identity×personality.
- Asset provenance is recorded; gray boxes and unfinished placeholders cannot pass as production art.
- Sandbox campaign creation stays hidden until the starter journey is stable on the candidate.
- Local certification first; Milestone publication remains optional and PO-authorized.

## Build scope

1. Structured campaign memory: chapters, summaries, NPC motives/knowledge, quests, factions,
   social state, open threads, recaps, campaign-time continuity.
2. Original curated starter campaign (~3–5 sessions) as product content **and** versioned
   validation fixture (known start state, maps, entities, objectives, branches, checkpoints).
3. Production presentation: maps, portraits/tokens/scene cues, condition/spell effects hooks,
   Presentation Cue Plans, non-musical sound design, Director speech fallback behavior,
   final personality-specific Director avatar set (6× Veyra + 6× Garrick = 12).
4. Asset provenance, performance budgets, reduced-effects / static fallbacks, cross-screen coherence.
5. Multi-session resume, absence/return personal recap, continuation beyond planned climax
   (new chapter plan from canonical history — no world reset).
6. Settings coherence over long play: locked Director, speech I/O, humor/narration density,
   audio, accessibility, campaign rules preferences.
7. Permanent smoke spine **campaign resume** segment; Phase 5 certify floor; Independent QA;
   Product Owner complete-experience gate.

## Explicitly not Phase 5

Full cumulative security/a11y/device cert and deep independent challenge (Phase 6);
Gold Master / Launch Production cutover (Phase 7); Open Alpha; inventing Milestone publication.

## Player journey to certify

Play a meaningful portion of the starter campaign across multiple scenes: social, exploration,
tactical combat, absence/return, and session resume. Judge fun, clarity, pacing, visual
coherence, repetition, and Director personality consistency — not merely HTTP 200s.

## Lifecycle

`IMPLEMENTING` → `BUILDER_VERIFYING` → `READY_FOR_QA` → `PLAYER_VALIDATED` →
`AWAITING_HUMAN_APPROVAL` → `PHASE_CERTIFIED` (only after Product Owner approval of the
exact candidate).

## Suggested slicing (internal; not gates — execute continuously)

1. Pack, ledger, PO checkpoint template, memory/chapter contracts + persistence.
2. Starter campaign content pack + creation path + fixture seed identity.
3. Session suspend/resume + recap-on-return + smoke spine resume segment.
4. Presentation Cue Plans + reduced-effects/static audio/visual fallbacks.
5. Director avatar set (12) + starter map/token presentation upgrade with provenance.
6. Narration density / long-play settings coherence.
7. E2E + Independent QA + freeze BV → present PO gate.
