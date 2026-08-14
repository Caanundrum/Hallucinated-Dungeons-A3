---
phase: phase-1
candidateId: cand-c9f4d8eaf883
sourceTreeHash: c9f4d8eaf883767c8a3b579f8cb84efe37d45e757167e42b0c2b3b7eee513356
commit: 65dc5eecb69528aba665f0b7e8c3957b0b6844d5
localStackManifest: /workspace/Runtime/certification/cand-c9f4d8eaf883/local-stack-manifest.json
qaRole: independent-qa
validationStartedAt: 2026-08-14T18:50:00Z
validationCompletedAt: 2026-08-14T18:51:00Z
status: PLAYER_VALIDATED
blockingFindingCount: 0
totalFindingCount: 0
openFindingCount: 0
---

# Phase 1 — Independent QA Findings

## Candidate confirmation

| Source | candidateId | environmentClass | runtimeMode |
| --- | --- | --- | --- |
| Builder Verification | `cand-c9f4d8eaf883` | local | frozen_certification |
| `GET http://127.0.0.1:5274/api/candidate` | `cand-c9f4d8eaf883` | local | frozen_certification |
| Footer build strip (rendered) | `cand-c9f4d8eaf883` | — | — |

Live health: `GET /api/health` → `status: ready` with Firestore and Auth emulators reachable.

## What executed

**Browser suite — 6 scenarios, Chromium, frozen origin `http://127.0.0.1:5274`.**

- Spec: `QA/scripts/phase1-player.qa.spec.ts`
- Config: `QA/playwright.phase1.config.ts`
- Result: **6 passed, 0 failed**
- Console: `QA/evidence/phase-1/qa-browser-console.log`
- Screenshots: `QA/evidence/phase-1/ui/p1-01-campaign-detail.png`, `p1-02-settings.png`, `p1-03-dock.png`, `p1-05-foreign.png`, `p1-06-reentry.png`
- Machine results: `QA/evidence/phase-1/ui/results.json`

| ID | Persona / intent | Outcome |
| --- | --- | --- |
| QA-P1-01 | Novice: character + campaign + Director lock copy | PASS |
| QA-P1-02 | Impatient: Session Zero / settings; no fake AI controls | PASS |
| QA-P1-03 | Dock peer tabs + separate Action Composer | PASS |
| QA-P1-04 | Keyboard-only primary shell navigation | PASS |
| QA-P1-05 | Adversarial foreign campaign id | PASS |
| QA-P1-06 | Reentry: reload recovers character + campaign | PASS |

Builder's frozen certification suite (57 scenarios) already exercised expert, ownership, invite/seat, and Phase 0 regression paths against the same candidate; QA did not duplicate that matrix.

## Device / browser coverage note

Real Safari and real-tablet certification remain `BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION` until Phase 6/7 host evidence is available. This pass does not label emulated engines as real-device certification.

## Findings

No blocking or non-blocking findings opened against `cand-c9f4d8eaf883`.

## Disposition

**PLAYER_VALIDATED.** Experience is understandable and coherent for the Phase 1 player journey on the frozen candidate. Lifecycle advances to Product Owner review (`AWAITING_HUMAN_REVIEW`); approval is not inferred from this validation.
