---
phase: phase-4
candidateId: cand-1de6ebed38c8
sourceTreeHash: 1de6ebed38c802c61ccb718d24dca051f1db2ccca2504df9e8d2f07a46debd87
commit: c1fb66a5d3659c7cfad3b41f03831ba49c903bbb
localStackManifest: /workspace/Runtime/certification/cand-1de6ebed38c8/local-stack-manifest.json
qaRole: independent-qa
validationStartedAt: 2026-08-16T19:51:00Z
validationCompletedAt: 2026-08-16T19:56:00Z
status: PLAYER_VALIDATED
blockingFindingCount: 0
totalFindingCount: 0
openFindingCount: 0
---

# Phase 4 — Independent QA Findings

## Candidate confirmation

| Source | candidateId | environmentClass | runtimeMode |
| --- | --- | --- | --- |
| Builder Verification | `cand-1de6ebed38c8` | local | frozen_certification |
| `GET http://127.0.0.1:5274/api/candidate` | `cand-1de6ebed38c8` | local | frozen_certification |

Live health: ready with Firestore and Auth emulators reachable. Independent QA used frozen origin `5274` only.

## What executed

**Browser suite — 5 scenarios, Chromium, frozen origin `http://127.0.0.1:5274`.**

- Spec: `QA/scripts/phase4-player.qa.spec.ts`
- Config: `QA/playwright.phase4.config.ts`
- Result: **5 passed, 0 failed** (re-run after serve:frozen; prior attempt had transient `start-campaign` timeouts while the arena was still settling)
- Machine results: `QA/evidence/phase-4/ui/results.json`
- Console: `/opt/cursor/artifacts/phase4_ux_independent_qa3.log`

| ID | Persona / intent | Outcome |
| --- | --- | --- |
| QA-P4-01 | Presence panel + Director Address nonmutation | PASS |
| QA-P4-02 | Party Chat isolation + NL Intent Intercept cancel | PASS |
| QA-P4-03 | Ordinary Admin denial + bootstrap kill switch | PASS |
| QA-P4-04 | Two-client presence + Party Chat sync + out-of-turn block | PASS |
| QA-P4-05 | Speech prefs optional; STT does not auto-send | PASS |

## Blocking findings

None.

## Notes

This validation covers the UX-remediation candidate that supersedes `cand-f79b57277ebf` (Claim Active Turn placement, gate hints, presence grouping, Director/NL scroll thrash fix).
