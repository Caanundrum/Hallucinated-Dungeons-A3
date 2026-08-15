---
phase: phase-2
recordType: builder_verification
lifecycleState: NOT_STARTED
candidateId: PENDING_FREEZE
blueprintVersion: ALPHA_3_V1
---

# Phase 2 — Builder Verification

Frozen Local Certification Mode result for Phase 2. Populated by `npm run certify:phase2` against a clean Builder Root.

## Mission

Prove the Phase 2 tactical slice on one frozen local candidate: command/event core, map/Pixi stage, movement/visibility, Timing Authority + Action Composer, two-client sync/recovery, table a11y preferences, and the permanent smoke spine tactical segment.

## Status

| Field | Value |
| --- | --- |
| Status | NOT_STARTED |
| Candidate | PENDING_FREEZE |
| Evidence | Evidence/phase-2/… after a successful certify run |

## Required suites

- Focused unit suite against the materialized candidate
- Actual-page self-play + permanent smoke spine (browser floor ≥ 65 scenarios)
- Architecture conformance + code completeness scan
- Candidate unchanged during the run

## Next gate

Independent QA against this exact frozen candidate, then Product Owner review of the main tabletop (`PHASE_2_HUMAN_APPROVAL_CHECKPOINT.md`).
