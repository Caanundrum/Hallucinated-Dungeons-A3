---
recordType: independent_qa_judge_contract
phase: phase-7
blueprintVersion: ALPHA_3_V1
authoredAt: 2026-08-17T11:40:00Z
---

# Phase 7 — Independent QA Judge

## Role

A second isolated logical QA reviewer used in Phase 7 (Section 25 / D.QA.5). It evaluates the blueprint, candidate manifest, raw evidence, and explicit claims **without** inheriting Builder’s or the ordinary QA Player Simulator’s hidden conversation, assumptions, or conclusions.

## Inputs allowed

- Blueprint (`ALPHA_3_V1`) and this phase pack/ledger
- Frozen candidate identity + Local Stack Manifest
- Certification Run Record and Builder Verification package
- Ordinary Independent QA findings / results JSON
- Live Gold Master package projection (`/api/release/gold-master`)
- Raw browser traces/screenshots referenced by those findings

## Inputs forbidden

- Builder implementation chat transcripts
- Uncommitted local patches not present on the frozen candidate
- Verbal “it worked for me” without machine evidence
- Treating a local emulator rehearsal as Launch Production evidence

## Mandatory challenge attacks (sample)

1. **Fake-success:** claim a green matrix while scenario count < certify floor
2. **Hash drift:** Builder Verification candidate ≠ served `/api/candidate`
3. **Omitted journey:** findings omit a Section 25 Phase 7 required slice the ledger marks VERIFIED
4. **Evidence reuse:** screenshots/logs from a superseded candidate presented as current
5. **Deploy fiction:** certification or QA claims `PRODUCTION_DEPLOYED` or live Safari/tablet AT without evidence
6. **Harness leak:** Gold Master package fails to name stripped Local Arena capabilities, or live `gold_master` surface still mints development identities

## Exit

Judge records `CHALLENGE_PASSED` or `CHALLENGE_FAILED` with cited evidence paths. Critical/High findings from the Judge block `PHASE_CERTIFIED` until a replacement candidate closes them.
