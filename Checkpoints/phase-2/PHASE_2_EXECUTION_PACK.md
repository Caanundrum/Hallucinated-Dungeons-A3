---
recordType: phase_execution_pack
phase: phase-2
packVersion: 1
blueprintVersion: ALPHA_3_V1
blueprintFile: HALLUCINATED_DUNGEONS_ALPHA_3_MASTER_BLUEPRINT_V1.md
blueprintSourceHash: 144f178d3cbf
priorPhase: phase-1
priorPhaseState: PHASE_CERTIFIED
priorCertifiedCandidate: cand-b5e4a128cef1
lifecycleState: IMPLEMENTING
humanGate: required
authoredAt: 2026-08-14T20:32:00Z
---

# Phase 2 execution pack

Compiled from the authoritative blueprint under Section 1.14.5. A Builder slice should read this
pack plus the one domain section it owns rather than loading the full master blueprint every time.

**This pack cannot narrow scope.** If it disagrees with the blueprint, the blueprint wins and the
pack is corrected. Creating it satisfies no requirement (Section 1.14.6).

## Mission

Make the game mechanically real on the five-foot square grid before piling on every combat rule.

## Invariant kernel

Carry Phase 1 invariants forward, plus:

- Only the command gateway may accept mechanical mutation intent. Party Chat, Rules Desk, and
  Chronicle never become commands by implication.
- Commands carry expected state version + idempotency id. Stale versions reject without spend.
- Events are immutable. Projections are derived server truth; the client never invents them.
- Hidden map/fog facts are omitted from unauthorized payloads entirely.
- Two-client local synchronization of the Phase 2 tactical slice is required; do not postpone
  multiplayer into an incompatible architecture.
- PixiJS is vanilla only — `@pixi/react` is banned (Section 1.10.9).
- Local execution only. No live project, public origin, or production credential.

## Inherited Phase 1 contracts

Extend, do not replace:

| Contract | Where |
| --- | --- |
| Account / ownership / seats | `PHASE_1_IDENTITY_AND_OWNERSHIP_CONTRACT.md`, campaigns module |
| Communication Dock structure | `campaign-table.ts`, communication-contract |
| Action Composer visual separation | campaign table; Phase 2 enables real command plumbing |
| Seat `lastAcknowledgedEventSequence` stub | seat projection — now consumed by the event core |
| Foundation `requestId` / `projectionVersion` pattern | extend to campaign table commands |
| Smoke spine character/campaign continuity | add a tactical interaction segment once map exists |

## Build scope

1. **Command / event / projection / idempotency core.** Canonical command acceptance, event log,
   projection publication, state versioning, server randomness hooks, idempotency, outbox/retry
   records, and recovery-ready state documents.
2. **Map coordinate / edge / footprint schemas.** Image-backed five-foot squares, anchors,
   footprints, elevation, edges, collision, strict diagonal clearance — schema first, then render.
3. **PixiJS map rendering and semantic scene graph.** Tokens, camera, interaction layers, fog /
   visibility presentation bound to server projections.
4. **Movement / collision / visibility.** Previews and committed movement, map objects/doors,
   basic targeting, player-specific visibility.
5. **Timing Authority + Action Composer plumbing.** Prove only authorized actors can mutate
   state; natural-language Interpret Action remains gated until this plumbing is real.
6. **Two-client sync / reconnect / recovery.** Narrow table-state synchronization proof, not the
   full Phase 4 presence/social/Google/AI multiplayer experience.
7. **Settings / accessibility on the tactical table.** Reduced motion / low-effects and any local
   audio controls that already have real Phase 2 behavior. No decorative voice-selection UI.

## Explicitly not Phase 2

Absent, not stubbed: full SRD combat engine, dice adjudication, XP/progression (Phase 3); Google
Sign-In, Admin panel, AI Director responses, speech I/O, four-plus-player social presence
(Phase 4); production art packs and campaign memory (Phase 5).

## Player journey to certify

Two players enter the same local campaign, see only authorized map state, move legal paths, fail
illegal paths, interact with an object, refresh/reconnect on both clients, and recover the same
canonical positions and visibility.

## Human gate

Product Owner reviews the main tabletop, tokens, fog, grid readability, interaction feel, and map
direction **after** Builder and QA loophole passes.

Lifecycle: `PLAYER_VALIDATED` → `AWAITING_HUMAN_REVIEW` → `PHASE_CERTIFIED` on approval of that
exact candidate.

## Suggested slicing (internal; not gates)

1. Execution pack, ledger, command/event/projection/idempotency core. **(this chunk — 2a)**
2. Map schemas + PixiJS stage mounted in the existing table shell.
3. Movement, collision, visibility.
4. Timing Authority + Action Composer plumbing.
5. Two-client sync, reconnect, recovery.
6. Freeze → Builder Verification → QA → Product Owner tabletop gate.
