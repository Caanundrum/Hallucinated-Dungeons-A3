---
recordType: phase_execution_pack
phase: phase-3
packVersion: 1
blueprintVersion: ALPHA_3_V1
blueprintFile: HALLUCINATED_DUNGEONS_ALPHA_3_MASTER_BLUEPRINT_V1.md
blueprintSourceHash: 144f178d3cbf
priorPhase: phase-2
priorPhaseState: PHASE_CERTIFIED
priorCertifiedCandidate: cand-e1c5d41b583b
lifecycleState: PHASE_CERTIFIED
humanGate: none
builderVerifiedCandidate: cand-cc92bfc17c10
certifiedCandidate: cand-cc92bfc17c10
authoredAt: 2026-08-15T13:42:00Z
builderVerifiedAt: 2026-08-16T13:30:25Z
certifiedAt: 2026-08-16T13:32:00Z
---

# Phase 3 execution pack

Compiled from Section 25 Phase 3. This pack cannot narrow scope; the blueprint wins.

## Mission

Turn the Phase 2 tactical foundation into a complete deterministic SRD rules loop
(combat, spells, reactions, rests, death, XP, single-class levels 1–20) without an
architectural pivot.

## Invariant kernel (carry forward)

- Only the command gateway mutates mechanics. Party Chat / Rules Desk / Chronicle never
  become commands by implication.
- Commands carry `requestId` + `expectedStateVersion` + Timing Authority where required.
- Events immutable; projections server-authored; fog/hidden facts omitted.
- Server randomness only for dice. Client never invents outcomes.
- Local execution only.

## Build scope

1. Structured SRD data expansion + conformance harness (combat/conditions/XP/slots/areas).
2. d20 / action economy / combat core (initiative, attack, save, hit/miss).
3. Damage, healing, temp HP, conditions, death saves, revival eligibility, short/long rest,
   equipment/hand state used in the encounter loop.
4. Spell resources, targeting, square/3D areas, concentration, propagation profiles needed
   for approved SRD scope used in the rendered encounter.
5. Reactions, Decision Windows, Ready, nested interrupt authority.
6. XP-only progression, transactional single-class levels 1–20, level-up choices,
   derived-stat recomputation, progression fixtures.
7. Rules Desk explanations grounded in structured rules (read-only).
8. Full player-facing roll activation through the Action Composer / table UI.
9. One integrated rendered encounter exercising the chain; smoke spine gains one rules action.
10. Freeze → Builder Verification → Independent QA. **No Product Owner gate** (Section 25.4).

## Explicitly not Phase 3

AI Director behavior, Google Sign-In, Admin panel, speech I/O, four-plus-player social
presence (Phase 4); production art packs / campaign memory (Phase 5).

## Player journey to certify

Rendered encounter: movement, attack, spell, area placement, reaction, condition,
damage/healing, inventory/resource use, rest, death/recovery path, XP award, and level-up.
Illegal UI attempts fail closed. Certificate proves deterministic SRD rules capability
through levels 1–20 — not the final AI-led multiplayer starter-campaign product.

## Lifecycle

`IMPLEMENTING` → `BUILDER_VERIFYING` → `READY_FOR_QA` → `PLAYER_VALIDATED` →
`PHASE_CERTIFIED` (no human gate).

## Suggested slicing (internal; not gates — execute continuously)

1. Pack, ledger, rules contracts, dice, SRD combat data, encounter projection.
2. Combat commands: begin encounter, initiative, attack, damage/heal, death, rest.
3. Spells, areas, concentration, reactions/Ready/Decision Windows.
4. XP / level-up 1–20 + Rules Desk + table UI integrated encounter.
5. Tests, smoke spine rules segment, freeze, BV, independent QA, certificate.
