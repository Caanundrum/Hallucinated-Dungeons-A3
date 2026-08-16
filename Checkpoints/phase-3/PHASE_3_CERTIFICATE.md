---
recordType: phase_certificate
phase: phase-3
lifecycleState: PHASE_CERTIFIED
blueprintVersion: ALPHA_3_V1
blueprintSourceHash: 144f178d3cbfbe6572c299d4ad4b841ec3e6fa28ddedf5eddce0223e6250ce1e
certifiedCandidateId: cand-cc92bfc17c10
certifiedSourceTreeHash: cc92bfc17c101405125b046e9166362c2cf62c6d73972eaee6e4d857a0c023c5
certifiedCommit: 029b147aad4b113805c88140c4dd0623280ccc6e
humanGate: none
humanGateBasis: "Section 25 Phase 3 — no Product Owner human gate. Certification follows Builder Verification + Independent QA Player Validation only."
builderVerification: PASSED
qaPlayerValidation: PLAYER_VALIDATED
openBlockingFindings: 0
certifiedAt: 2026-08-16T13:32:00Z
---

# Phase 3 — Deterministic SRD rules loop

## Lifecycle

`IMPLEMENTING` → `BUILDER_VERIFYING` → `READY_FOR_QA` → `PLAYER_VALIDATED` → `PHASE_CERTIFIED`.

Phase 3 has **no** explicit Product Owner gate. Agents must not invent Product Owner approval.

## Certified candidate

| Field | Value |
| --- | --- |
| Candidate id | `cand-cc92bfc17c10` |
| Source tree hash | `cc92bfc17c101405125b046e9166362c2cf62c6d73972eaee6e4d857a0c023c5` |
| Certified commit | `029b147aad4b113805c88140c4dd0623280ccc6e` |
| Blueprint | `ALPHA_3_V1` |

The candidate hash covers exactly the tracked Builder Root source, its dependency lock, and its security rules. QA, Runtime, Evidence, Checkpoint, and archive artifacts are evidence about the candidate and are excluded, as Section 1.11.1 requires. Committing this certificate therefore does not change the certified candidate.

## Gate evidence

| Gate | Outcome | Record |
| --- | --- | --- |
| Builder Verification | PASSED | `Checkpoints/phase-3/PHASE_3_BUILDER_VERIFICATION.md` |
| Independent QA | PLAYER_VALIDATED | `QA/findings/PHASE_3_QA_FINDINGS.md` |
| Product Owner approval | not required | Section 25 Phase 3 `humanGate: none` |

## Scope certified

Structured SRD combat/conditions/XP/slots/areas data used by the engine; d20/action economy/combat core; damage, healing, Temporary Hit Points, conditions, Death Saving Throws, short/long rest, equipment/hand state in the encounter loop; spell resources, targeting, square/3D areas, concentration for the Phase 3 usable spell set; Reactions, Decision Windows, Ready under server-issued Timing Authority; XP-only single-class progression levels 1–20 with derived-stat recomputation; Rules Desk read-only explanations; player-facing roll activation through the table UI; one integrated rendered training encounter; permanent smoke spine rules segment.

Certificate proves deterministic SRD rules capability and current rendered rules journeys through levels 1–20. It does **not** claim the final AI-led, 2–6-player, starter-campaign product experience (Phases 4–7).

## Training harness (honest bounds)

- Usable spell set is the Phase 3 approved subset (e.g. Fire Bolt, Burning Hands, Shield-as-Reaction) — not the full SRD corpus.
- Training foes are Training Dummy / Practice Goblin; auto-attacks are nonlethal so the multi-step journey stays playable.
- `combat.training_drop` is a local training control for Death Save path proof, not production combat.

## Explicitly not certified here

AI Director behavior, Google Sign-In, Admin panel, speech I/O, four-plus-player social presence (Phase 4); production art packs / campaign memory (Phase 5); full adversarial deep-challenge / Independent QA Judge (Phase 6/7).
