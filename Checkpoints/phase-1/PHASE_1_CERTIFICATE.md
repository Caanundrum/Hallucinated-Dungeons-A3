---
recordType: phase_certificate
phase: phase-1
lifecycleState: PHASE_CERTIFIED
blueprintVersion: ALPHA_3_V1
blueprintSourceHash: 144f178d3cbfbe6572c299d4ad4b841ec3e6fa28ddedf5eddce0223e6250ce1e
certifiedCandidateId: cand-b5e4a128cef1
certifiedSourceTreeHash: b5e4a128cef1e32201306741e0bd81ce3752b64716f011bd06ddfe336c488da8
certifiedCommit: 513d4079408b53f0c7583e83401cf11c856b573f
humanGate: required
humanGateBasis: "Section 25 Phase 1 Product Owner gate. Approval recorded in PHASE_1_HUMAN_APPROVAL_CHECKPOINT.md by Nick on 2026-08-14."
productOwnerApprover: Nick
productOwnerApprovedAt: 2026-08-14T20:22:00Z
builderVerification: PASSED
qaPlayerValidation: PLAYER_VALIDATED
openBlockingFindings: 0
certifiedAt: 2026-08-14T20:22:00Z
---

# Phase 1 — First coherent player product

## Lifecycle

`IMPLEMENTING` → `BUILDER_VERIFYING` → `READY_FOR_QA` → `PLAYER_VALIDATED` → `AWAITING_HUMAN_REVIEW` → `PHASE_CERTIFIED`.

Phase 1 has an explicit Product Owner gate. Certification advances only after authenticated approval of the exact frozen candidate — never from silence.

## Certified candidate

| Field | Value |
| --- | --- |
| Candidate id | `cand-b5e4a128cef1` |
| Source tree hash | `b5e4a128cef1e32201306741e0bd81ce3752b64716f011bd06ddfe336c488da8` |
| Certified commit | `513d4079408b53f0c7583e83401cf11c856b573f` |
| Tracked Builder Root files | 100 |
| Blueprint | `ALPHA_3_V1` |

The candidate hash covers exactly the tracked Builder Root source, its dependency lock, and its security rules. QA, Runtime, Evidence, Checkpoint, and archive artifacts are evidence about the candidate and are excluded, as Section 1.11.1 requires. Committing this certificate therefore does not change the certified candidate.

## Gate evidence

| Gate | Outcome | Record |
| --- | --- | --- |
| Builder Verification | PASSED | `Checkpoints/phase-1/PHASE_1_BUILDER_VERIFICATION.md` |
| Independent QA | PLAYER_VALIDATED | `QA/findings/PHASE_1_QA_FINDINGS.md` |
| Product Owner approval | APPROVED by Nick | `Checkpoints/phase-1/PHASE_1_HUMAN_APPROVAL_CHECKPOINT.md` |

## Scope certified

Enter the site, understand it, create a legal character, create or join a campaign with a locked Director identity and personality, configure real Phase 1 settings, leave, return, and recover the same state — with one design language, one authority model, and one persistence contract.

Explicitly not certified here (absent, not stubbed): tactical map, command/event core, rules engine / dice / combat, realtime presence, AI Director behavior, Google Sign-In, Admin panel, speech I/O, campaign memory, production art/audio, hosted deployment.

## Deferred follow-ups recorded at certification

- `P1-TYPOGRAPHY-ASSETS` — licensed font bundling still `NOT_STARTED`
- Real Safari / real-tablet device certification — `BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION` until Phase 6/7
- Deeper cumulative QA — Product Owner noted fuller manual verification is deferred to a later phase; functional Phase 1 gate is accepted
