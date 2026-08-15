---
recordType: phase_certificate
phase: phase-2
lifecycleState: PHASE_CERTIFIED
blueprintVersion: ALPHA_3_V1
blueprintSourceHash: 144f178d3cbfbe6572c299d4ad4b841ec3e6fa28ddedf5eddce0223e6250ce1e
certifiedCandidateId: cand-e1c5d41b583b
certifiedSourceTreeHash: e1c5d41b583bc16fba0a83544b013280474e7c485fe1987d234a79e09d163a48
certifiedCommit: e6da5508a4015a1e4e7dac9b24c643ff3fcafaaa
humanGate: required
humanGateBasis: "Section 25 Phase 2 Product Owner gate. Approval recorded in PHASE_2_HUMAN_APPROVAL_CHECKPOINT.md by Nick on 2026-08-15."
productOwnerApprover: Nick
productOwnerApprovedAt: 2026-08-15T13:34:00Z
builderVerification: PASSED
qaPlayerValidation: PLAYER_VALIDATED
openBlockingFindings: 0
certifiedAt: 2026-08-15T13:34:00Z
---

# Phase 2 — Tactical tabletop foundation

## Lifecycle

`IMPLEMENTING` → `BUILDER_VERIFYING` → `READY_FOR_QA` → `PLAYER_VALIDATED` → `AWAITING_HUMAN_REVIEW` → `PHASE_CERTIFIED`.

Phase 2 has an explicit Product Owner gate. Certification advances only after authenticated approval of the exact frozen candidate — never from silence.

## Certified candidate

| Field | Value |
| --- | --- |
| Candidate id | `cand-e1c5d41b583b` |
| Source tree hash | `e1c5d41b583bc16fba0a83544b013280474e7c485fe1987d234a79e09d163a48` |
| Certified commit | `e6da5508a4015a1e4e7dac9b24c643ff3fcafaaa` |
| Blueprint | `ALPHA_3_V1` |

The candidate hash covers exactly the tracked Builder Root source, its dependency lock, and its security rules. QA, Runtime, Evidence, Checkpoint, and archive artifacts are evidence about the candidate and are excluded, as Section 1.11.1 requires. Committing this certificate therefore does not change the certified candidate.

## Gate evidence

| Gate | Outcome | Record |
| --- | --- | --- |
| Builder Verification | PASSED | `Checkpoints/phase-2/PHASE_2_BUILDER_VERIFICATION.md` |
| Independent QA | PLAYER_VALIDATED | `QA/findings/PHASE_2_QA_FINDINGS.md` |
| Product Owner approval | APPROVED by Nick | `Checkpoints/phase-2/PHASE_2_HUMAN_APPROVAL_CHECKPOINT.md` |

## Scope certified

Command/event/projection/idempotency core; map schemas and Vanilla Pixi stage with SVG semantic fallback under frozen CSP; movement, collision, visibility/fog; server-issued Active Turn Timing Authority; Action Composer + Intent Intercept; Party Chat non-mechanical; two-client local sync/recovery; table presentation preferences (reduced motion / low effects); permanent smoke spine tactical segment.

Explicitly not certified here (absent, not stubbed): full SRD combat engine, dice adjudication, XP/progression (Phase 3); Google Sign-In, Admin panel, AI Director responses, speech I/O, four-plus-player social presence (Phase 4); production art packs, AI map pool, campaign memory, production three-pane desktop table layout polish (Phase 5 / later layout work).

## Deferred follow-ups recorded at certification

- Map legend (fog / wall / door / token) for placeholder readability
- Production desktop layout: character rail left, map center, Dock + Action Composer right (Section 8.2); reduce reliance on full-page scroll for core turn actions
- Collapsible / menu placement for less-frequently accessed table controls
- Real Safari / real-tablet device certification — `BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION` until Phase 6/7
