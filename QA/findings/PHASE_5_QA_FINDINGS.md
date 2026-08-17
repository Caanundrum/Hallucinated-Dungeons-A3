---
phase: phase-5
candidateId: cand-77e0e060e3b4
sourceTreeHash: 77e0e060e3b42496ec31040aa2731cb805f3e2e0bbe81db1c3fcd45a75d53412
commit: b900b146f6c4586680c4cdf919e7d161892f272f
localStackManifest: /workspace/Runtime/certification/cand-77e0e060e3b4/local-stack-manifest.json
qaRole: independent-qa
validationStartedAt: 2026-08-17T00:52:00Z
validationCompletedAt: 2026-08-17T00:52:20Z
status: PLAYER_VALIDATED
blockingFindingCount: 0
totalFindingCount: 0
openFindingCount: 0
supersedes: cand-bf752b208fb6
---

# Phase 5 — Independent QA Findings

## Candidate confirmation

| Source | candidateId | environmentClass | runtimeMode |
| --- | --- | --- | --- |
| Builder Verification | `cand-77e0e060e3b4` | local | frozen_certification |
| `GET http://127.0.0.1:5274/api/candidate` | `cand-77e0e060e3b4` | local | frozen_certification |

Live health: ready. Independent QA used frozen origin `5274` only. This candidate supersedes `cand-bf752b208fb6` after the table/token remediation.

## What executed

**Browser suite — 6 scenarios, Chromium, frozen origin `http://127.0.0.1:5274`.**

- Spec: `QA/scripts/phase5-player.qa.spec.ts`
- Config: `QA/playwright.phase5.config.ts`
- Result: **6 passed, 0 failed**
- Machine results: `QA/evidence/phase-5/ui/results.json`
- Console: `/opt/cursor/artifacts/phase5_independent_qa_table_fix.log`

| ID | Persona / intent | Outcome |
| --- | --- | --- |
| QA-P5-01 | Emberferry Crossing seeds memory; secret NPCs stay hidden | PASS |
| QA-P5-02 | Suspend/resume preserves chapter continuity with personal recap | PASS |
| QA-P5-03 | Mist Dock terrain distinct; committed token move changes stage anchor | PASS |
| QA-P5-06 | Close chapter travels table to Mist-Cut Caves | PASS |
| QA-P5-04 | Narration density preference operable on Account | PASS |
| QA-P5-05 | Blank template stays an honest empty table | PASS |

## Blocking findings

None.

## Notes

PO-reported lifeless table (static 5ft chamber, no visible token motion) is addressed on this candidate: dock/cave/tower scenes, animated move, and chapter travel. Product Owner complete-experience approval remains a separate human gate.
