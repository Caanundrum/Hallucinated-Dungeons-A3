---
recordType: independent_qa_judge_contract
phase: phase-6
blueprintVersion: ALPHA_3_V1
authoredAt: 2026-08-17T02:26:00Z
---

# Phase 6 — Independent QA Judge

## Role

A second isolated logical QA reviewer used in Phase 6 (Section 25 / D.QA.5). It evaluates the blueprint, candidate manifest, raw evidence, and explicit claims **without** inheriting Builder’s or the ordinary QA Player Simulator’s hidden conversation, assumptions, or conclusions.

## Inputs allowed

- Blueprint (`ALPHA_3_V1`) and this phase pack/ledger
- Frozen candidate identity + Local Stack Manifest
- Certification Run Record and Builder Verification package
- Ordinary Independent QA findings / results JSON
- Raw browser traces/screenshots referenced by those findings

## Inputs forbidden

- Builder implementation chat transcripts
- Uncommitted local patches not present on the frozen candidate
- Verbal “it worked for me” without machine evidence

## Mandatory challenge attacks (sample)

1. **Fake-success:** claim a green matrix while scenario count &lt; certify floor
2. **Hash drift:** Builder Verification candidate ≠ served `/api/candidate`
3. **Omitted journey:** findings omit a Section 25 Phase 6 required slice that the ledger marks VERIFIED
4. **Evidence reuse:** screenshots/logs from a superseded candidate presented as current
5. **Authority leak:** player-visible surface reveals `secret` audience memory or Admin-only controls

## Exit

Judge records `CHALLENGE_PASSED` or `CHALLENGE_FAILED` with cited evidence paths. Critical/High findings from the Judge block `PHASE_CERTIFIED` until a replacement candidate closes them.
